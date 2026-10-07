import assert from "node:assert/strict";
import test from "node:test";
import { genuineInputSchema, jarSchema, resolveVerificationSnapshot } from "../../scripts/verify-autopsy";
import { classifyProcessOutcome, computeSparseManualMetrics } from "../../src/server/review-policy";

const decisionText = "I looked at no evidence at all.";

const snapshot = {
  assetSymbol: "RUNNER",
  assetClass: "crypto" as const,
  side: "long" as const,
  knowledgeBasis: "retrospective_recollection" as const,
  intendedTakeProfitMarketCap: "1000000",
  marketCapCurrency: "USD",
  sources: [],
};

const trade = {
  symbol: "RUNNER",
  side: "long" as const,
  quantity: null,
  entryPrice: null,
  exitPrice: null,
  openedAt: null,
  closedAt: null,
  proceedsReceived: null,
  amountInvested: "20",
  fees: "10",
  entryMarketCap: "20000",
  exitMarketCap: "585000",
  peakObservedMarketCap: "1600000",
  marketCapCurrency: "USD",
  cashFlowBasis: "unknown" as const,
  executionState: "closed" as const,
  captureBasis: "retrospective" as const,
  retrospectiveComments: "I moved my take-profit expectation from the original $1M target toward $2M.",
};

const input = { decisionText, snapshot, trade };

test("genuine input schema preserves explicit nulls and omits nothing silently", () => {
  const parsed = genuineInputSchema.parse(input);
  assert.equal(parsed.trade.quantity, null);
  assert.equal(parsed.trade.entryPrice, null);
  assert.equal(parsed.trade.openedAt, null);
  assert.equal(parsed.trade.proceedsReceived, null);
  assert.equal(parsed.trade.amountInvested, "20");
  assert.equal(parsed.trade.fees, "10");
  assert.equal(parsed.trade.retrospectiveComments, trade.retrospectiveComments);
});

test("omitted optional trade fields remain undefined rather than zero or epoch", () => {
  const { quantity, entryPrice, fees, ...rest } = trade;
  void quantity;
  void entryPrice;
  void fees;
  const parsed = genuineInputSchema.parse({ ...input, trade: rest });
  assert.equal(parsed.trade.quantity, undefined);
  assert.equal(parsed.trade.entryPrice, undefined);
  assert.equal(parsed.trade.fees, undefined);
});

test("omitted snapshot origins resolve to supplied inferred labels only", () => {
  const resolved = resolveVerificationSnapshot(snapshot, ["social_confirmation", "pure_impulse"]);
  assert.deepEqual(resolved.origins, ["social_confirmation", "pure_impulse"]);
  assert.equal(resolved.origins.includes("original_research"), false);
});

test("supplied snapshot origins are retained over inference", () => {
  const resolved = resolveVerificationSnapshot({ ...snapshot, origins: ["pure_impulse"] }, ["original_research"]);
  assert.deepEqual(resolved.origins, ["pure_impulse"]);
});

test("empty or malformed origins are rejected", () => {
  assert.throws(() => resolveVerificationSnapshot({ ...snapshot, origins: [] }, ["social_confirmation"]));
  assert.throws(() => resolveVerificationSnapshot(snapshot, ["gut_feeling"]));
  assert.throws(() => resolveVerificationSnapshot(snapshot, []));
});

test("retrospective comments never enter the resolved snapshot or decision text", () => {
  const resolved = resolveVerificationSnapshot(snapshot, ["social_confirmation"]);
  assert.equal("retrospectiveComments" in resolved, false);
  assert.equal(Object.values(resolved).includes(trade.retrospectiveComments), false);
  assert.equal(input.decisionText.includes("take-profit"), false);
  assert.equal(decisionText, "I looked at no evidence at all.");
  assert.equal(
    genuineInputSchema.safeParse({ ...input, snapshot: { ...snapshot, retrospectiveComments: trade.retrospectiveComments } }).success,
    false,
  );
});

