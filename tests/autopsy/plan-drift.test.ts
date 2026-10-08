import assert from "node:assert/strict";
import test from "node:test";
import { AIError } from "../../src/server/ai/errors";
import { computeDecisionQuality, REVIEW_DIMENSIONS } from "../../src/server/review-policy";
import {
  assertDriftNarratives,
  assertSpecificDriftLessons,
  detectTargetDrift,
  mentionsCapValue,
  targetDriftMetrics,
  type DriftEvidence,
  type TargetDriftFinding,
} from "../../src/server/reviews/plan-drift";

const ID_SNAPSHOT = "623e4567-e89b-42d3-a456-426614174002";
const ID_OBSERVATIONS = "623e4567-e89b-42d3-a456-426614174005";

const COMMENTS =
  "What happened: The token reached about $1.6M market cap, but I didn't sell because I started thinking it could reach $2M. " +
  "What changed: I moved my take-profit expectation from the original $1M target toward $2M. " +
  "Self-assessment: I think greed influenced me to change my take-profit range. " +
  "Eventual exit: I eventually sold around $585k market cap. " +
  "Later expected market cap (USD): 2000000. " +
  "These are retrospective user recollections with unknown exact timestamps, not independently verified fills or historical quotes.";

const SNAPSHOT = {
  assetSymbol: "RUNNER",
  assetClass: "crypto",
  side: "long",
  knowledgeBasis: "retrospective_recollection",
  intendedTakeProfitMarketCap: "1000000",
  marketCapCurrency: "USD",
  origins: ["pure_impulse"],
  sources: [],
};

const OBSERVATIONS = {
  peakObservedMarketCap: "1600000",
  exitMarketCap: "585000",
  marketCapCurrency: "USD",
  retrospectiveComments: COMMENTS,
};

function catalog(
  snapshot: Record<string, unknown> = SNAPSHOT,
  comments: string = COMMENTS,
  ids: { source: string; later: string } = { source: ID_SNAPSHOT, later: ID_OBSERVATIONS },
): DriftEvidence[] {
  return [
    {
      id: ids.source,
      kind: "user_input",
      text: `original confirmed decision snapshot:\nintendedTakeProfitMarketCap: ${String(snapshot.intendedTakeProfitMarketCap)}\nmarketCapCurrency: ${String(snapshot.marketCapCurrency)}`,
    },
    {
      id: ids.later,
      kind: "trade_data",
      text: `phase: after_the_fact manual observations, not decision-time evidence\nretrospective_comments: ${comments}`,
    },
  ];
}

function detect(
  snapshot: Record<string, unknown> = SNAPSHOT,
  observations: Record<string, unknown> = OBSERVATIONS,
  entries: DriftEvidence[] = catalog(),
): TargetDriftFinding[] {
  return detectTargetDrift(snapshot, observations, entries);
}

test("detects an ordered retrospective target revision with exact evidence", () => {
  const findings = detect();
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.type, "target_drift");
  assert.equal(finding.status, "observed");
  assert.equal(finding.evidenceBasis, "retrospective_user_report");
  assert.equal(finding.originalPlan.value, "1000000");
  assert.equal(finding.revisedPlan.value, "2000000");
  assert.equal(finding.originalPlan.currency, "USD");
  assert.deepEqual(finding.evidenceRefs, [ID_SNAPSHOT, ID_OBSERVATIONS]);
  assert.equal(finding.ordering.basis, "explicit_user_statement");
  assert.equal(finding.ordering.evidenceId, ID_OBSERVATIONS);
  assert.ok(finding.ordering.quote.includes("didn't sell"));
  for (const fact of finding.observedFacts) {
    const entry = catalog().find((e) => e.id === fact.evidenceId);
    assert.ok(entry && entry.text.includes(fact.quote), "every fact quote must be an exact catalog substring");
  }
  assert.equal(finding.userSelfAssessment.length, 1);
  assert.ok(finding.userSelfAssessment[0].text.includes("greed"));
  assert.deepEqual(finding.userSelfAssessment[0].evidenceRefs, [ID_OBSERVATIONS]);
  assert.ok(!finding.explanation.includes("greed"), "self-assessment stays separate from the finding explanation");
  assert.deepEqual(finding.observations, { peakMarketCap: "1600000", exitMarketCap: "585000" });
});

