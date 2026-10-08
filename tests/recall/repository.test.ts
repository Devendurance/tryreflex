import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { EmbeddingProvider } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { computeSourceHash } from "../../src/server/db/validation";
import { RepositoryError } from "../../src/server/db/repositories";
import { RECALL_QUERIES } from "../../src/server/recall-queries";
import { buildRationale, ruleEquivalentKey } from "../../src/server/playbook-policy";
import type { RecallInput } from "../../src/server/recall-policy";
import { createRecallRepository } from "../../src/server/recall/repository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };

type Row = Record<string, unknown>;
type EnvSnapshot = Record<string, string | undefined>;

const D1 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333";
const E1 = "44444444-4444-4444-8444-444444444444";
const E2 = "55555555-5555-4555-8555-555555555555";
const P1 = "66666666-6666-4666-8666-666666666666";
const RL1 = "77777777-7777-4777-8777-777777777777";
const MEM_D = "88888888-8888-4888-8888-888888888888";
const MEM_R = "99999999-9999-4999-8999-999999999999";
const MEM_P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEM_L = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const INPUT: RecallInput = { text: "should I buy RUNNER now" };
const QUOTE = "original target was $1M then moved to $2M and did not sell";

function withEmbeddingEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prior: EnvSnapshot = {
    JINA_EMBEDDING_MODEL: process.env.JINA_EMBEDDING_MODEL,
    JINA_EMBEDDING_DIMENSIONS: process.env.JINA_EMBEDDING_DIMENSIONS,
  };
  process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
  process.env.JINA_EMBEDDING_DIMENSIONS = "1024";
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fakeEmbedder(counter: { calls: number } = { calls: 0 }): EmbeddingProvider {
  const single = async (text: string) => ({
    vector: new Array(1024).fill(0.01),
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText: text,
    sourceHash: computeSourceHash(text),
    metadata: {},
  });
  return {
    embedDocument: (text: string) => single(text),
    embedQuery: async (text: string) => {
      counter.calls += 1;
      return single(text);
    },
    embedMany: async (texts: readonly string[]) => Promise.all(texts.map(single)),
  };
}

function decisionRow(patch: Row = {}): Row {
  return {
    id: D1,
    user_id: USER_ID,
    asset_symbol: "RUNNER",
    asset_class: "crypto",
    raw_input: QUOTE,
    confirmed_snapshot: { knowledgeBasis: "confirmed_decision_user_report" },
    ...patch,
  };
}

const DRIFT = {
  type: "target_drift",
  status: "observed",
  evidenceBasis: "retrospective_user_report",
  evidenceRefs: [E1],
  originalPlan: { metric: "market_cap", currency: "USD", value: "1000000" },
  revisedPlan: { metric: "market_cap", currency: "USD", value: "2000000" },
  metrics: {},
  ordering: { basis: "explicit_user_statement", evidenceId: E1, quote: "moved to $2M and did not sell" },
  observedFacts: [{ evidenceId: E1, quote: "original target was $1M" }, { evidenceId: E1, quote: "moved to $2M" }],
  userSelfAssessment: [{ text: "I got greedy", evidenceRefs: [E1] }],
};

function reviewRow(patch: Row = {}): Row {
  return {
    id: R1,
    user_id: USER_ID,
    decision_id: D1,
    trade_id: null,
    is_current: true,
    version: 3,
    created_at: "2026-10-01T00:00:00.000Z",
    process_classification: null,
    observed_metrics: { tradeMetrics: { outcome: "unknown" }, planDrift: [DRIFT] },
    ai_inference: { evidenceCatalog: [{ id: E1, text: QUOTE }], dimensions: [] },
    ...patch,
  };
}

function searchRow(entityType: string, entityId: string, memoryId: string, similarity = 0.5, sourceHash = "hash-1"): Row {
  return { id: memoryId, entity_type: entityType, entity_id: entityId, similarity, source_hash: sourceHash };
}

function patternStats(count: number, highQualityCount: number, decisionIds: string[], reviewIds: string[], patch: Row = {}): Row {
  return {
    memorySourceHash: "hash-1",
    producer: "decision-dna.v1",
    active: true,
    feature: "weak research score 15",
    basis: "deterministic_server_policy",
    occurrenceCount: count,
    highQualityCount,
    establishedEligible: count >= 4 && highQualityCount >= 4,
    supportingDecisionIds: decisionIds,
    supportingReviewIds: reviewIds,
    evidenceRefs: [E1],
    ...patch,
  };
}