test("unknown keys in trade and snapshot are rejected", () => {
  assert.equal(genuineInputSchema.safeParse({ ...input, trade: { ...trade, bogus: "x" } }).success, false);
  assert.equal(genuineInputSchema.safeParse({ ...input, snapshot: { ...snapshot, bogus: "x" } }).success, false);
  assert.equal(genuineInputSchema.safeParse({ ...input, bogus: "x" }).success, false);
});

test("empty memoryQuery is rejected", () => {
  assert.equal(genuineInputSchema.safeParse({ ...input, memoryQuery: "" }).success, false);
  assert.equal(genuineInputSchema.safeParse({ ...input, memoryQuery: "   " }).success, false);
  assert.equal(genuineInputSchema.safeParse({ ...input, memoryQuery: "what did I remember" }).success, true);
});

test("sparse metrics keep market caps as valuation context with unknown outcome", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: null,
      closedAt: null,
      executionState: "closed",
      fees: "10",
      netRealizedPnl: null,
      amountInvested: "20",
      proceedsReceived: null,
      cashFlowBasis: "unknown",
      settlementCurrency: "USD",
      entryMarketCap: "20000",
      exitMarketCap: "585000",
      peakObservedMarketCap: "1600000",
      intendedTakeProfitMarketCap: "1000000",
      marketCapCurrency: "USD",
      captureBasis: "retrospective",
    },
    { confirmedAt: "2026-10-07T00:00:00Z", intendedEntry: null },
  );
  assert.equal(metrics.marketCapMovementMultiple, "29.25");
  assert.equal(metrics.peakMarketCapMovementMultiple, "80");
  assert.equal(metrics.netRealizedPnl, null);
  assert.equal(metrics.netReturnPct, null);
  assert.equal(metrics.grossPnl, null);
  assert.equal(metrics.outcome, "unknown");
  assert.equal(metrics.holdingDurationMs, null);
  assert.equal(classifyProcessOutcome(20, "unknown"), null);
});

test("jarSchema accepts string cookies and preserves them verbatim", () => {
  const jar = [
    { cookies: ["session=test-one", "other=abc"] },
    { cookies: ["session=test-two"] },
  ];
  const parsed = jarSchema.parse(jar);
  assert.deepEqual(parsed[0].cookies, ["session=test-one", "other=abc"]);
  assert.deepEqual(parsed[1].cookies, ["session=test-two"]);
});

test("jarSchema accepts {name,value} cookies and normalizes to name=value", () => {
  const jar = [
    { cookies: [{ name: "session", value: "test-one" }] },
    { cookies: [{ name: "session", value: "test-two" }, { name: "other", value: "x" }] },
  ];
  const parsed = jarSchema.parse(jar);
  assert.deepEqual(parsed[0].cookies, ["session=test-one"]);
  assert.deepEqual(parsed[1].cookies, ["session=test-two", "other=x"]);
});

test("jarSchema rejects CRLF cookie names and semicolon/CRLF values", () => {
  const badName = [
    { cookies: [{ name: "sess\r\nion", value: "ok" }] },
    { cookies: [{ name: "session", value: "ok" }] },
  ];
  const badValueSemicolon = [
    { cookies: [{ name: "session", value: "a;b" }] },
    { cookies: [{ name: "session", value: "ok" }] },
  ];
  const badValueCRLF = [
    { cookies: [{ name: "session", value: "a\r\nb" }] },
    { cookies: [{ name: "session", value: "ok" }] },
  ];
  assert.throws(() => jarSchema.parse(badName));
  assert.throws(() => jarSchema.parse(badValueSemicolon));
  assert.throws(() => jarSchema.parse(badValueCRLF));
});

test("jarSchema requires at least two records each with a nonempty cookie array", () => {
  assert.throws(() => jarSchema.parse([{ cookies: ["session=test-one"] }]));
  assert.throws(() => jarSchema.parse([{ cookies: ["session=test-one"] }, { cookies: [] }]));
});
