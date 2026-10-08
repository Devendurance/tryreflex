import { z } from "zod";
import { groundingFailure } from "../ai/errors";
import { decimalUnits, formatDecimal } from "../review-policy";

export type PlanDriftType = "target_drift" | "risk_drift" | "thesis_drift" | "invalidation_drift" | "time_horizon_drift";
export interface DriftEvidence { id: string; kind: string; text: string }
export interface TargetDriftFinding {
  type: "target_drift";
  status: "observed";
  evidenceBasis: "retrospective_user_report";
  originalPlan: { metric: "market_cap"; currency: "USD"; value: string };
  revisedPlan: { metric: "market_cap"; currency: "USD"; value: string };
  observations: { peakMarketCap: string | null; exitMarketCap: string | null };
  metrics: Record<string, string | null>;
  ordering: { basis: "explicit_user_statement"; evidenceId: string; quote: string };
  observedFacts: { evidenceId: string; quote: string }[];
  evidenceRefs: string[];
  userSelfAssessment: { text: string; evidenceRefs: string[] }[];
  explanation: string;
}

const AMOUNT = String.raw`\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,12})?\s*(?:billion|million|thousand|[kmb])?(?![A-Za-z0-9]|\.\d)`;
const CHANGE = new RegExp(String.raw`\b(?:moved|raised|changed|revised|shifted|increased|lowered|reduced)\b.{0,100}\b(?:target|take[ -]?profit|expectation)\b.{0,60}\bfrom\s+(?:the\s+)?(?:original\s+|initial\s+)?(${AMOUNT}).{0,40}?\b(?:to|toward|towards)\s+(${AMOUNT})`, "i");
const EXPECTATION = new RegExp(String.raw`\b(?:thinking|expecting|aiming|waiting)\b.{0,60}?(${AMOUNT}).{0,100}\b(?:initially|originally|original|initial)\b.{0,30}?(${AMOUNT})`, "i");
const BEFORE_ENTRY = /\bbefore\s+(?:entry|entering|buying|the trade|I (?:entered|bought))\b/i;
const NEGATED_CHANGE = /\b(?:never|did not|didn['’]t|not)\s+(?:actually\s+)?(?:moved?|raised?|changed?|revised?|shifted?|increased?|lowered?|reduced?)\b|\b(?:never|not|wasn['’]t|was not)\s+(?:thinking|expecting|aiming|waiting)\b/i;
const AFTER_EXIT = /\bafter\s+(?:exit|exiting|selling|closing|I (?:exited|sold)|the trade (?:ended|closed))\b/i;
const OTHER_METRIC = /\b(?:unit[ -]?price|token price|price per token|per token|EUR|GBP|USDT|USDC)\b|[€£¥]/i;
const HELD_ACTION = /\b(?:didn['’]t sell|did not sell|failed to sell|while (?:holding|in the trade))\b/i;
const AFTER_ENTRY = /\bafter\s+(?:entry|entering|buying|I (?:entered|bought)|the trade (?:began|started))\b/i;

function capValue(token: string): string | null {
  const match = token.trim().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d{1,12})?)(k|m|b|thousand|million|billion)?$/i);
  if (!match) return null;
  try {
    const factor = ({ k: 1000, thousand: 1000, m: 1000000, million: 1000000, b: 1000000000, billion: 1000000000 } as Record<string, number>)[match[2]?.toLowerCase()] ?? 1;
    const value = formatDecimal(decimalUnits(match[1]) * BigInt(factor));
    return decimalUnits(value) > BigInt(0) ? value : null;
  } catch { return null; }
}

function narrativeWords(text: string): string {
  return text.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-");
}

export function mentionsCapValue(text: string, value: string): boolean {
  return [...narrativeWords(text).matchAll(new RegExp(AMOUNT, "gi"))].some((match) => capValue(match[0]) === value);
}

