import assert from "node:assert/strict";
import test from "node:test";
import { AIError } from "../../src/server/ai/errors";
import type { GenerationResult, LLMProvider, StructuredGenerationRequest } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { RepositoryError } from "../../src/server/db/repositories";
import { REVIEW_DIMENSIONS } from "../../src/server/review-policy";
import { createReviewRepository } from "../../src/server/reviews/repository";
import { generateReview, getReview, type AutopsyResult } from "../../src/server/reviews/service";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const TRADE_ID = "423e4567-e89b-42d3-a456-426614174000";
const REVIEW_ID = "523e4567-e89b-42d3-a456-426614174000";
const EV_INPUT = "623e4567-e89b-42d3-a456-426614174001";
const EV_SNAPSHOT = "623e4567-e89b-42d3-a456-426614174002";
const EV_METRIC = "623e4567-e89b-42d3-a456-426614174003";
const EV_FOREIGN = "623e4567-e89b-42d3-a456-426614174099";

const RAW_INPUT = "bought BTCUSDT after checking funding and open interest";

const auth = { userId: USER_ID, provider: "neon-auth", subject: "sub-1" };

const EV_TRADE = "623e4567-e89b-42d3-a456-426614174004";

const tradeRow = {
  id: TRADE_ID,
  user_id: USER_ID,
  decision_id: DECISION_ID,
  provider: "bitget",
  symbol: "BTCUSDT",
  side: "long",
  quantity: "0.1",
  entry_price: "100",
  exit_price: "110",
  fees: "0.2",
  realized_pnl: "-4.5",
  opened_at: new Date("2026-10-05T00:00:00.123Z"),
  closed_at: new Date("2026-10-06T00:00:00.456Z"),
};

const decisionRow = {
  id: DECISION_ID,
  user_id: USER_ID,
  status: "confirmed",
  raw_input: RAW_INPUT,
  confirmed_snapshot: { assetSymbol: "BTCUSDT", assetClass: "crypto", side: "long", thesis: "momentum continuation", intendedEntry: 99.5, intendedRiskPct: 1.25, confidence: 0.7, origins: ["original_research"], sources: [] },
  confirmed_at: new Date("2026-10-04T00:00:00.000Z"),
  created_at: new Date("2026-10-04T00:00:00.000Z"),
};

function dimension(score: number | null, overrides: Record<string, unknown> = {}) {
  const dim = REVIEW_DIMENSIONS[0];
  return {
    dimension: dim,
    score,
    explanation: "documented rationale",
    confidence: score === null ? 0 : 0.8,
    evidenceRefs: score === null ? [] : [EV_INPUT],
    observedFacts: score === null ? [] : [{ evidenceId: EV_INPUT, quote: "bought BTCUSDT" }],
    inferredFindings: [],
    ...overrides,
  };
}

function autopsy(overrides: Partial<AutopsyResult> = {}): AutopsyResult {
  return {
    dimensions: REVIEW_DIMENSIONS.map((d) =>
      dimension(75, { dimension: d }),
    ),
    summary: "documented process review",
    lessons: [{ text: "verify invalidation before entry", evidenceRefs: [EV_INPUT] }],
    ...overrides,
  };
}

function fakeLlm(value: AutopsyResult | Error, capture?: { requests: StructuredGenerationRequest<unknown>[] }): LLMProvider {
  return {
    generateText: async () => {
      throw new Error("unused");
    },
    async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<GenerationResult<T>> {
      capture?.requests.push(request as StructuredGenerationRequest<unknown>);
      if (value instanceof Error) throw value;
      if (request.validate) request.validate(value as T);
      return {
        value: value as T,
        provider: "groq",
        model: "test-model",
        promptVersion: request.promptVersion,
        runId: "run-1",
        attempts: 1,
      };
    },
  };
}

function fakeRepo(overrides: Record<string, unknown> = {}) {
  const persisted: unknown[] = [];
  const ensured: Record<string, string> = {
    "Decision raw input": EV_INPUT,
    "Confirmed decision snapshot": EV_SNAPSHOT,
    "Deterministic process metrics trade-metrics.v1": EV_METRIC,
    "Trade attachment and execution summary": EV_TRADE,
    "Origin (user-confirmed): original_research": "623e4567-e89b-42d3-a456-426614174005",
  };
  const repo = {
    persisted,
    async loadBundle() {
      return {
        trade: tradeRow,
        decision: decisionRow,
        origins: [],
        sources: [],
        contexts: [],
        events: [
          {
            facts: { kind: "trade_provenance", feesKnown: true, calculationBasis: "provider_net_only" },
          },
        ],
        evidence: [],
      };
    },
    async ensureEvidence(input: { label: string }) {
      return { id: ensured[input.label] ?? EV_INPUT };
    },
    async persistReview(input: unknown) {
      persisted.push(input);
      return { review: { id: REVIEW_ID }, dimensions: [] };
    },
    async getReviewView() {
      return { review: null, trade: null, decision: null, dimensions: [], evidenceLinks: [] };
    },
    ...overrides,
  };
  return repo as never;
}

