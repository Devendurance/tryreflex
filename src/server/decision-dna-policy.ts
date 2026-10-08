import { createHash } from "node:crypto";
import { computeDecisionQuality, decimalUnits, formatDecimal, REVIEW_DIMENSIONS, type ReviewDimension } from "./review-policy";
import { RepositoryError } from "./db/repositories";
import { buildMemoryText } from "./ai/memory-text";
import { computeSourceHash } from "./db/validation";

export const DNA_POLICY_VERSION = "decision-dna.v1";
export const DNA_MIN_COVERAGE = 80;
export const DNA_MIN_FEATURE_CONFIDENCE = 0.7;
export const DNA_STRONG_SCORE = 70;
export const DNA_WEAK_SCORE = 40;
export type DNACategory = "edge" | "leak" | "influence" | "execution" | "regime";
export type DNAStatus = "observation" | "emerging" | "established";
export interface DNAQuote { evidenceId: string; quote: string }
export interface DNAEvidence {
  id: string;
  userId: string;
  kind: string;
  text: string;
  decisionId?: string | null;
  tradeId?: string | null;
  sourceId?: string | null;
  contextSnapshotId?: string | null;
  reviewId?: string | null;
}
export interface DNADimension {
  dimension: ReviewDimension;
  score: number | null;
  confidence: number;
  evidenceRefs: string[];
  observedFacts: DNAQuote[];
}
export interface DNAEvent {
  userId: string;
  decisionId: string;
  reviewId: string;
  tradeId: string;
  reviewedAt: string;
  reviewEvidenceId: string;
  assetClass: "crypto" | "rtoken" | "stock" | "other" | null;
  assetSymbol: string | null;
  origins: { label: string; basis: "inference" | "user_confirmed"; confidence: number | null }[];
  dimensions: DNADimension[];
  evidence: DNAEvidence[];
  planDrift: { type: string; status: string; evidenceBasis: string; evidenceRefs: string[]; observedFacts: DNAQuote[]; ordering: DNAQuote }[];
  sources: { id: string; sourceType: string; url: string | null }[];
  contexts: { id: string; verifiedDecisionTime: boolean; nativeMarketState: "open" | "closed" | null; regime: string | null }[];
  outcome: "positive" | "negative" | "break_even" | "unknown";
}
interface Feature {
  category: DNACategory;
  feature: string;
  basis: string;
  cohort: Record<string, unknown>;
  evidenceRefs: string[];
  facts: DNAQuote[];
  highQuality: boolean;
}
export interface DNAPatternCandidate {
  fingerprint: string;
  category: DNACategory;
  status: DNAStatus;
  description: string;
  evidenceCount: number;
  confidence: null;
  evidenceRefs: string[];
  observedStatistics: Record<string, unknown>;
}
const SCALE = BigInt("1000000000000");
const LABELS = new Set(["original_research", "borrowed_conviction", "social_confirmation", "pure_impulse"]);
const unique = (values: readonly string[]) => [...new Set(values)].sort();
function invalid(): never { throw new RepositoryError("DNA evidence failed validation", "INVALID_INPUT"); }
function units(value: number): bigint { return decimalUnits(value.toFixed(12)); }
function mean(values: readonly number[]): string | null {
  if (!values.length) return null;
  const count = BigInt(values.length);
  return formatDecimal((values.reduce((sum, value) => sum + units(value), BigInt(0)) + count / BigInt(2)) / count);
}
function median(values: readonly number[]): string | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return mean(sorted.length % 2 ? [sorted[middle]] : [sorted[middle - 1], sorted[middle]]);
}
function percentage(count: number, total: number): string | null {
  return total ? formatDecimal((BigInt(count) * BigInt(100) * SCALE + BigInt(total) / BigInt(2)) / BigInt(total)) : null;
}
function quality(event: DNAEvent) {
  const scores = Object.fromEntries(REVIEW_DIMENSIONS.map((name) => [name, event.dimensions.find((dimension) => dimension.dimension === name)?.score ?? null])) as Record<ReviewDimension, number | null>;
  return computeDecisionQuality(scores);
}
function statistics(events: readonly DNAEvent[]) {
  const qualities = events.map(quality);
  const scores = qualities.flatMap((entry) => entry.score === null ? [] : [entry.score]);
  return {
    decisionCount: events.length,
    qualityAssessedCount: scores.length,
    qualityUnassessedCount: events.length - scores.length,
    finalCount: qualities.filter((entry) => entry.status === "final").length,
    provisionalCount: qualities.filter((entry) => entry.status === "provisional").length,
    averageDecisionQuality: mean(scores),
    medianDecisionQuality: median(scores),
    averageFinalDecisionQuality: mean(qualities.flatMap((entry) => entry.status === "final" && entry.score !== null ? [entry.score] : [])),
    averageProvisionalDecisionQuality: mean(qualities.flatMap((entry) => entry.status === "provisional" && entry.score !== null ? [entry.score] : [])),
    averageEvidenceCoveragePct: mean(qualities.map((entry) => entry.evidenceCoveragePct)),
    dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((name) => {
      const values = events.flatMap((event) => {
        const dimension = event.dimensions.find((entry) => entry.dimension === name);
        return dimension?.score == null ? [] : [dimension.score];
      });
      return [name, { assessedCount: values.length, unassessedCount: events.length - values.length, average: mean(values), median: median(values) }];
    })),
    knownOutcomes: {
      positive: events.filter((event) => event.outcome === "positive").length,
      negative: events.filter((event) => event.outcome === "negative").length,
      breakEven: events.filter((event) => event.outcome === "break_even").length,
      unknown: events.filter((event) => event.outcome === "unknown").length,
    },
    statisticsMeaning: "Descriptive record aggregates, not causal effects, realized-return estimates, or statistical certainty",
    decimalRounding: "12 decimal places, half away from zero",
  };
}
function effectiveOrigins(event: DNAEvent): DNAEvent["origins"] {
  const confirmed = event.origins.filter((origin) => origin.basis === "user_confirmed");
  return confirmed.length > 0 ? confirmed : event.origins;
}
function originCohort(event: DNAEvent): Record<string, unknown> | null {
  const origins = effectiveOrigins(event);
  if (!event.assetClass || !origins.length) return null;
  return { assetClass: event.assetClass, origins: unique(origins.map((origin) => `${origin.label}:${origin.basis}`)) };
}
function validEvidence(event: DNAEvent, id: string): DNAEvidence {
  const evidence = event.evidence.find((entry) => entry.id === id);
  if (!evidence || evidence.userId !== event.userId) return invalid();
  const related = evidence.decisionId === event.decisionId || evidence.tradeId === event.tradeId || evidence.reviewId === event.reviewId || event.sources.some((source) => source.id === evidence.sourceId) || event.contexts.some((context) => context.id === evidence.contextSnapshotId);
  if (!related) return invalid();
  return evidence;
}
function validateQuotes(event: DNAEvent, facts: readonly DNAQuote[], refs: readonly string[]): boolean {
  refs.forEach((id) => validEvidence(event, id));
  for (const fact of facts) {
    if (!refs.includes(fact.evidenceId) || !fact.quote || !validEvidence(event, fact.evidenceId).text.includes(fact.quote)) return invalid();
  }
  return facts.length > 0 && refs.length > 0;
}
function sourceIdentity(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
function features(event: DNAEvent): Feature[] {
  const result: Feature[] = [];
  const assessed = quality(event);
  const coverageQualified = assessed.evidenceCoveragePct >= DNA_MIN_COVERAGE;
  const cohort = originCohort(event);
  const add = (feature: Feature) => result.push({ ...feature, evidenceRefs: unique([event.reviewEvidenceId, ...feature.evidenceRefs]) });
  if (event.origins.some((origin) => !LABELS.has(origin.label))) return invalid();
  for (const origin of effectiveOrigins(event)) {
    if (!event.assetClass) continue;
    add({ category: "influence", feature: origin.label, basis: origin.basis, cohort: { assetClass: event.assetClass }, evidenceRefs: [], facts: [], highQuality: coverageQualified && origin.basis === "user_confirmed" });
  }
  for (const dimension of event.dimensions) {
    if (dimension.score === null) {
      if (dimension.confidence !== 0 || dimension.evidenceRefs.length || dimension.observedFacts.length) return invalid();
      continue;
    }
    if (!Number.isFinite(dimension.score) || dimension.score < 0 || dimension.score > 100 || !Number.isFinite(dimension.confidence) || dimension.confidence < 0 || dimension.confidence > 1) return invalid();
    const grounded = validateQuotes(event, dimension.observedFacts, dimension.evidenceRefs);
    if (!grounded) return invalid();
    if (!cohort) continue;
    const category = dimension.score >= DNA_STRONG_SCORE ? "edge" : dimension.score < DNA_WEAK_SCORE ? "leak" : null;
    if (category) add({ category, feature: dimension.dimension, basis: "grounded_review_assessment", cohort, evidenceRefs: dimension.evidenceRefs, facts: dimension.observedFacts, highQuality: coverageQualified && dimension.confidence >= DNA_MIN_FEATURE_CONFIDENCE });
  }
  for (const drift of event.planDrift) {
    if (drift.type !== "target_drift" || drift.status !== "observed" || !cohort) continue;
    const facts = [...drift.observedFacts, drift.ordering];
    if (!validateQuotes(event, facts, drift.evidenceRefs)) continue;
    const relevant = event.dimensions.filter((dimension) => ["execution_quality", "behavioral_control"].includes(dimension.dimension) && dimension.score !== null);
    add({ category: "execution", feature: "target_drift", basis: drift.evidenceBasis, cohort, evidenceRefs: drift.evidenceRefs, facts, highQuality: coverageQualified && relevant.length > 0 && relevant.every((dimension) => dimension.confidence >= DNA_MIN_FEATURE_CONFIDENCE) });
  }
  for (const source of event.sources) {
    if (!source.url || !cohort) continue;
    const identity = sourceIdentity(source.url);
    if (!identity) continue;
    const evidence = event.evidence.find((entry) => entry.kind === "source" && entry.sourceId === source.id);
    if (!evidence) continue;
    validEvidence(event, evidence.id);
    add({ category: "influence", feature: identity, basis: "recorded_source_identity", cohort: { ...cohort, sourceType: source.sourceType }, evidenceRefs: [evidence.id], facts: [], highQuality: coverageQualified });
  }
  for (const context of event.contexts) {
    if (!context.verifiedDecisionTime || !event.assetClass) continue;
    const evidence = event.evidence.find((entry) => entry.kind === "market_data" && entry.contextSnapshotId === context.id);
    if (!evidence) continue;
    validEvidence(event, evidence.id);
    for (const [name, value] of [["native_market_state", context.nativeMarketState], ["regime", context.regime]] as const) {
      if (!value || value === "unknown") continue;
      add({ category: "regime", feature: `${name}:${value}`, basis: "verified_decision_time_context", cohort: { assetClass: event.assetClass }, evidenceRefs: [evidence.id], facts: [], highQuality: coverageQualified });
    }
  }
  return result;
}
export function patternLifecycle(count: number, highQualityCount: number): DNAStatus {
  if (count < 1 || highQualityCount < 0 || highQualityCount > count) return invalid();
  return count === 1 ? "observation" : count >= 4 && highQualityCount >= 4 ? "established" : "emerging";
}
function description(feature: Feature, count: number, status: DNAStatus): string {
  const countText = `${count} reviewed decision${count === 1 ? "" : "s"}`;
  const subject = feature.category === "execution" ? "Target Drift was observed" : feature.category === "influence" ? `${feature.feature} was ${feature.basis === "inference" ? "model-inferred" : "recorded"}` : feature.category === "regime" ? `${feature.feature} was recorded in verified decision-time context` : `${feature.feature.replaceAll("_", " ")} was assessed as ${feature.category === "edge" ? "strong" : "weak"}`;
  const caution = count === 1 ? "This is a single-decision observation, not a habit, edge, or recurring leak." : status === "emerging" ? "This is emerging comparable evidence, not a fixed trait or statistically certain effect." : "Established describes recurrent evidence meeting the product quality gate, not a personality trait or proven trading edge.";
  return `${subject} for ${countText}. ${caution} Process assessments are separate from financial outcomes; source association does not establish causation.`;
}
function matchesCohort(event: DNAEvent, feature: Feature): boolean {
  if (event.assetClass !== feature.cohort.assetClass) return false;
  if (feature.cohort.origins && JSON.stringify(originCohort(event)?.origins) !== JSON.stringify(feature.cohort.origins)) return false;
  if (feature.cohort.sourceType && !event.sources.some((source) => source.sourceType === feature.cohort.sourceType && sourceIdentity(source.url) === feature.feature)) return false;
  return true;
}
export function buildDNAMemory(candidate: DNAPatternCandidate) {
  const base = buildMemoryText({ kind: "pattern", patternKind: candidate.category, description: candidate.description, status: candidate.status, evidenceCount: candidate.evidenceCount });
  const text = `${base.text}\npolicy_version: ${DNA_POLICY_VERSION}\nobserved_statistics: ${JSON.stringify(candidate.observedStatistics)}`;
  return { text, version: base.version, sourceHash: computeSourceHash(text) };
}
export function computeDecisionDNA(userId: string, input: readonly DNAEvent[]): { candidates: DNAPatternCandidate[]; evidenceStats: Record<string, unknown> } {
  const byDecision = new Map<string, DNAEvent>();
  for (const event of [...input].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.reviewId.localeCompare(a.reviewId))) {
    if (event.userId !== userId || !Number.isFinite(Date.parse(event.reviewedAt))) return invalid();
    const reviewEvidence = validEvidence(event, event.reviewEvidenceId);
    if (reviewEvidence.kind !== "prior_review" || reviewEvidence.reviewId !== event.reviewId) return invalid();
    if (new Set(event.dimensions.map((dimension) => dimension.dimension)).size !== 5 || event.dimensions.length !== 5 || event.dimensions.some((dimension) => !REVIEW_DIMENSIONS.includes(dimension.dimension))) return invalid();
    if (!byDecision.has(event.decisionId)) byDecision.set(event.decisionId, event);
  }
  const events = [...byDecision.values()].sort((a, b) => a.decisionId.localeCompare(b.decisionId));
  const groups = new Map<string, { feature: Feature; supports: Map<string, { event: DNAEvent; feature: Feature }> }>();
  for (const event of events) {
    for (const feature of features(event)) {
      const fingerprint = createHash("sha256").update(JSON.stringify({ version: DNA_POLICY_VERSION, category: feature.category, feature: feature.feature, basis: feature.basis, cohort: feature.cohort })).digest("hex");
      const group = groups.get(fingerprint) ?? { feature, supports: new Map() };
      group.supports.set(event.decisionId, { event, feature });
      groups.set(fingerprint, group);
    }
  }
  const candidates = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fingerprint, group]): DNAPatternCandidate => {
    const supports = [...group.supports.values()];
    const supportingEvents = supports.map((support) => support.event);
    const comparableEvents = events.filter((event) => matchesCohort(event, group.feature));
    const highQualityCount = supports.filter((support) => support.feature.highQuality).length;
    const status = patternLifecycle(supports.length, highQualityCount);
    const dates = supportingEvents.map((event) => event.reviewedAt).sort();
    const refs = unique(supports.flatMap((support) => support.feature.evidenceRefs));
    return {
      fingerprint,
      category: group.feature.category,
      status,
      description: description(group.feature, supports.length, status),
      evidenceCount: supports.length,
      confidence: null,
      evidenceRefs: refs,
      observedStatistics: {
        producer: DNA_POLICY_VERSION,
        fingerprint,
        active: true,
        category: group.feature.category,
        feature: group.feature.feature,
        basis: group.feature.basis,
        comparability: group.feature.cohort,
        highQualityCount,
        establishedEligible: supports.length >= 4 && highQualityCount >= 4,
        evidenceStrength: status === "observation" ? "limited" : status === "established" ? "quality_supported_recurrence" : "emerging",
        confidenceMeaning: "No fabricated probability; strength is the explicit sample and evidence-quality gate",
        firstObserved: dates[0],
        lastObserved: dates[dates.length - 1],
        observationTimeBasis: "review_recorded_at, not inferred execution timestamps",
        supportingDecisionIds: supportingEvents.map((event) => event.decisionId).sort(),
        supportingReviewIds: supportingEvents.map((event) => event.reviewId).sort(),
        evidenceRefs: refs,
        supportingFacts: supports.map((support) => ({ decisionId: support.event.decisionId, reviewId: support.event.reviewId, basis: support.feature.basis, observedFacts: support.feature.facts })),
        supporting: statistics(supportingEvents),
        comparable: statistics(comparableEvents),
        occurrenceCount: supports.length,
        comparableCount: comparableEvents.length,
        occurrencePct: percentage(supports.length, comparableEvents.length),
      },
    };
  });
  return { candidates, evidenceStats: { ...statistics(events), policyVersion: DNA_POLICY_VERSION, independentDecisionCount: events.length, eligibleReviewCount: input.length, supersededOrSameDecisionReviewsExcluded: input.length - events.length, observationCount: candidates.filter((candidate) => candidate.status === "observation").length, emergingCount: candidates.filter((candidate) => candidate.status === "emerging").length, establishedCount: candidates.filter((candidate) => candidate.status === "established").length } };
}