export function assertSpecificDriftLessons(lessons: readonly { text: string; evidenceRefs: readonly string[] }[], findings: readonly TargetDriftFinding[]): void {
  lessons.forEach((lesson, i) => {
    if (/^(?:stick to (?:your|the) plan|do more research|control greed|don['’]t be greedy|do not be greedy)[.!?\s]*$/i.test(lesson.text.trim())) groundingFailure("GENERIC_LESSON", `lessons[${i}].text`);
  });
  findings.forEach((finding, i) => {
    if (!lessons.some((lesson) => finding.evidenceRefs.every((id) => lesson.evidenceRefs.includes(id)) && /\b(?:target|take[ -]?profit)\b/i.test(narrativeWords(lesson.text)) && /\b(?:chang(?:e[ds]?|ing)|shift(?:s|ed|ing)?|rais(?:e[ds]?|ing)|revis(?:e[ds]?|ing)|mov(?:e[ds]?|ing)|drift(?:s|ed|ing)?|increas(?:e[ds]?|ing)|from|towards?)\b/i.test(narrativeWords(lesson.text)) && mentionsCapValue(lesson.text, finding.originalPlan.value) && mentionsCapValue(lesson.text, finding.revisedPlan.value))) groundingFailure("PLAN_DRIFT_LESSON_NOT_SPECIFIC", `planDriftLessons[${i}].text`, finding.evidenceRefs);
  });
}

export function assertDriftNarratives(
  value: { summary: string; lessons: { text: string }[]; dimensions: { dimension: string; score: number | null; explanation: string; observedFacts: { evidenceId: string; quote: string }[]; inferredFindings: { finding: string }[] }[] },
  findings: readonly TargetDriftFinding[],
): void {
  const originalLevelClaim = /\b(?:did not|didn['’]t|failed to|chose not to)\s+(?:sell|exit)\s+at\s+(?:the\s+)?original\b/i;
  const supportsOriginalLevel = findings.some((finding) =>
    [finding.ordering.quote, ...finding.observedFacts.map((fact) => fact.quote)].some((quote) =>
      originalLevelClaim.test(narrativeWords(quote)),
    ),
  );
  const peakChronology = /\b(?:before|after)\b.{0,60}\bpeak(?:ed)?\b/i;
  const supportsPeakChronology = findings.some((finding) =>
    [finding.ordering.quote, ...finding.observedFacts.map((fact) => fact.quote)].some((quote) =>
      peakChronology.test(narrativeWords(quote)),
    ),
  );
  const guard = (text: string, path: string) => {
    for (const sentence of narrativeWords(text).split(/(?<=[.!?])\s+/)) {
      if (/\bq\d+\b/i.test(sentence)) groundingFailure("INTERNAL_SELECTOR_IN_NARRATIVE", path);
      if (/\b(?:optimism(?: bias)?|overconfidence)\b/i.test(sentence)) groundingFailure("UNSUPPORTED_MOTIVE_CLAIM", path);
      if (/\bgreed(?:y)?\b/i.test(sentence) && !(/\b(?:retrospectively|retrospective|self[ -]reported|self[ -]assessment)\b/i.test(sentence) && /\b(?:attribut(?:ed|es|ing|ion)|report(?:ed|s|ing)?|thought|thinks|interpretation|assessment|self-assessed|described|said|stated)\b/i.test(sentence))) groundingFailure("RETROSPECTIVE_ATTRIBUTION_REQUIRED", path);
      if (/\b(?:money left on the table|realized (?:profit|loss|returns?)|investment (?:performance|returns?)|financial (?:loss|gain)|cost of (?:target|plan) drift|suboptimal exit)\b/i.test(sentence) && !/\b(?:not|unknown|unavailable|cannot|never|no evidence|does not|don['’]t)\b/i.test(sentence)) groundingFailure("UNSUPPORTED_FINANCIAL_CLAIM", path);
      if (findings.length > 0 && originalLevelClaim.test(sentence) && !supportsOriginalLevel) {
        groundingFailure("UNSUPPORTED_EXECUTION_CLAIM", path, findings[0].evidenceRefs);
      }
      if (findings.length > 0 && peakChronology.test(sentence) && !supportsPeakChronology) {
        groundingFailure("UNSUPPORTED_EXECUTION_CLAIM", path, findings[0].evidenceRefs);
      }
    }
  };
  guard(value.summary, "summary");
  value.lessons.forEach((lesson, i) => guard(lesson.text, `lessons[${i}].text`));
  value.dimensions.forEach((dimension, i) => {
    guard(dimension.explanation, `dimensions[${i}].explanation`);
    dimension.inferredFindings.forEach((finding, j) => guard(finding.finding, `dimensions[${i}].inferredFindings[${j}].finding`));
  });
  for (const finding of findings) {
    value.dimensions.forEach((dimension, i) => {
      if (dimension.score === null || !["execution_quality", "behavioral_control"].includes(dimension.dimension)) return;
      const behaviorQuotes = [finding.ordering.quote, finding.observedFacts[1].quote];
      if (!dimension.observedFacts.some((fact) => fact.evidenceId === finding.ordering.evidenceId && behaviorQuotes.some((quote) => fact.quote.includes(quote)))) groundingFailure("PLAN_DRIFT_EVIDENCE_MISMATCH", `dimensions[${i}].observedFacts`, finding.evidenceRefs);
      if (dimension.dimension === "execution_quality") {
        const explanation = narrativeWords(dimension.explanation);
        if (!/\b(?:target|take[ -]?profit)\b/i.test(explanation) || !/\b(?:chang(?:e[ds]?|ing)|shift(?:s|ed|ing)?|rais(?:e[ds]?|ing)|revis(?:e[ds]?|ing)|mov(?:e[ds]?|ing)|drift(?:s|ed|ing)?|increas(?:e[ds]?|ing))\b/i.test(explanation)) {
          groundingFailure("PLAN_DRIFT_EVIDENCE_MISMATCH", `dimensions[${i}].explanation`, finding.evidenceRefs);
        }
      }
    });
  }
}

function percent(numerator: bigint, denominator: bigint): string {
  const scale = BigInt("1000000000000");
  const sign = numerator < BigInt(0) ? -BigInt(1) : BigInt(1);
  const magnitude = numerator < BigInt(0) ? -numerator : numerator;
  return formatDecimal(sign * ((magnitude * scale + denominator / BigInt(2)) / denominator));
}

export function targetDriftMetrics(original: string, revised: string, peak: string | null, exit: string | null) {
  const initial = decimalUnits(original);
  const later = decimalUnits(revised);
  const high = peak === null ? null : decimalUnits(peak);
  const final = exit === null ? null : decimalUnits(exit);
  if (initial <= BigInt(0) || later <= BigInt(0) || (high !== null && high <= BigInt(0)) || (final !== null && final <= BigInt(0))) throw new Error("invalid target observation");
  return {
    targetMovementMultiple: percent(later, initial),
    targetIncreasePct: percent((later - initial) * BigInt(100), initial),
    peakVsOriginalTargetMultiple: high === null ? null : percent(high, initial),
    peakAboveOriginalTargetPct: high === null ? null : percent((high - initial) * BigInt(100), initial),
    exitVsPeakMultiple: high === null || final === null ? null : percent(final, high),
    exitBelowPeakPct: high === null || final === null ? null : percent((high - final) * BigInt(100), high),
    exitVsOriginalTargetMultiple: final === null ? null : percent(final, initial),
    exitBelowOriginalTargetPct: final === null ? null : percent((initial - final) * BigInt(100), initial),
    meaning: "Signed target and market-cap observation comparisons, not realized return, loss, or money left on the table",
  };
}

export function detectTargetDrift(snapshot: Record<string, unknown>, observations: Record<string, unknown>, catalog: readonly DriftEvidence[]): TargetDriftFinding[] {
  if (snapshot.marketCapCurrency !== "USD" || observations.marketCapCurrency !== "USD" || typeof snapshot.intendedTakeProfitMarketCap !== "string" || typeof observations.retrospectiveComments !== "string") return [];
  const original = capValue(snapshot.intendedTakeProfitMarketCap);
  if (original === null) return [];
  const comments = observations.retrospectiveComments;
  if (comments.length > 20000) return [];
  const planText = JSON.stringify(snapshot);
  if (/\b(?:if|when|once|after)\b.{0,120}\b(?:raise|increase|revise|move|change|shift|lower|reduce)\b.{0,60}\b(?:target|take[ -]?profit)\b|\b(?:raise|increase|revise|move|change|shift|lower|reduce)\b.{0,60}\b(?:target|take[ -]?profit)\b.{0,120}\b(?:if|when|once|after)\b/i.test(planText)) return [];
  const source = catalog.find((entry) => entry.kind === "user_input" && entry.text.startsWith("original confirmed decision snapshot:\n") && entry.text.split("\n").includes(`intendedTakeProfitMarketCap: ${snapshot.intendedTakeProfitMarketCap}`) && entry.text.split("\n").includes("marketCapCurrency: USD"));
  const laterSource = catalog.find((entry) => entry.kind === "trade_data" && entry.text.startsWith("phase: after_the_fact manual observations, not decision-time evidence") && entry.text.endsWith(`retrospective_comments: ${comments}`));
  if (!source || !laterSource || !z.string().uuid().safeParse(source.id).success || !z.string().uuid().safeParse(laterSource.id).success) return [];
  const clauses = comments.split(/(?<=[.!?])\s+|\n/).map((clause) => clause.trim()).filter(Boolean);
  const behaviorClauses = clauses.filter((quote) => !/^Self-assessment:\s*/i.test(quote));
  const candidates = behaviorClauses.flatMap((quote) => {
    if (BEFORE_ENTRY.test(quote) || AFTER_EXIT.test(quote) || OTHER_METRIC.test(quote) || NEGATED_CHANGE.test(quote) || !/\b(?:target|take[ -]?profit|expectation|market cap|mcap)\b/i.test(quote)) return [];
    const change = quote.match(CHANGE);
    const expectation = change === null ? quote.match(EXPECTATION) : null;
    const from = change ? capValue(change[1]) : expectation ? capValue(expectation[2]) : null;
    const to = change ? capValue(change[2]) : expectation ? capValue(expectation[1]) : null;
    return from === original && to !== null && to !== original ? [{ quote, revised: to }] : [];
  });
  const revisedValues = new Set(candidates.map((candidate) => candidate.revised));
  if (revisedValues.size !== 1) return [];
  const candidate = candidates[0];
  if (!candidate) return [];
  const ordering = behaviorClauses.find((quote) => !BEFORE_ENTRY.test(quote) && !AFTER_EXIT.test(quote) && !OTHER_METRIC.test(quote) && ((quote === candidate.quote && AFTER_ENTRY.test(quote)) || (HELD_ACTION.test(quote) && mentionsCapValue(quote, candidate.revised))));
  if (!ordering || !laterSource.text.includes(candidate.quote) || !laterSource.text.includes(ordering)) return [];
  const optionalCap = (key: string) => typeof observations[key] === "string" ? capValue(observations[key]) : null;
  const peak = optionalCap("peakObservedMarketCap");
  const exit = optionalCap("exitMarketCap");
  const selfAssessment = clauses.find((quote) => /^Self-assessment:\s*/i.test(quote));
  const originalQuote = `intendedTakeProfitMarketCap: ${snapshot.intendedTakeProfitMarketCap}`;
  return [{
    type: "target_drift", status: "observed", evidenceBasis: "retrospective_user_report",
    originalPlan: { metric: "market_cap", currency: "USD", value: original },
    revisedPlan: { metric: "market_cap", currency: "USD", value: candidate.revised },
    observations: { peakMarketCap: peak, exitMarketCap: exit },
    metrics: targetDriftMetrics(original, candidate.revised, peak, exit),
    ordering: { basis: "explicit_user_statement", evidenceId: laterSource.id, quote: ordering },
    observedFacts: [{ evidenceId: source.id, quote: originalQuote }, { evidenceId: laterSource.id, quote: candidate.quote }, { evidenceId: laterSource.id, quote: ordering }],
    evidenceRefs: [source.id, laterSource.id],
    userSelfAssessment: selfAssessment ? [{ text: selfAssessment.replace(/^Self-assessment:\s*/i, ""), evidenceRefs: [laterSource.id] }] : [],
    explanation: `The user reports revising the remembered market-cap target from ${original} USD to ${candidate.revised} USD while holding the trade. This is target drift supported by explicit retrospective statements, not independently verified execution. Peak and exit values are market-cap observations, not realized investment performance.`,
  }];
}