test("generateReview persists grounded autopsy with server-computed quality", async () => {
  const repo = fakeRepo();
  const result = await generateReview(repo, fakeLlm(autopsy()), { tradeId: TRADE_ID });
  assert.equal(result.review.id, REVIEW_ID);
  assert.equal(result.decisionQuality.overallScore, 75);
  assert.equal(result.classification, "good_decision_bad_outcome");
  const persisted = (repo as { persisted: unknown[] }).persisted;
  assert.equal(persisted.length, 1);
  const input = persisted[0] as { processClassification: string; dimensions: unknown[] };
  assert.equal(input.processClassification, "good_decision_bad_outcome");
  assert.equal(input.dimensions.length, 5);
});

test("failed provider call creates no review", async () => {
  const repo = fakeRepo();
  await assert.rejects(
    () => generateReview(repo, fakeLlm(new AIError("PROVIDER")), { tradeId: TRADE_ID }),
    (error) => error instanceof AIError && error.code === "PROVIDER",
  );
  assert.equal((repo as { persisted: unknown[] }).persisted.length, 0);
});

test("invented quotes, unknown refs, and missing dimensions are rejected", async () => {
  const cases: AutopsyResult[] = [
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        dimension(75, { dimension: d, observedFacts: [{ evidenceId: EV_INPUT, quote: "never said this" }] }),
      ),
    }),
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        dimension(75, { dimension: d, evidenceRefs: [EV_FOREIGN] }),
      ),
    }),
    autopsy({
      dimensions: [
        ...REVIEW_DIMENSIONS.slice(0, 4).map((d) => dimension(75, { dimension: d })),
        dimension(75, { dimension: REVIEW_DIMENSIONS[0] }),
      ],
    }),
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        d === "behavioral_control"
          ? dimension(null, { dimension: d, evidenceRefs: [EV_INPUT] })
          : dimension(75, { dimension: d }),
      ),
    }),
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        d === "risk_discipline"
          ? dimension(75, { dimension: d, observedFacts: [] })
          : dimension(75, { dimension: d }),
      ),
    }),
    autopsy({ lessons: [{ text: "lesson without backing", evidenceRefs: [] }] }),
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        dimension(75, {
          dimension: d,
          inferredFindings: [{ finding: "looks fine", evidenceRefs: [] }],
        }),
      ),
    }),
    autopsy({
      dimensions: REVIEW_DIMENSIONS.map((d) =>
        dimension(75, { dimension: d, explanation: "the user has an addiction problem" }),
      ),
    }),
  ];
  for (const value of cases) {
    const repo = fakeRepo();
    await assert.rejects(
      () => generateReview(repo, fakeLlm(value), { tradeId: TRADE_ID }),
      (error) => error instanceof AIError && error.code === "GROUNDING",
    );
    assert.equal((repo as { persisted: unknown[] }).persisted.length, 0);
  }
});

test("positive outcome cannot lift a weak process", async () => {
  const positiveTrade = { ...tradeRow, realized_pnl: "9.9" };
  const repo = fakeRepo({
    async loadBundle() {
      return {
        trade: positiveTrade,
        decision: decisionRow,
        origins: [],
        sources: [],
        contexts: [],
        events: [{ facts: { kind: "trade_provenance", feesKnown: true, calculationBasis: "provider_net_only" } }],
        evidence: [],
      };
    },
  });
  const result = await generateReview(
    repo,
    fakeLlm(
      autopsy({
        dimensions: REVIEW_DIMENSIONS.map((d) => dimension(40, { dimension: d })),
      }),
    ),
    { tradeId: TRADE_ID },
  );
  assert.equal(result.decisionQuality.overallScore, 40);
  assert.equal(result.classification, "lucky_escape");
});

