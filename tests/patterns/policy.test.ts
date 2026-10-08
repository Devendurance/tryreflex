import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDNAMemory,
  computeDecisionDNA,
  DNA_POLICY_VERSION,
  type DNAEvent,
} from "../../src/server/decision-dna-policy";
import { RepositoryError } from "../../src/server/db/repositories";
import { REVIEW_DIMENSIONS, type ReviewDimension } from "../../src/server/review-policy";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function dim(
  dimension: ReviewDimension,
  score: number | null,
  opts: { confidence?: number; refs?: string[]; facts?: { evidenceId: string; quote: string }[] } = {},
): DNAEvent["dimensions"][number] {
  return {
    dimension,
    score,
    confidence: opts.confidence ?? (score === null ? 0 : 0.9),
    evidenceRefs: opts.refs ?? [],
    observedFacts: opts.facts ?? [],
  };
}

function runnerScores(opts: { confidence?: number } = {}): DNAEvent["dimensions"] {
  const confidence = opts.confidence ?? 0.9;
  return [
    dim("research_quality", 15, { confidence, refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "bought because it was trending" }] }),
    dim("context_awareness", null),
    dim("risk_discipline", 55, { confidence, refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "original target was $1M" }] }),
    dim("execution_quality", 45, { confidence, refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "moved to $2M" }] }),
    dim("behavioral_control", 40, { confidence, refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "did not sell" }] }),
  ];
}

interface EventOptions {
  decisionId?: string;
  reviewId?: string;
  tradeId?: string;
  reviewedAt?: string;
  assetClass?: DNAEvent["assetClass"];
  origins?: DNAEvent["origins"];
  dimensions?: DNAEvent["dimensions"];
  drift?: boolean;
  sources?: DNAEvent["sources"];
  contexts?: DNAEvent["contexts"];
  outcome?: DNAEvent["outcome"];
  extraEvidence?: DNAEvent["evidence"];
}

function makeEvent(opts: EventOptions = {}): DNAEvent {
  const decisionId = opts.decisionId ?? "decision-1";
  const reviewId = opts.reviewId ?? `review-${decisionId}`;
  const tradeId = opts.tradeId ?? `trade-${decisionId}`;
  const evidence: DNAEvent["evidence"] = [
    { id: "ev-review", userId: USER_ID, kind: "prior_review", text: "Owned completed decision autopsy", reviewId },
    {
      id: "ev-decision",
      userId: USER_ID,
      kind: "user_input",
      decisionId,
      text: "bought because it was trending, original target was $1M then moved to $2M and did not sell",
    },
    ...(opts.extraEvidence ?? []),
  ];
  return {
    userId: USER_ID,
    decisionId,
    reviewId,
    tradeId,
    reviewedAt: opts.reviewedAt ?? "2026-10-01T00:00:00.000Z",
    reviewEvidenceId: "ev-review",
    assetClass: opts.assetClass === undefined ? "crypto" : opts.assetClass,
    assetSymbol: "RUNNER",
    origins: opts.origins ?? [{ label: "pure_impulse", basis: "inference", confidence: 0.9 }],
    dimensions: opts.dimensions ?? runnerScores(),
    evidence,
    planDrift:
      opts.drift === false
        ? []
        : [
            {
              type: "target_drift",
              status: "observed",
              evidenceBasis: "retrospective_user_report",
              evidenceRefs: ["ev-decision"],
              observedFacts: [
                { evidenceId: "ev-decision", quote: "original target was $1M" },
                { evidenceId: "ev-decision", quote: "moved to $2M" },
              ],
              ordering: { evidenceId: "ev-decision", quote: "then moved to $2M and did not sell" },
            },
          ],
    sources: opts.sources ?? [],
    contexts: opts.contexts ?? [],
    outcome: opts.outcome ?? "unknown",
  };
}

function fingerprints(result: ReturnType<typeof computeDecisionDNA>) {
  return result.candidates.map((candidate) => `${candidate.category}:${candidate.status}`);
}