function patternRow(patch: Row = {}): Row {
  return {
    id: P1,
    user_id: USER_ID,
    kind: "leak",
    status: "observation",
    evidence_count: 1,
    description: "stored DNA fact about weak research",
    observed_statistics: patternStats(1, 0, [D1], [R1]),
    ...patch,
  };
}

interface FakeOptions {
  available?: unknown;
  search?: Row[];
  decisions?: Row[];
  currentReview?: Row[];
  origins?: Row[];
  decisionEvidence?: Row[];
  reviewRows?: Row[];
  reviewDecision?: Row[];
  planDriftEvidence?: Row[];
  patterns?: Row[];
  patternEvidence?: Row[];
  rules?: Row[];
  ruleEvidence?: Row[];
}

function fakeDb(options: FakeOptions = {}) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const decisions = options.decisions ?? [decisionRow()];
  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
      calls.push({ text, values });
      const rows = (list: Row[] | undefined, byId = true) =>
        (list ?? []).filter((row) => !byId || String(row.id) === String(values[1]));
      if (text === RECALL_QUERIES.available) return { rows: [{ available: options.available ?? true }] };
      if (text === RECALL_QUERIES.search) return { rows: options.search ?? [] };
      if (text === RECALL_QUERIES.decision) return { rows: rows(decisions) };
      if (text === RECALL_QUERIES.currentReview) return { rows: options.currentReview ?? [] };
      if (text === RECALL_QUERIES.origins) return { rows: options.origins ?? [] };
      if (text === RECALL_QUERIES.decisionEvidence) return { rows: options.decisionEvidence ?? [] };
      if (text === RECALL_QUERIES.pattern) return { rows: rows(options.patterns) };
      if (text === RECALL_QUERIES.patternEvidence) return { rows: options.patternEvidence ?? [] };
      if (text === RECALL_QUERIES.rule) return { rows: rows(options.rules) };
      if (text === RECALL_QUERIES.ruleEvidence) return { rows: options.ruleEvidence ?? [] };
      if (text.includes("FROM public.reviews WHERE")) return { rows: rows(options.reviewRows) };
      if (text.includes("FROM public.trades WHERE")) return { rows: [] };
      if (text.includes("FROM public.decisions WHERE")) return { rows: rows(options.reviewDecision ?? decisions) };
      if (text.includes("FROM public.review_dimensions")) return { rows: [] };
      if (text.includes("review_dimension_evidence")) return { rows: [] };
      if (text.includes("FROM public.evidence_records")) {
        const ids = values[1] as string[];
        return { rows: (options.planDriftEvidence ?? [{ id: E1, user_id: USER_ID }]).filter((row) => ids.includes(String(row.id))) };
      }
      throw new Error(`unexpected query: ${text}`);
  }
  const db: Queryable = {
    query: async <T = Row>(text: string, values: readonly unknown[] = []) => (await dispatch(text, values)) as { rows: T[] },
  };
  return { db: db as unknown as DbSession, calls };
}

function recall(input: RecallInput, db: DbSession, embedder = fakeEmbedder()) {
  return createRecallRepository(db, auth).recall(input, embedder);
}

test("unavailable memory returns empty data without embedding", () =>
  withEmbeddingEnv(async () => {
    const counter = { calls: 0 };
    const { db, calls } = fakeDb({ available: false });
    const data = await recall(INPUT, db, fakeEmbedder(counter));
    assert.equal(counter.calls, 0);
    assert.deepEqual(data, { history: [], patterns: [], rules: [], sources: [], truncated: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].values[0], USER_ID);
  }));

test("search params lock model, dimensions, owner, and limit", () =>
  withEmbeddingEnv(async () => {
    const { db, calls } = fakeDb({ search: [] });
    await recall(INPUT, db);
    const search = calls.find((call) => call.text === RECALL_QUERIES.search)!;
    assert.equal(search.values[0], USER_ID);
    assert.match(String(search.values[1]), /^\[(\d+(?:\.\d+)?,)*\d+(?:\.\d+)?\]$/);
    assert.equal(search.values[2], "jina-embeddings-v5-text-small");
    assert.equal(search.values[3], 1024);
    assert.equal(search.values[4], 20);
  }));