test("LLM input excludes outcome facts and inference-basis origins", async () => {
  const capture: { requests: StructuredGenerationRequest<unknown>[] } = { requests: [] };
  const repo = fakeRepo({
    async loadBundle() {
      return {
        trade: tradeRow,
        decision: decisionRow,
        origins: [
          { id: "o1", label: "pure_impulse", basis: "inference", explanation: "model guessed impulse" },
          { id: "o2", label: "original_research", basis: "user_confirmed", explanation: "checked funding" },
        ],
        sources: [],
        contexts: [],
        events: [{ facts: { kind: "trade_provenance", feesKnown: true, calculationBasis: "provider_net_only", metadata: { timestampBasis: "position_created_updated" } } }],
        evidence: [],
      };
    },
  });
  await generateReview(repo, fakeLlm(autopsy(), capture), { tradeId: TRADE_ID });
  assert.equal(capture.requests.length, 1);
  const input = capture.requests[0].input;
  assert.ok(!input.includes("exit_price"), "exit price must not reach the process LLM input");
  assert.ok(!input.includes("netProfit"), "provider net pnl must not reach the process LLM input");
  assert.ok(!input.includes("-4.5"), "realized pnl must not reach the process LLM input");
  assert.ok(!input.includes("model guessed impulse"), "inference-basis origin must be excluded");
  assert.ok(input.includes("user-confirmed"), "user-confirmed origin should be labeled explicitly");
  const catalog = JSON.parse(input).evidenceCatalog as { text: string }[];
  assert.ok(catalog.some((e) => e.text.includes("intendedEntry: 99.5")));
  assert.ok(catalog.some((e) => e.text.includes("holdingDurationMs: 86400333")));
});

test("review save failure maps to PERSISTENCE", async () => {
  const repo = fakeRepo({
    async persistReview() {
      throw new Error("connection reset");
    },
  });
  await assert.rejects(
    () => generateReview(repo, fakeLlm(autopsy()), { tradeId: TRADE_ID }),
    (error) => error instanceof Error && error.name === "PersistenceError",
  );
});

test("getReview returns 404 for unknown or cross-owner review", async () => {
  const repo = fakeRepo();
  await assert.rejects(
    () => getReview(repo, REVIEW_ID),
    (error) => error instanceof RepositoryError && error.code === "NOT_FOUND",
  );
});

function fakeSession(handler: (text: string, values?: readonly unknown[]) => Record<string, unknown>[]) {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  const session: DbSession & { calls: { text: string; values?: readonly unknown[] }[] } = {
    calls,
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return { rows: handler(text, values) as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      calls.push({ text: "BEGIN" });
      try {
        const result = await fn(session);
        calls.push({ text: "COMMIT" });
        return result;
      } catch (error) {
        calls.push({ text: "ROLLBACK" });
        throw error;
      }
    },
  };
  return session;
}

test("persistReview versions, switches current, and inserts dimensions with links atomically", async () => {
  let dimCount = 0;
  let linkCount = 0;
  const session = fakeSession((text, values) => {
    if (text.includes("FOR UPDATE") && text.includes("public.trades")) return [tradeRow];
    if (text.startsWith("SELECT * FROM public.decisions")) return [decisionRow];
    if (text.includes("MAX(version)")) return [{ version: 3 }];
    if (text.startsWith("INSERT INTO public.reviews")) {
      return [{ id: REVIEW_ID, version: values?.[3], is_current: true }];
    }
    if (text.startsWith("INSERT INTO public.review_dimensions")) {
      dimCount += 1;
      return [{ id: `dim-${dimCount}` }];
    }
    if (text.startsWith("INSERT INTO public.review_dimension_evidence")) {
      linkCount += 1;
      return [];
    }
    return [];
  });
  const repo = createReviewRepository(session, auth);
  const { review } = await repo.persistReview({
    tradeId: TRADE_ID,
    decisionId: DECISION_ID,
    processClassification: "earned_win",
    observedMetrics: {},
    aiInference: {},
    dimensions: REVIEW_DIMENSIONS.map((d) => ({
      dimension: d,
      score: 70,
      explanation: "ok",
      confidence: 0.5,
      evidenceRefs: [EV_INPUT],
    })),
  });
  assert.equal(review.version, 3);
  const update = session.calls.find((c) => c.text.includes("SET is_current=false"));
  assert.ok(update);
  assert.equal(dimCount, 5);
  assert.equal(linkCount, 5);
  assert.ok(session.calls.some((c) => c.text === "COMMIT"));
});