test("single RUNNER-like review produces only observations and counts unknown outcome", () => {
  const result = computeDecisionDNA(USER_ID, [makeEvent()]);
  assert.equal(fingerprints(result).every((fingerprint) => fingerprint.endsWith(":observation")), true);
  const categories = result.candidates.map((candidate) => candidate.category).sort();
  assert.deepEqual(categories, ["execution", "influence", "leak"]);
  assert.equal(result.evidenceStats.independentDecisionCount, 1);
  assert.equal((result.evidenceStats.knownOutcomes as Record<string, number>).unknown, 1);
  assert.equal(result.candidates.every((candidate) => candidate.confidence === null), true);
});

test("two or three comparable supports produce emerging, never established", () => {
  for (const count of [2, 3]) {
    const events = Array.from({ length: count }, (_, i) => makeEvent({ decisionId: `decision-${i}`, reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
    const result = computeDecisionDNA(USER_ID, events);
    assert.ok(result.candidates.length > 0);
    assert.equal(result.candidates.every((candidate) => candidate.status === "emerging"), true);
  }
});

test("four high-quality supports establish; four low-confidence or low-coverage supports stay emerging", () => {
  const established = computeDecisionDNA(
    USER_ID,
    Array.from({ length: 4 }, (_, i) => makeEvent({ decisionId: `d${i}`, reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z` })),
  );
  assert.equal(established.candidates.find((candidate) => candidate.category === "leak")?.status, "established");
  assert.equal(established.candidates.find((candidate) => candidate.category === "execution")?.status, "established");
  assert.equal(established.candidates.find((candidate) => candidate.category === "influence")?.status, "emerging");

  const lowConfidence = computeDecisionDNA(
    USER_ID,
    Array.from({ length: 4 }, (_, i) =>
      makeEvent({ decisionId: `d${i}`, reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z`, dimensions: runnerScores({ confidence: 0.5 }) }),
    ),
  );
  const leak = lowConfidence.candidates.find((candidate) => candidate.category === "leak");
  assert.equal(leak?.status, "emerging");
});

test("low-coverage reviews cannot establish quality-gated patterns", () => {
  const lowCoverageDimensions: DNAEvent["dimensions"] = [
    dim("research_quality", 15, { refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "bought because it was trending" }] }),
    dim("context_awareness", null),
    dim("risk_discipline", null),
    dim("execution_quality", 45, { refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "moved to $2M" }] }),
    dim("behavioral_control", 40, { refs: ["ev-decision"], facts: [{ evidenceId: "ev-decision", quote: "did not sell" }] }),
  ];
  const result = computeDecisionDNA(
    USER_ID,
    Array.from({ length: 4 }, (_, i) =>
      makeEvent({ decisionId: `d${i}`, reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z`, dimensions: lowCoverageDimensions, drift: false }),
    ),
  );
  const leak = result.candidates.find((candidate) => candidate.category === "leak");
  assert.equal(leak?.status, "emerging");
});

test("inferred origins alone cannot establish; user-confirmed origins can", () => {
  const inferred = computeDecisionDNA(
    USER_ID,
    Array.from({ length: 4 }, (_, i) =>
      makeEvent({ decisionId: `d${i}`, reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z` }),
    ),
  );
  const inferredInfluence = inferred.candidates.find((candidate) => candidate.category === "influence");
  assert.equal(inferredInfluence?.status, "emerging");

  const confirmed = computeDecisionDNA(
    USER_ID,
    Array.from({ length: 4 }, (_, i) =>
      makeEvent({
        decisionId: `d${i}`,
        reviewedAt: `2026-10-0${i + 1}T00:00:00.000Z`,
        origins: [{ label: "pure_impulse", basis: "user_confirmed", confidence: null }],
      }),
    ),
  );
  const confirmedInfluence = confirmed.candidates.find((candidate) => candidate.category === "influence");
  assert.equal(confirmedInfluence?.status, "established");
});