test("drift metrics are signed market-cap comparisons, never PnL", () => {
  const finding = detect()[0];
  assert.equal(finding.metrics.targetMovementMultiple, "2");
  assert.equal(finding.metrics.targetIncreasePct, "100");
  assert.equal(finding.metrics.peakVsOriginalTargetMultiple, "1.6");
  assert.equal(finding.metrics.peakAboveOriginalTargetPct, "60");
  assert.equal(finding.metrics.exitVsPeakMultiple, "0.365625");
  assert.equal(finding.metrics.exitBelowPeakPct, "63.4375");
  assert.equal(finding.metrics.exitVsOriginalTargetMultiple, "0.585");
  assert.equal(finding.metrics.exitBelowOriginalTargetPct, "41.5");
  for (const key of Object.keys(finding.metrics)) {
    assert.ok(!/pnl|profit|return/i.test(key), `metric key ${key} must not imply money outcome`);
  }
  const bare = targetDriftMetrics("1000000", "2000000", null, null);
  assert.equal(bare.peakVsOriginalTargetMultiple, null);
  assert.equal(bare.exitVsPeakMultiple, null);
  assert.equal(bare.exitVsOriginalTargetMultiple, null);
});

test("mentionsCapValue does not multiply digits by the word market", () => {
  assert.equal(mentionsCapValue("target was 2000000 market cap", "2000000"), true);
  assert.equal(mentionsCapValue("target was 2000000 market cap", "2000000000000"), false);
  assert.equal(mentionsCapValue("market cap doubled", "2000000"), false);
});

test("cap mentions work at sentence end, with decimals, and not inside decimal continuations", () => {
  assert.equal(mentionsCapValue("I moved my target to $2M.", "2000000"), true);
  assert.equal(mentionsCapValue("the token peaked at $1.6M.", "1600000"), true);
  assert.equal(mentionsCapValue("it noted 1.2.3 in passing", "1.2"), false);
});

test("negative cases emit no drift finding", () => {
  const cases: [string, () => TargetDriftFinding[]][] = [
    ["no original target", () => detect({ ...SNAPSHOT, intendedTakeProfitMarketCap: undefined })],
    ["no later-text target", () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "It went up then down." }, catalog(SNAPSHOT, "It went up then down."))],
    [
      "unchanged target",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "I moved my take-profit expectation from the original $1M target toward $1M while holding." }, catalog(SNAPSHOT, "I moved my take-profit expectation from the original $1M target toward $1M while holding.")),
    ],
    [
      "only exit differs",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "I eventually sold around $585k market cap." }, catalog(SNAPSHOT, "I eventually sold around $585k market cap.")),
    ],
    [
      "peak only untimed",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "The token reached about $1.6M market cap." }, catalog(SNAPSHOT, "The token reached about $1.6M market cap.")),
    ],
    [
      "no explicit ordering",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "I moved my take-profit expectation from the original $1M target toward $2M." }, catalog(SNAPSHOT, "I moved my take-profit expectation from the original $1M target toward $2M.")),
    ],
    [
      "before-entry revision",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "Before entry I moved my take-profit expectation from the original $1M target toward $2M." }, catalog(SNAPSHOT, "Before entry I moved my take-profit expectation from the original $1M target toward $2M.")),
    ],
    [
      "after-exit revision",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "After exiting I moved my target from the original $1M toward $2M." }, catalog(SNAPSHOT, "After exiting I moved my target from the original $1M toward $2M.")),
    ],
    [
      "unit-price revision",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "After entry I moved my token price target from the original $1M to $2M." }, catalog(SNAPSHOT, "After entry I moved my token price target from the original $1M to $2M.")),
    ],
    [
      "non-USD revised amount",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "After entry I moved my target from the original $1M to $2M EUR." }, catalog(SNAPSHOT, "After entry I moved my target from the original $1M to $2M EUR.")),
    ],
    [
      "negated change",
      () => detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: "After entry I never changed my target from the original $1M to $2M." }, catalog(SNAPSHOT, "After entry I never changed my target from the original $1M to $2M.")),
    ],
    [
      "catalog target does not match snapshot",
      () => detect(SNAPSHOT, OBSERVATIONS, catalog({ ...SNAPSHOT, intendedTakeProfitMarketCap: "10000001" })),
    ],
    [
      "predeclared conditional plan",
      () => detect({ ...SNAPSHOT, thesis: "If market cap reaches 1.6M I will raise my target to 2M" }),
    ],
    [
      "conflicting revisions",
      () => {
        const comments = "I didn't sell. I moved my take-profit expectation from the original $1M target toward $2M. I also changed my target from the original $1M to $3M.";
        return detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: comments }, catalog(SNAPSHOT, comments));
      },
    ],
    ["currency mismatch", () => detect(SNAPSHOT, { ...OBSERVATIONS, marketCapCurrency: "EUR" })],
    ["snapshot currency unknown", () => detect({ ...SNAPSHOT, marketCapCurrency: undefined })],
    ["bad uuid catalog ids", () => detect(SNAPSHOT, OBSERVATIONS, catalog(SNAPSHOT, COMMENTS, { source: "not-a-uuid", later: ID_OBSERVATIONS }))],
    [
      "absent catalog text",
      () => detect(SNAPSHOT, OBSERVATIONS, [{ id: ID_SNAPSHOT, kind: "user_input", text: "unrelated text" }]),
    ],
    [
      "self-assessment only",
      () => {
        const comments = "Self-assessment: I changed my take-profit target from the original $1M toward $2M.";
        return detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: comments }, catalog(SNAPSHOT, comments));
      },
    ],
  ];
  for (const [label, run] of cases) {
    assert.deepEqual(run(), [], `case ${label} must not emit a drift finding`);
  }
});

