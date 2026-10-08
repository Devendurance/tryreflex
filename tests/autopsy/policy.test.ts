import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_DIMENSIONS,
  classifyProcessOutcome,
  computeDecisionQuality,
  computeTradeMetrics,
} from "../../src/server/review-policy";

const decision = { confirmedAt: "2026-10-07T00:00:00.000Z", intendedEntry: null };

function longTrade(overrides: Partial<Parameters<typeof computeTradeMetrics>[0]> = {}) {
  return {
    quantity: "0.1",
    entryPrice: "100",
    exitPrice: "110",
    side: "long" as const,
    openedAt: "2026-10-08T00:00:00.000Z",
    closedAt: "2026-10-09T00:00:00.000Z",
    fees: "0.2",
    netRealizedPnl: null,
    calculationBasis: "linear_base_quantity" as const,
    ...overrides,
  };
}

test("long trade computes exact gross, net, and percent", () => {
  const metrics = computeTradeMetrics(longTrade(), decision);
  assert.equal(metrics.grossPnl, "1");
  assert.equal(metrics.netRealizedPnl, "0.8");
  assert.equal(metrics.netReturnPct, "8");
  assert.equal(metrics.netPnlBasis, "computed_linear_net");
  assert.equal(metrics.outcome, "positive");
});

test("short trade computes exact net and return", () => {
  const metrics = computeTradeMetrics(
    longTrade({ quantity: "2", exitPrice: "90", side: "short", fees: "1" }),
    decision,
  );
  assert.equal(metrics.netRealizedPnl, "19");
  assert.equal(metrics.netReturnPct, "9.5");
});

test("unknown fees without supplied net leaves outcome unknown with gross available", () => {
  const metrics = computeTradeMetrics(longTrade({ fees: null }), decision);
  assert.equal(metrics.grossPnl, "1");
  assert.equal(metrics.netRealizedPnl, null);
  assert.equal(metrics.netPnlBasis, "unavailable");
  assert.equal(metrics.outcome, "unknown");
});

test("open trade has unknown outcome even when net is supplied", () => {
  const metrics = computeTradeMetrics(
    longTrade({ closedAt: null, exitPrice: null, netRealizedPnl: "5" }),
    decision,
  );
  assert.equal(metrics.outcome, "unknown");
  assert.equal(metrics.netRealizedPnl, null);
});

test("entry before confirmation is retrospective with negative timing delta", () => {
  const metrics = computeTradeMetrics(longTrade({ openedAt: "2026-10-06T00:00:00.000Z" }), decision);
  assert.equal(metrics.captureTiming, "retrospective");
  assert.ok(metrics.entryAfterConfirmationMs < 0);
});

test("supplied net is authoritative and never recomputed", () => {
  const metrics = computeTradeMetrics(longTrade({ netRealizedPnl: "7.5" }), decision);
  assert.equal(metrics.netRealizedPnl, "7.5");
  assert.equal(metrics.netPnlBasis, "supplied_net");
});

function allScores(value: number | null) {
  return Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d, value])) as Record<
    (typeof REVIEW_DIMENSIONS)[number],
    number | null
  >;
}

test("all scores 70 yields overall 70 and good-process classifications", () => {
  const quality = computeDecisionQuality(allScores(70));
  assert.equal(quality.overallScore, 70);
  assert.equal(quality.status, "final");
  assert.equal(classifyProcessOutcome(quality.overallScore, "positive"), "earned_win");
  assert.equal(classifyProcessOutcome(quality.overallScore, "negative"), "good_decision_bad_outcome");
});

test("all scores 69 yields weak-process classifications", () => {
  const quality = computeDecisionQuality(allScores(69));
  assert.equal(quality.overallScore, 69);
  assert.equal(classifyProcessOutcome(quality.overallScore, "positive"), "lucky_escape");
  assert.equal(classifyProcessOutcome(quality.overallScore, "negative"), "deserved_loss");
});

test("a null dimension above the coverage floor yields a normalized provisional score", () => {
  const scores = allScores(80);
  scores.behavioral_control = null;
  const quality = computeDecisionQuality(scores);
  assert.equal(quality.score, 80);
  assert.equal(quality.overallScore, 80);
  assert.equal(quality.evidenceCoveragePct, 85);
  assert.equal(quality.coveragePct, 85);
  assert.equal(quality.status, "provisional");
});

test("coverage below 70 percent keeps the score null and unassessed", () => {
  const scores = allScores(80);
  scores.context_awareness = null;
  scores.execution_quality = null;
  const quality = computeDecisionQuality(scores);
  assert.equal(quality.score, null);
  assert.equal(quality.overallScore, null);
  assert.equal(quality.status, "unassessed");
  assert.equal(quality.evidenceCoveragePct, 65);
});

test("invalid scores are rejected", () => {
  assert.throws(() => computeDecisionQuality(allScores(101)));
  assert.throws(() => computeDecisionQuality(allScores(-1)));
  assert.throws(() => computeDecisionQuality(allScores(70.5)));
  assert.throws(() => classifyProcessOutcome(101, "positive"));
});

test("classification is null for unknown and break-even outcomes", () => {
  assert.equal(classifyProcessOutcome(80, "unknown"), null);
  assert.equal(classifyProcessOutcome(80, "break_even"), null);
});