test("multiple reviews of one decision keep only the latest review as support", () => {
  const result = computeDecisionDNA(USER_ID, [
    makeEvent({ reviewId: "old-review", reviewedAt: "2026-10-01T00:00:00.000Z" }),
    makeEvent({ reviewId: "new-review", reviewedAt: "2026-10-02T00:00:00.000Z" }),
  ]);
  assert.equal(result.evidenceStats.independentDecisionCount, 1);
  assert.equal(result.evidenceStats.eligibleReviewCount, 2);
  assert.equal(result.evidenceStats.supersededOrSameDecisionReviewsExcluded, 1);
  for (const candidate of result.candidates) {
    assert.equal(candidate.evidenceCount, 1);
    assert.equal(candidate.status, "observation");
    assert.deepEqual(candidate.observedStatistics.supportingReviewIds, ["new-review"]);
  }
});

test("missing origins or asset class produce no cohort-grouped candidates", () => {
  const noAsset = computeDecisionDNA(USER_ID, [makeEvent({ assetClass: null })]);
  assert.equal(noAsset.candidates.length, 0);
  const noOrigins = computeDecisionDNA(USER_ID, [makeEvent({ origins: [] })]);
  assert.equal(noOrigins.candidates.length, 0);
});

test("different asset class, origins, or source type form separate fingerprints", () => {
  const stock = computeDecisionDNA(USER_ID, [makeEvent({ assetClass: "stock" })]);
  const crypto = computeDecisionDNA(USER_ID, [makeEvent({ assetClass: "crypto" })]);
  const stockPrints = new Set(stock.candidates.map((candidate) => candidate.fingerprint));
  assert.equal(crypto.candidates.some((candidate) => stockPrints.has(candidate.fingerprint)), false);

  const otherOrigin = computeDecisionDNA(USER_ID, [makeEvent({ origins: [{ label: "original_research", basis: "inference", confidence: 0.9 }] })]);
  const originPrints = new Set(otherOrigin.candidates.map((candidate) => candidate.fingerprint));
  assert.equal(crypto.candidates.some((candidate) => originPrints.has(candidate.fingerprint)), false);
});

test("exact aggregate statistics and occurrence denominators", () => {
  const events = [
    makeEvent({ decisionId: "a", reviewedAt: "2026-10-01T00:00:00.000Z" }),
    makeEvent({ decisionId: "b", reviewedAt: "2026-10-02T00:00:00.000Z" }),
    makeEvent({ decisionId: "c", reviewedAt: "2026-10-03T00:00:00.000Z" }),
    makeEvent({ decisionId: "d", reviewedAt: "2026-10-04T00:00:00.000Z", origins: [{ label: "original_research", basis: "user_confirmed", confidence: 1 }] }),
  ];
  const result = computeDecisionDNA(USER_ID, events);
  const impulse = result.candidates.find((candidate) => candidate.observedStatistics.feature === "pure_impulse");
  assert.ok(impulse);
  assert.equal(impulse.observedStatistics.occurrenceCount, 3);
  assert.equal(impulse.observedStatistics.comparableCount, 4);
  assert.equal(impulse.observedStatistics.occurrencePct, "75");
  const stats = impulse.observedStatistics.supporting as Record<string, unknown>;
  assert.equal(stats.averageDecisionQuality, "37.8125");
  assert.equal(stats.medianDecisionQuality, "37.8125");
  assert.equal(stats.averageEvidenceCoveragePct, "80");
  assert.equal(stats.qualityUnassessedCount, 0);
  const dims = stats.dimensions as Record<string, { average: string | null; assessedCount: number }>;
  assert.equal(dims.research_quality.average, "15");
  assert.equal(dims.context_awareness.assessedCount, 0);
});

test("source identity candidates count only cohort-matching comparable events", () => {
  const withSource = makeEvent({
    decisionId: "a",
    sources: [{ id: "s1", sourceType: "url", url: "https://example.com/article" }],
    extraEvidence: [{ id: "ev-src", userId: USER_ID, kind: "source", sourceId: "s1", text: "shared source" }],
  });
  const without = makeEvent({ decisionId: "b" });
  const result = computeDecisionDNA(USER_ID, [withSource, without]);
  const sourceCandidate = result.candidates.find((candidate) => candidate.observedStatistics.basis === "recorded_source_identity");
  assert.ok(sourceCandidate);
  assert.equal(sourceCandidate.observedStatistics.occurrenceCount, 1);
  assert.equal(sourceCandidate.observedStatistics.comparableCount, 1);
});