test("a revision clause ending in a sentence-final period still detects", () => {
  const comments = "After entry I moved my target from the original $1M to $2M.";
  const findings = detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: comments }, catalog(SNAPSHOT, comments));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].revisedPlan.value, "2000000");
  assert.equal(findings[0].ordering.basis, "explicit_user_statement");
});

test("expectation phrasing detects the same ordered revision", () => {
  const comments = "I failed to sell at 1.6m mcap cos i was thinking it would get to $2m when what i needed initially was $1m mcap.";
  const findings = detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: comments }, catalog(SNAPSHOT, comments));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].revisedPlan.value, "2000000");
  assert.equal(findings[0].ordering.basis, "explicit_user_statement");
});

test("an explicit after-entry lowered target yields a negative increase, never PnL", () => {
  const comments = "After entry I lowered my take-profit target from the original $1M to $500k.";
  const findings = detect(SNAPSHOT, { ...OBSERVATIONS, retrospectiveComments: comments }, catalog(SNAPSHOT, comments));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].revisedPlan.value, "500000");
  assert.equal(findings[0].metrics.targetIncreasePct, "-50");
});

test("unknown peak or exit leaves those drift metrics null", () => {
  const findings = detect(SNAPSHOT, { ...OBSERVATIONS, peakObservedMarketCap: undefined, exitMarketCap: undefined });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].metrics.peakVsOriginalTargetMultiple, null);
  assert.equal(findings[0].metrics.exitVsPeakMultiple, null);
  assert.equal(findings[0].metrics.exitVsOriginalTargetMultiple, null);
  assert.equal(findings[0].metrics.targetMovementMultiple, "2");
});