test("invalid dimensions are rejected before any transaction", async () => {
  const session = fakeSession(() => []);
  const repo = createReviewRepository(session, auth);
  await assert.rejects(
    () =>
      repo.persistReview({
        tradeId: TRADE_ID,
        decisionId: DECISION_ID,
        processClassification: null,
        observedMetrics: {},
        aiInference: {},
        dimensions: [
          { dimension: "research_quality", score: 70, explanation: "ok", confidence: 0.5, evidenceRefs: ["not-a-uuid"] },
        ],
      }),
    (error) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  assert.ok(!session.calls.some((c) => c.text === "BEGIN"));
});

test("evidence link failure rolls back the whole transaction", async () => {
  const session = fakeSession((text) => {
    if (text.includes("FOR UPDATE") && text.includes("public.trades")) return [tradeRow];
    if (text.startsWith("SELECT * FROM public.decisions")) return [decisionRow];
    if (text.includes("MAX(version)")) return [{ version: 1 }];
    if (text.startsWith("INSERT INTO public.reviews")) return [{ id: REVIEW_ID, version: 1 }];
    if (text.startsWith("INSERT INTO public.review_dimensions")) return [{ id: "dim-1" }];
    if (text.startsWith("INSERT INTO public.review_dimension_evidence")) {
      throw new Error("insert failed");
    }
    return [];
  });
  const repo = createReviewRepository(session, auth);
  await assert.rejects(
    () =>
      repo.persistReview({
        tradeId: TRADE_ID,
        decisionId: DECISION_ID,
        processClassification: null,
        observedMetrics: {},
        aiInference: {},
        dimensions: REVIEW_DIMENSIONS.map((d) => ({
          dimension: d,
          score: 70,
          explanation: "ok",
          confidence: 0.5,
          evidenceRefs: [EV_INPUT],
        })),
      }),
    (error) => error instanceof Error && error.name === "PersistenceUnavailableError",
  );
  assert.ok(session.calls.some((c) => c.text === "ROLLBACK"));
  assert.ok(!session.calls.some((c) => c.text === "COMMIT"));
});

test("getReview returns facts, findings, and linked evidence only", async () => {
  const repo = fakeRepo({
    async getReviewView() {
      return {
        review: {
          id: REVIEW_ID,
          version: 1,
          is_current: true,
          process_classification: "earned_win",
          created_at: "2026-10-07T00:00:00.000Z",
          observed_metrics: { tradeMetrics: { outcome: "positive" }, decisionQuality: { overallScore: 75 }, settlementCurrency: "USDT" },
          ai_inference: {
            summary: "s",
            lessons: [],
            ai: { provider: "groq", model: "m", promptVersion: "v", runId: "r" },
            dimensions: [
              {
                dimension: "research_quality",
                observedFacts: [{ evidenceId: EV_INPUT, quote: "bought BTCUSDT" }],
                inferredFindings: [{ finding: "checked context", evidenceRefs: [EV_INPUT] }],
              },
            ],
            evidenceCatalog: [
              { id: EV_INPUT, kind: "user_input", text: "bought BTCUSDT" },
              { id: EV_FOREIGN, kind: "user_input", text: "unlinked text" },
            ],
          },
        },
        trade: tradeRow,
        decision: decisionRow,
        dimensions: [
          { id: "dim-1", dimension: "research_quality", score: 80, explanation: "ok", confidence: 0.7 },
        ],
        evidenceLinks: [{ dimension_id: "dim-1", id: EV_INPUT, kind: "user_input", label: "Decision raw input" }],
      };
    },
  });
  const view = await getReview(repo, REVIEW_ID);
  const dim = (view.dimensions as { observedFacts: unknown[]; inferredFindings: unknown[] }[])[0];
  assert.equal(dim.observedFacts.length, 1);
  assert.equal(dim.inferredFindings.length, 1);
  const evidence = view.evidence as { evidenceId: string; text: string | null }[];
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].evidenceId, EV_INPUT);
  assert.equal(evidence[0].text, "bought BTCUSDT");
});

test("getReviewView scopes every read by owner", async () => {
  const session = fakeSession((text) => {
    if (text.startsWith("SELECT * FROM public.reviews")) return [{ id: REVIEW_ID, trade_id: TRADE_ID, decision_id: DECISION_ID, observed_metrics: {}, ai_inference: {} }];
    if (text.startsWith("SELECT * FROM public.trades")) return [tradeRow];
    if (text.startsWith("SELECT * FROM public.decisions")) return [decisionRow];
    if (text.startsWith("SELECT * FROM public.review_dimensions")) return [{ id: "dim-1" }];
    if (text.includes("review_dimension_evidence")) return [];
    return [];
  });
  const repo = createReviewRepository(session, auth);
  const view = await repo.getReviewView(REVIEW_ID);
  assert.ok(view.review);
  for (const call of session.calls) {
    if (call.text === "BEGIN" || call.text === "COMMIT") continue;
    assert.equal(call.values?.[0], USER_ID, call.text);
  }
});