test("outcome counts reflect only known outcomes", () => {
  const result = computeDecisionDNA(USER_ID, [
    makeEvent({ decisionId: "a", outcome: "positive" }),
    makeEvent({ decisionId: "b", outcome: "negative" }),
    makeEvent({ decisionId: "c", outcome: "break_even" }),
    makeEvent({ decisionId: "d", outcome: "unknown" }),
  ]);
  assert.deepEqual(result.evidenceStats.knownOutcomes, { positive: 1, negative: 1, breakEven: 1, unknown: 1 });
});

test("missing or unverified context produces no regime candidates", () => {
  const none = computeDecisionDNA(USER_ID, [makeEvent({ contexts: [] })]);
  assert.equal(none.candidates.some((candidate) => candidate.category === "regime"), false);

  const regime = computeDecisionDNA(USER_ID, [
    makeEvent({
      contexts: [{ id: "ctx-1", verifiedDecisionTime: true, nativeMarketState: "open", regime: "high_volatility" }],
      extraEvidence: [{ id: "ev-ctx", userId: USER_ID, kind: "market_data", contextSnapshotId: "ctx-1", text: "snapshot" }],
      drift: false,
      dimensions: REVIEW_DIMENSIONS.map((name) => dim(name, null)),
    }),
  ]);
  assert.equal(regime.candidates.filter((candidate) => candidate.category === "regime").length, 2);

  const unverified = computeDecisionDNA(USER_ID, [
    makeEvent({
      contexts: [{ id: "ctx-1", verifiedDecisionTime: false, nativeMarketState: "open", regime: "high_volatility" }],
      extraEvidence: [{ id: "ev-ctx", userId: USER_ID, kind: "market_data", contextSnapshotId: "ctx-1", text: "snapshot" }],
      drift: false,
      dimensions: REVIEW_DIMENSIONS.map((name) => dim(name, null)),
    }),
  ]);
  assert.equal(unverified.candidates.some((candidate) => candidate.category === "regime"), false);
});

test("malformed events fail closed instead of producing patterns", () => {
  assert.throws(() => computeDecisionDNA(USER_ID, [makeEvent({ reviewedAt: "not-a-date" })]), RepositoryError);
  const foreign = makeEvent();
  foreign.evidence.push({ id: "foreign-ev", userId: "other-user", kind: "user_input", decisionId: "decision-1", text: "x" });
  const badQuote = makeEvent();
  badQuote.dimensions = runnerScores();
  badQuote.dimensions[0].observedFacts = [{ evidenceId: "ev-decision", quote: "a quote that is not in the evidence text" }];
  assert.throws(() => computeDecisionDNA(USER_ID, [badQuote]), RepositoryError);
  const badLabel = makeEvent({ origins: [{ label: "made_up_origin", basis: "inference", confidence: 0.5 }] });
  assert.throws(() => computeDecisionDNA(USER_ID, [badLabel]), RepositoryError);
  const ungroundedNull = makeEvent();
  ungroundedNull.dimensions[1] = dim("context_awareness", null, { confidence: 0.5 });
  assert.throws(() => computeDecisionDNA(USER_ID, [ungroundedNull]), RepositoryError);
});

test("buildDNAMemory freezes deterministic stats into the hash source", () => {
  const [candidate] = computeDecisionDNA(USER_ID, [makeEvent()]).candidates;
  const memory = buildDNAMemory(candidate);
  assert.equal(memory.version.length > 0, true);
  assert.match(memory.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(memory.text.includes(DNA_POLICY_VERSION));
  assert.ok(memory.text.includes(candidate.fingerprint));
  assert.ok(memory.text.includes("kind: pattern"));
});
