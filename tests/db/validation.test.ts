import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonSecretConfig,
  computeSourceHash,
  decisionSnapshotSchema,
  draftDecisionSchema,
  httpUrlSchema,
  recordEvidenceSchema,
  recordProviderConnectionSchema,
  recordTradeSchema,
  storeEmbeddingSchema,
  validateEmbedding,
} from "../../src/server/db/validation";

const VALID_SNAPSHOT = {
  assetSymbol: "BTC",
  assetClass: "crypto",
  side: "long",
  origins: ["original_research"],
  sources: [],
};

test("snapshot schema accepts minimal valid payload", () => {
  const parsed = decisionSnapshotSchema.safeParse(VALID_SNAPSHOT);
  assert.ok(parsed.success);
});

test("snapshot schema rejects missing/empty origins", () => {
  const noOrigins = { ...VALID_SNAPSHOT, origins: undefined };
  assert.ok(!decisionSnapshotSchema.safeParse(noOrigins).success);
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, origins: [] }).success);
});

test("snapshot schema rejects bad enum, extra keys, bad ranges", () => {
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, assetClass: "forex" }).success);
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, extra: 1 }).success);
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, confidence: 1.5 }).success);
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, intendedEntry: -3 }).success);
  assert.ok(!decisionSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, intendedRiskPct: 120 }).success);
});

test("source URL must be http/https without embedded credentials", () => {
  assert.ok(httpUrlSchema.safeParse("https://example.com/a").success);
  assert.ok(!httpUrlSchema.safeParse("ftp://example.com").success);
  assert.ok(!httpUrlSchema.safeParse("https://user:pass@example.com").success);
  assert.ok(!httpUrlSchema.safeParse("not a url").success);
});

test("snapshot source entry validates URL and sourceType", () => {
  const bad = { ...VALID_SNAPSHOT, sources: [{ sourceType: "rss", label: "x" }] };
  assert.ok(!decisionSnapshotSchema.safeParse(bad).success);
  const good = {
    ...VALID_SNAPSHOT,
    sources: [{ sourceType: "news", label: "article", url: "https://ex.com" }],
  };
  assert.ok(decisionSnapshotSchema.safeParse(good).success);
});

test("draft schema rejects blank raw input and extra keys but preserves bytes", () => {
  assert.ok(!draftDecisionSchema.safeParse({ rawInput: "   " }).success);
  assert.ok(!draftDecisionSchema.safeParse({ rawInput: "x", bogus: true }).success);
  const parsed = draftDecisionSchema.safeParse({ rawInput: "  thinking about BTC\n" });
  assert.ok(parsed.success);
  assert.equal(parsed.data.rawInput, "  thinking about BTC\n");
});

test("validateEmbedding enforces length, float32 fit, and nonzero norm", () => {
  const good = new Array(1024).fill(0);
  good[0] = 1;
  assert.deepEqual(validateEmbedding(good), { valid: true });
  assert.equal(validateEmbedding(new Array(10).fill(1)).valid, false);
  assert.equal(validateEmbedding(new Array(1024).fill(Number.NaN)).valid, false);
  assert.equal(validateEmbedding(new Array(1024).fill(0)).valid, false);
  const beyondFloat32 = new Array(1024).fill(0);
  beyondFloat32[0] = 1e39;
  assert.equal(validateEmbedding(beyondFloat32).valid, false);
  const underflowZeros = new Array(1024).fill(1e-46);
  assert.equal(validateEmbedding(underflowZeros).valid, false);
});

test("trade schema requires decimal strings and chronological bounds", () => {
  const base = {
    provider: "manual" as const,
    symbol: "BTC",
    side: "long" as const,
    quantity: "1",
    entryPrice: "60000",
    openedAt: "2026-01-01T00:00:00Z",
  };
  assert.ok(recordTradeSchema.safeParse(base).success);
  assert.ok(recordTradeSchema.safeParse({ ...base, realizedPnl: "-12.5" }).success);
  assert.ok(!recordTradeSchema.safeParse({ ...base, quantity: 1 }).success);
  assert.ok(!recordTradeSchema.safeParse({ ...base, quantity: "1.0000000000001" }).success);
  assert.ok(!recordTradeSchema.safeParse({ ...base, quantity: "1e-3" }).success);
  assert.ok(
    !recordTradeSchema.safeParse({ ...base, closedAt: "2025-12-31T00:00:00Z" }).success,
  );
});

test("computeSourceHash returns sha256 hex", () => {
  const hash = computeSourceHash("hello");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(computeSourceHash("hello"), hash);
});

test("assertNonSecretConfig rejects secret-looking fields at any depth", () => {
  assert.throws(() => assertNonSecretConfig({ apiKey: "x" }));
  assert.throws(() => assertNonSecretConfig({ nested: { deep: { secret: "x" } } }));
  assert.throws(() => assertNonSecretConfig({ list: [{ accessToken: "x" }] }));
  assertNonSecretConfig({ region: "eu", endpointVersion: "v2", nested: { flag: true } });
});

test("json object boundary rejects non-JSON values", () => {
  const base = { provider: "groq", status: "configured" as const };
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: { bad: undefined } }).success);
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: { fn: () => {} } }).success);
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: { n: Number.NaN } }).success);
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: { n: Infinity } }).success);
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: { b: BigInt(1) } }).success);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.ok(!recordProviderConnectionSchema.safeParse({ ...base, config: circular }).success);
  assert.ok(recordProviderConnectionSchema.safeParse({ ...base, config: { ok: { nested: [1, "x", null, true] } } }).success);
});

test("evidence schema shape only; kind-specific FK enforced by repository", () => {
  assert.ok(recordEvidenceSchema.safeParse({ kind: "user_input", decisionId: "123e4567-e89b-42d3-a456-426614174000" }).success);
  assert.ok(!recordEvidenceSchema.safeParse({ kind: "bogus" }).success);
});

test("embedding schema enforces entity enum and uuid entity id", () => {
  assert.ok(
    !storeEmbeddingSchema.safeParse({
      entityType: "widget",
      entityId: "123e4567-e89b-42d3-a456-426614174000",
      embedding: [],
      sourceText: "x",
    }).success,
  );
  assert.ok(
    !storeEmbeddingSchema.safeParse({
      entityType: "decision",
      entityId: "no",
      embedding: [],
      sourceText: "x",
    }).success,
  );
});