test("matches below minimum similarity are filtered out", () =>
  withEmbeddingEnv(async () => {
    const { db } = fakeDb({
      search: [searchRow("decision", D1, MEM_D, 0.19)],
      decisionEvidence: [{ id: E1, user_id: USER_ID, kind: "user_input" }],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.history.length, 0);
  }));

test("decision-only hit hydrates evidence, origins, and stays unknown outcome", () =>
  withEmbeddingEnv(async () => {
    const { db } = fakeDb({
      search: [searchRow("decision", D1, MEM_D)],
      origins: [
        { label: "pure_impulse", basis: "inference" },
        { label: "original_research", basis: "user_confirmed" },
        { label: "pure_impulse", basis: "market_data" },
      ],
      decisionEvidence: [
        { id: E1, user_id: USER_ID, kind: "user_input" },
        { id: E2, user_id: USER_ID, kind: "prior_decision" },
      ],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.history.length, 1);
    const history = data.history[0];
    assert.equal(history.decisionId, D1);
    assert.equal(history.reviewId, null);
    assert.equal(history.outcome, "unknown");
    assert.equal(history.rawInput, QUOTE);
    assert.equal(history.knowledgeBasis, "confirmed_decision_user_report");
    assert.deepEqual(history.origins, [
      { label: "pure_impulse", basis: "inference" },
      { label: "original_research", basis: "user_confirmed" },
    ]);
    assert.equal(history.lifecycle.status, "historical_decision");
    assert.deepEqual(history.evidenceRefs.sort(), [E1, E2].sort());
    assert.equal(history.matchedSources[0].memoryId, MEM_D);
  }));

test("decision-only hit without supported evidence refs is skipped", () =>
  withEmbeddingEnv(async () => {
    const { db } = fakeDb({ search: [searchRow("decision", D1, MEM_D)], decisionEvidence: [] });
    const data = await recall(INPUT, db);
    assert.equal(data.history.length, 0);
  }));

test("decision, review, and observations for one decision deduplicate to one history", () =>
  withEmbeddingEnv(async () => {
    const p1 = patternRow();
    const p2 = patternRow({ id: "66666666-6666-4666-8666-666666666667" });
    const p3 = patternRow({ id: "66666666-6666-4666-8666-666666666668" });
    const { db } = fakeDb({
      search: [
        searchRow("decision", D1, MEM_D, 0.9),
        searchRow("review", R1, MEM_R, 0.8),
        searchRow("pattern", P1, MEM_P, 0.7),
        searchRow("pattern", String(p2.id), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", 0.6),
        searchRow("pattern", String(p3.id), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac", 0.5),
      ],
      currentReview: [{ id: R1 }],
      reviewRows: [reviewRow()],
      patterns: [p1, p2, p3],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.history.length, 1);
    const history = data.history[0];
    assert.equal(history.reviewId, R1);
    assert.equal(history.planDrift.length, 1);
    assert.deepEqual(history.matchedSources.map((m) => m.memoryId).sort(), [MEM_D, MEM_R, MEM_P, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac"].sort());
    assert.equal(data.patterns.length, 3);
    assert.equal(data.patterns[0].status, "observation");
    assert.equal(data.patterns[0].evidenceCount, 1);
    assert.equal(history.lifecycle.status, "historical_review");
  }));

test("review hit without current review or confirmed decision yields no history", () =>
  withEmbeddingEnv(async () => {
    const { db } = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [reviewRow({ is_current: false })],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.history.length, 0);
  }));

test("pattern source hash mismatch and count mismatch fail closed", () =>
  withEmbeddingEnv(async () => {
    const stale = fakeDb({
      search: [searchRow("pattern", P1, MEM_P, 0.5, "other-hash")],
      patterns: [patternRow()],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, stale.db), (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT");
    const mismatched = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [patternRow({ evidence_count: 2 })],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, mismatched.db), RepositoryError);
    const missingLink = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [patternRow()],
      patternEvidence: [],
    });
    await assert.rejects(() => recall(INPUT, missingLink.db), RepositoryError);
  }));

test("ungrounded rule is excluded while active accepted rule is included", () =>
  withEmbeddingEnv(async () => {
    const rule = { id: RL1, user_id: USER_ID, title: "Set exit", trigger: "before entry", rule_text: "define exit", status: "active", user_decision: "accepted" };
    const empty = fakeDb({
      search: [searchRow("rule", RL1, MEM_L)],
      rules: [rule],
      ruleEvidence: [],
    });
    assert.equal((await recall(INPUT, empty.db)).rules.length, 0);
    const { db } = fakeDb({
      search: [searchRow("rule", RL1, MEM_L)],
      rules: [rule],
      ruleEvidence: [{ id: E1, user_id: USER_ID }],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.rules.length, 1);
    assert.deepEqual(data.rules[0].evidenceRefs, [E1]);
    assert.equal(data.rules[0].status, "active");
    assert.equal(data.rules[0].userDecision, "accepted");
    const nonexistent = fakeDb({ search: [searchRow("rule", RL1, MEM_L)], rules: [] });
    assert.equal((await recall(INPUT, nonexistent.db)).rules.length, 0);
  }));

test("foreign-owned hydration rows fail closed", () =>
  withEmbeddingEnv(async () => {
    const { db } = fakeDb({
      search: [searchRow("decision", D1, MEM_D)],
      decisions: [decisionRow({ user_id: "99999999-9999-4999-8999-999999999999" })],
      decisionEvidence: [{ id: E1, user_id: USER_ID, kind: "user_input" }],
    });
    await assert.rejects(() => recall(INPUT, db), (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT");
  }));

test("established and emerging stored statuses are preserved without recomputation", () =>
  withEmbeddingEnv(async () => {
    const ids4 = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const ids2 = Array.from({ length: 2 }, (_, i) => `00000000-0000-4000-8000-00000000001${i}`);
    const established = patternRow({
      status: "established",
      evidence_count: 4,
      observed_statistics: patternStats(4, 4, ids4, ids4.map((_, i) => `f0000000-0000-4000-8000-00000000000${i}`)),
    });
    const emerging = patternRow({
      id: "66666666-6666-4666-8666-666666666669",
      status: "emerging",
      evidence_count: 2,
      observed_statistics: patternStats(2, 1, ids2, ids2.map((_, i) => `e0000000-0000-4000-8000-00000000001${i}`)),
    });
    const { db } = fakeDb({
      search: [
        searchRow("pattern", P1, MEM_P, 0.6),
        searchRow("pattern", String(emerging.id), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae", 0.5),
      ],
      patterns: [established, emerging],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
      decisions: [],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.patterns.length, 2);
    assert.equal(data.patterns[0].status, "established");
    assert.equal(data.patterns[0].evidenceCount, 4);
    assert.equal(data.patterns[0].supportingDecisionIds.length, 4);
    assert.equal(data.patterns[1].status, "emerging");
    assert.equal(data.patterns[1].evidenceCount, 2);
  }));

test("inconsistent pattern lifecycle claims fail closed", () =>
  withEmbeddingEnv(async () => {
    const establishedOne = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [patternRow({ status: "established" })],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, establishedOne.db), (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT");
    const duplicates = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [patternRow({ observed_statistics: patternStats(1, 0, [D1, D1], [R1]) })],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, duplicates.db), RepositoryError);
    const mismatchedEligible = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [patternRow({ observed_statistics: patternStats(1, 0, [D1], [R1], { establishedEligible: true }) })],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, mismatchedEligible.db), RepositoryError);
  }));

test("malformed drift, quote mismatch, and unknown refs fail closed", () =>
  withEmbeddingEnv(async () => {
    const badShape = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [reviewRow({ observed_metrics: { tradeMetrics: { outcome: "unknown" }, planDrift: [{ type: "target_drift" }] } })],
    });
    await assert.rejects(() => recall(INPUT, badShape.db), RepositoryError);
    const quoteMismatch = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [
        reviewRow({
          observed_metrics: {
            tradeMetrics: { outcome: "unknown" },
            planDrift: [{ ...DRIFT, ordering: { ...DRIFT.ordering, quote: "not in the source text" } }],
          },
        }),
      ],
    });
    await assert.rejects(() => recall(INPUT, quoteMismatch.db), RepositoryError);
    const unknownRef = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [
        reviewRow({
          observed_metrics: {
            tradeMetrics: { outcome: "unknown" },
            planDrift: [{ ...DRIFT, evidenceRefs: [E1, E2] }],
          },
        }),
      ],
    });
    await assert.rejects(() => recall(INPUT, unknownRef.db), RepositoryError);
    const sourceOutsideRefs = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [
        reviewRow({
          observed_metrics: {
            tradeMetrics: { outcome: "unknown" },
            planDrift: [
              { ...DRIFT, ordering: { ...DRIFT.ordering, evidenceId: E2 } },
            ],
          },
        }),
      ],
      planDriftEvidence: [{ id: E1, user_id: USER_ID }],
    });
    await assert.rejects(() => recall(INPUT, sourceOutsideRefs.db), RepositoryError);
    const zeroTarget = fakeDb({
      search: [searchRow("review", R1, MEM_R)],
      reviewRows: [
        reviewRow({
          observed_metrics: {
            tradeMetrics: { outcome: "unknown" },
            planDrift: [{ ...DRIFT, revisedPlan: { ...DRIFT.revisedPlan, value: "0" } }],
          },
        }),
      ],
    });
    await assert.rejects(() => recall(INPUT, zeroTarget.db), RepositoryError);
  }));