test("generic lessons are rejected; drift lessons need both refs and both caps", () => {
  const findings = detect();
  assert.throws(
    () => assertSpecificDriftLessons([{ text: "Stick to your plan.", evidenceRefs: [ID_SNAPSHOT, ID_OBSERVATIONS] }], findings),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  assert.throws(
    () => assertSpecificDriftLessons([{ text: "Do more research.", evidenceRefs: [ID_SNAPSHOT] }], findings),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  assert.throws(
    () => assertSpecificDriftLessons([{ text: "The reported target shifted from $1M to $2M while the user did not sell.", evidenceRefs: [ID_SNAPSHOT] }], findings),
    (e) => e instanceof AIError && e.code === "GROUNDING",
    "missing the second evidence ref must fail",
  );
  assert.throws(
    () => assertSpecificDriftLessons([{ text: "The plan changed over time.", evidenceRefs: [ID_SNAPSHOT, ID_OBSERVATIONS] }], findings),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  assertSpecificDriftLessons(
    [{ text: "The reported target shifted from $1M to $2M while the user did not sell.", evidenceRefs: [ID_SNAPSHOT, ID_OBSERVATIONS] }],
    findings,
  );
});

const ORDERING_QUOTE = "What happened: The token reached about $1.6M market cap, but I didn't sell because I started thinking it could reach $2M.";
const CHANGE_QUOTE = "What changed: I moved my take-profit expectation from the original $1M target toward $2M.";

function narrativeDimensions(overrides: Partial<Record<(typeof REVIEW_DIMENSIONS)[number], Record<string, unknown>>> = {}) {
  return REVIEW_DIMENSIONS.map((dimension) => ({
    dimension,
    score: null as number | null,
    explanation: "insufficient evidence",
    observedFacts: [] as { evidenceId: string; quote: string }[],
    inferredFindings: [] as { finding: string }[],
    ...overrides[dimension],
  }));
}

function narrativeValue(texts: { summary?: string; lessons?: string[] }, dimensions = narrativeDimensions()) {
  return {
    summary: texts.summary ?? "documented process review",
    lessons: (texts.lessons ?? []).map((text) => ({ text })),
    dimensions,
  };
}

test("drift narratives require attributed retrospection and deny unsupported financial cost", () => {
  const findings = detect();
  const rejects = (value: Parameters<typeof assertDriftNarratives>[0]) =>
    assert.throws(
      () => assertDriftNarratives(value, findings),
      (error) => error instanceof AIError && error.code === "GROUNDING",
    );
  rejects(narrativeValue({ summary: "Greed caused the change." }));
  rejects(narrativeValue({ summary: "Reflex diagnosed greedy trading." }));
  rejects(narrativeValue({ summary: "This illustrates the cost of target drift." }));
  rejects(narrativeValue({ lessons: ["Greed caused the change."] }));
  rejects(
    narrativeValue(
      {},
      narrativeDimensions({ risk_discipline: { inferredFindings: [{ finding: "Greed caused the change." }] } }),
    ),
  );
  assertDriftNarratives(narrativeValue({ summary: "The user retrospectively attributed the change partly to greed." }), findings);
  assertDriftNarratives(narrativeValue({ summary: "Market-cap movement does not establish realized return." }), findings);
  assertDriftNarratives(narrativeValue({ summary: "The user's retrospective attribution of the change to greed." }), findings);
  assertDriftNarratives(
    narrativeValue({ summary: "The user retrospectively self‑reported greed." }),
    findings,
  );
});

test("specific drift lesson matching survives typographic dashes without mutating the text", () => {
  const findings = detect();
  const lesson = { text: "The take‑profit shifted from $1M to $2M while the user did not sell.", evidenceRefs: [ID_SNAPSHOT, ID_OBSERVATIONS] };
  assertSpecificDriftLessons([lesson], findings);
  assert.ok(lesson.text.includes("‑"), "the original typographic dash is preserved");
  assert.throws(
    () =>
      assertSpecificDriftLessons(
        [{ ...lesson, evidenceRefs: [ID_SNAPSHOT] }],
        findings,
      ),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
});

test("scored execution and behavioral dimensions must quote the drift behavior clause", () => {
  const findings = detect();
  const scored = (dimension: string, quote: string) =>
    narrativeDimensions({
      [dimension]: {
        score: 40,
        observedFacts: [{ evidenceId: ID_OBSERVATIONS, quote }],
      },
    });
  assertDriftNarratives(narrativeValue({}, scored("execution_quality", ORDERING_QUOTE)), findings);
  assertDriftNarratives(narrativeValue({}, scored("behavioral_control", CHANGE_QUOTE)), findings);
  assert.throws(
    () =>
      assertDriftNarratives(
        narrativeValue({}, scored("execution_quality", "Eventual exit: I eventually sold around $585k market cap.")),
        findings,
      ),
    (error) => error instanceof AIError && error.code === "GROUNDING",
  );
  assert.throws(
    () =>
      assertDriftNarratives(
        narrativeValue(
          {},
          scored("behavioral_control", "Self-assessment: I think greed influenced me to change my take-profit range."),
        ),
        findings,
      ),
    (error) => error instanceof AIError && error.code === "GROUNDING",
  );
  assertDriftNarratives(
    narrativeValue(
      {},
      narrativeDimensions({
        research_quality: { score: 40, observedFacts: [{ evidenceId: ID_OBSERVATIONS, quote: ORDERING_QUOTE }] },
      }),
    ),
    findings,
  );
});

function allScores(value: number | null) {
  return {
    research_quality: value,
    context_awareness: value,
    risk_discipline: value,
    execution_quality: value,
    behavioral_control: value,
  };
}

test("policy v2 normalizes provisional scores at 70 percent coverage", () => {
  const quality = computeDecisionQuality({
    research_quality: 10,
    context_awareness: null,
    risk_discipline: 40,
    execution_quality: 45,
    behavioral_control: 30,
  });
  assert.equal(quality.evidenceCoveragePct, 80);
  assert.equal(quality.score, 29.6875);
  assert.equal(quality.overallScore, 29.6875);
  assert.equal(quality.status, "provisional");
  assert.equal(quality.minimumCoveragePct, 70);

  const full = computeDecisionQuality(allScores(100));
  assert.equal(full.status, "final");
  assert.equal(full.score, 100);

  const exactlySeventy = computeDecisionQuality({
    research_quality: 50,
    context_awareness: 50,
    risk_discipline: 50,
    execution_quality: null,
    behavioral_control: null,
  });
  assert.equal(exactlySeventy.evidenceCoveragePct, 70);
  assert.equal(exactlySeventy.score, 50);
  assert.equal(exactlySeventy.status, "provisional");

  const sixtyFive = computeDecisionQuality({
    research_quality: 50,
    context_awareness: null,
    risk_discipline: 50,
    execution_quality: null,
    behavioral_control: 50,
  });
  assert.equal(sixtyFive.evidenceCoveragePct, 65);
  assert.equal(sixtyFive.score, null);
  assert.equal(sixtyFive.status, "unassessed");

  const none = computeDecisionQuality(allScores(null));
  assert.equal(none.score, null);
  assert.equal(none.evidenceCoveragePct, 0);
  assert.equal(none.status, "unassessed");

  assert.throws(() => computeDecisionQuality({ ...allScores(50), research_quality: 101 }));
  assert.throws(() => computeDecisionQuality({ ...allScores(50), research_quality: 50.5 }));
});