test("more than ten supporting decisions truncates and keeps original counts", () =>
  withEmbeddingEnv(async () => {
    const manyIds = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`);
    const reviewIds = manyIds.map((_, index) => `f0000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`);
    const pattern = patternRow({
      status: "established",
      evidence_count: 12,
      observed_statistics: patternStats(12, 12, manyIds, reviewIds),
    });
    const { db } = fakeDb({
      search: [searchRow("pattern", P1, MEM_P)],
      patterns: [pattern],
      patternEvidence: [{ id: E1, user_id: USER_ID }],
      decisions: [],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.truncated, true);
    assert.equal(data.patterns[0].supportingDecisionIds.length, 12);
    assert.equal(data.patterns[0].evidenceCount, 12);
    assert.ok(data.history.length <= 10);
  }));

test("accepted playbook rule exposes validated provenance; malformed provenance fails closed", () =>
  withEmbeddingEnv(async () => {
    const validProvenance = {
      producer: "playbook.v1",
      templateId: "target_revision",
      equivalentKey: ruleEquivalentKey("target_revision", "f".repeat(64)),
      patternFingerprint: "f".repeat(64),
      sourcePatternId: P1,
      maturity: "experimental",
      sourceStatus: "observation",
      supportingDecisionCount: 1,
      highQualityCount: 0,
      establishedEligible: false,
      supportingDecisionIds: [D1],
      supportingReviewIds: [R1],
      evidenceRefs: [E1],
      observedBehavior: "Target drift observed once.",
      supportingFacts: [{ decisionId: D1, reviewId: R1, basis: "retrospective_user_report", observedFacts: [{ evidenceId: E1, quote: "moved to $2M" }] }],
      relevantMetrics: { decisionCount: 1, finalCount: 1, provisionalCount: 0, qualityUnassessedCount: 0 },
      evidenceStrength: "limited",
      scope: "single-decision observation, not recurrence",
      effectiveness: "unproven",
      financialBenefit: "unknown",
      confidence: null,
    };
    const rule = {
      id: RL1,
      user_id: USER_ID,
      title: "Document evidence for exit-target revisions",
      trigger: "Before entering a trade and before revising its exit target",
      rule_text:
        "Before entering a trade, record my intended exit target and the evidence that would justify revising it. When my original target is reached, review that evidence before changing the plan.",
      rationale: buildRationale(validProvenance.observedBehavior, validProvenance.scope),
      source_pattern_id: P1,
      status: "active",
      user_decision: "accepted",
    };
    const { db } = fakeDb({
      search: [searchRow("rule", RL1, MEM_L)],
      rules: [rule],
      ruleEvidence: [
        { id: E1, user_id: USER_ID, kind: "user_input" },
        { id: "99999999-9999-4999-8999-000000000001", user_id: USER_ID, kind: "playbook_rule", rule_id: RL1, label: JSON.stringify(validProvenance) },
      ],
    });
    const data = await recall(INPUT, db);
    assert.equal(data.rules.length, 1);
    assert.equal(data.rules[0].maturity, "experimental");
    assert.equal(data.rules[0].provenance?.effectiveness, "unproven");
    assert.equal(data.rules[0].rationale, buildRationale(validProvenance.observedBehavior, validProvenance.scope));
    assert.deepEqual(data.rules[0].evidenceRefs, [E1]);

    const malformed = fakeDb({
      search: [searchRow("rule", RL1, MEM_L)],
      rules: [rule],
      ruleEvidence: [
        { id: E1, user_id: USER_ID, kind: "user_input" },
        { id: "99999999-9999-4999-8999-000000000001", user_id: USER_ID, kind: "playbook_rule", rule_id: RL1, label: JSON.stringify({ ...validProvenance, maturity: "proven" }) },
      ],
    });
    await assert.rejects(() => recall(INPUT, malformed.db), RepositoryError);

    const legacy = fakeDb({
      search: [searchRow("rule", RL1, MEM_L)],
      rules: [{ ...rule, title: "Legacy", trigger: "t", rule_text: "r", rationale: null }],
      ruleEvidence: [{ id: E1, user_id: USER_ID, kind: "user_input" }],
    });
    const legacyData = await recall(INPUT, legacy.db);
    assert.equal(legacyData.rules[0].provenance, null);
    assert.equal(legacyData.rules[0].maturity, null);
  }));
