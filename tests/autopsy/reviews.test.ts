import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AIError } from "../../src/server/ai/errors";
import type { GenerationResult, LLMProvider, StructuredGenerationRequest } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { RepositoryError } from "../../src/server/db/repositories";
import { REVIEW_DIMENSIONS } from "../../src/server/review-policy";
import { createReviewRepository } from "../../src/server/reviews/repository";
import {
  generateReview,
  getReview,
  groundedAutopsySchema,
  resolveAutopsyQuotes,
  type AutopsyResult,
} from "../../src/server/reviews/service";

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
const EV_OBS = "623e4567-e89b-42d3-a456-426614174006";
const EV_METRIC2 = "623e4567-e89b-42d3-a456-426614174007";

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
  assert.equal(view.observationBasis, null, "legacy reviews without the field default to null");
  const dim = (view.dimensions as { observedFacts: unknown[]; inferredFindings: unknown[] }[])[0];
  assert.equal(dim.observedFacts.length, 1);
  assert.equal(dim.inferredFindings.length, 1);
  const evidence = view.evidence as { evidenceId: string; text: string | null }[];
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].evidenceId, EV_INPUT);
  assert.equal(evidence[0].text, "bought BTCUSDT");
});

const SPARSE_COMMENTS =
  "What happened: The token reached about $1.6M market cap, but I didn't sell because I started thinking it could reach $2M. " +
  "What changed: I moved my take-profit expectation from the original $1M target toward $2M. " +
  "Self-assessment: I think greed influenced me to change my take-profit range. " +
  "Eventual exit: I eventually sold around $585k market cap. " +
  "Later expected market cap (USD): 2000000. " +
  "These are retrospective user recollections with unknown exact timestamps, not independently verified fills or historical quotes.";

const sparseDecisionRow = {
  id: DECISION_ID,
  user_id: USER_ID,
  status: "confirmed",
  raw_input: "I looked at no evidence at all.",
  confirmed_snapshot: {
    assetSymbol: "RUNNER",
    assetClass: "crypto",
    side: "long",
    knowledgeBasis: "retrospective_recollection",
    intendedTakeProfitMarketCap: "1000000",
    marketCapCurrency: "USD",
    origins: ["pure_impulse"],
    sources: [],
  },
  confirmed_at: new Date("2026-10-04T00:00:00.000Z"),
  created_at: new Date("2026-10-04T00:00:00.000Z"),
};

const sparseTradeRow = {
  id: TRADE_ID,
  user_id: USER_ID,
  decision_id: DECISION_ID,
  provider: "manual",
  symbol: "RUNNER",
  side: "long",
  quantity: null,
  entry_price: null,
  exit_price: null,
  fees: null,
  realized_pnl: null,
  opened_at: null,
  closed_at: null,
  created_at: new Date("2026-10-08T00:00:00.000Z"),
};

function sparseRepo(observations: Record<string, unknown>, provenance: Record<string, unknown> = {}) {
  const persisted: unknown[] = [];
  const ensured: Record<string, string> = {
    "Decision raw input": EV_INPUT,
    "Confirmed decision snapshot": EV_SNAPSHOT,
    "Trade attachment and execution summary": EV_TRADE,
    "Retrospective manual observations": EV_OBS,
    "Deterministic process metrics trade-metrics.v2": EV_METRIC2,
  };
  const repo = {
    persisted,
    async loadBundle() {
      return {
        trade: sparseTradeRow,
        decision: sparseDecisionRow,
        origins: [],
        sources: [],
        contexts: [],
        events: [
          {
            facts: {
              kind: "trade_provenance",
              feesKnown: false,
              calculationBasis: "manual_observations",
              manualObservations: observations,
              ...provenance,
            },
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
  };
  return repo as never;
}

function catalogDrivenLlm(
  scores: Record<(typeof REVIEW_DIMENSIONS)[number], number | null>,
  captured?: { input: string }[],
): LLMProvider {
  return {
    generateText: async () => {
      throw new Error("unused");
    },
    async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<GenerationResult<T>> {
      captured?.push({ input: request.input });
      const input = JSON.parse(request.input) as {
        evidenceCatalog: { id: string; kind: string }[];
        quoteCatalog: { quoteRef: string; evidenceId: string; quote: string }[];
        planDrift: unknown[];
      };
      const quoteCatalog = input.quoteCatalog;
      const inputRef = quoteCatalog.find((q) => q.quote === "I looked at no evidence at all.")!.quoteRef;
      const snapshotRef = quoteCatalog.find((q) => q.quote === "intendedTakeProfitMarketCap: 1000000")!.quoteRef;
      const changeRef = quoteCatalog.find(
        (q) => q.quote === "What changed: I moved my take-profit expectation from the original $1M target toward $2M.",
      )!.quoteRef;
      const refFor = (dimension: string) =>
        dimension === "research_quality" ? inputRef : dimension === "risk_discipline" ? snapshotRef : changeRef;
      const value = {
        dimensions: REVIEW_DIMENSIONS.map((dimension) => {
          const score = scores[dimension];
          return {
            dimension,
            score,
            explanation: "documented rationale",
            confidence: score === null ? 0 : 0.8,
            observedFacts: score === null ? [] : [{ quoteRef: refFor(dimension) }],
            inferredFindings: [],
          };
        }),
        summary: "documented process review",
        lessons: [],
        planDriftLessons: input.planDrift.map(() => ({
          text: "The reported target shifted from $1M to $2M while the user did not sell.",
        })),
      };
      request.schema.parse(value);
      request.validate?.(value as T);
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

const provisionalScores = {
  research_quality: 10,
  context_awareness: null,
  risk_discipline: 40,
  execution_quality: 45,
  behavioral_control: 30,
};

const sparseObservations = {
  amountInvested: "20",
  entryMarketCap: "20000",
  exitMarketCap: "585000",
  peakObservedMarketCap: "1600000",
  marketCapCurrency: "USD",
  executionState: "closed",
  cashFlowBasis: "unknown",
  captureBasis: "retrospective",
  retrospectiveComments: SPARSE_COMMENTS,
};

test("sparse review derives plan drift from owned catalog and keeps outcome unknown", async () => {
  const repo = sparseRepo(sparseObservations);
  const captured: { input: string }[] = [];
  const result = await generateReview(repo, catalogDrivenLlm(provisionalScores, captured), { tradeId: TRADE_ID });
  assert.equal(result.planDrift.length, 1);
  const finding = result.planDrift[0];
  assert.equal(finding.originalPlan.value, "1000000");
  assert.equal(finding.revisedPlan.value, "2000000");
  assert.equal(finding.ordering.basis, "explicit_user_statement");
  assert.deepEqual(finding.evidenceRefs, [EV_SNAPSHOT, EV_OBS]);
  const wireDrift = (JSON.parse(captured[0].input) as {
    planDrift: { originalTargetQuoteRef: string | null; behaviorQuoteRefs: string[]; evidenceRefs: string[] }[];
  }).planDrift[0];
  assert.match(wireDrift.originalTargetQuoteRef ?? "", /^q\d+$/);
  assert.ok(wireDrift.behaviorQuoteRefs.length >= 1 && wireDrift.behaviorQuoteRefs.every((ref) => /^q\d+$/.test(ref)));
  assert.ok(finding.evidenceRefs.every((ref) => !/^q\d+$/.test(ref)), "q-selectors are never persisted as evidence refs");
  assert.equal(finding.userSelfAssessment[0].text.includes("greed"), true);
  assert.ok(!finding.explanation.includes("greed"));
  assert.equal(
    (sparseDecisionRow.confirmed_snapshot as Record<string, unknown>).intendedTakeProfitMarketCap,
    "1000000",
    "the original confirmed snapshot must not be rewritten by the later recall",
  );
  assert.equal(result.decisionQuality.score, 29.6875);
  assert.equal(result.decisionQuality.status, "provisional");
  assert.equal(result.decisionQuality.evidenceCoveragePct, 80);
  const persisted = (repo as { persisted: { observedMetrics: Record<string, unknown>; processClassification: string | null }[] }).persisted;
  assert.equal(persisted.length, 1);
  const metrics = persisted[0].observedMetrics;
  assert.equal((metrics.tradeMetrics as Record<string, unknown>).outcome, "unknown");
  assert.equal(persisted[0].processClassification, null);
  assert.equal(result.classification, null);
  assert.equal((metrics.planDrift as unknown[]).length, 1);
});

test("a provisional quality score never produces a process classification", async () => {
  const repo = sparseRepo(
    { ...sparseObservations, proceedsReceived: "30", cashFlowBasis: "net_including_fees" },
    { settlementCurrency: "USDT" },
  );
  const result = await generateReview(repo, catalogDrivenLlm(provisionalScores), { tradeId: TRADE_ID });
  const metrics = (repo as { persisted: { observedMetrics: Record<string, unknown> }[] }).persisted[0]
    .observedMetrics;
  assert.equal((metrics.tradeMetrics as Record<string, unknown>).outcome, "positive");
  assert.equal(result.decisionQuality.status, "provisional");
  assert.equal(result.classification, null);
});

test("persistReview validates plan drift evidence ownership before writing the review", async () => {
  for (const gateRows of [[], [{ id: EV_SNAPSHOT }]]) {
    const session = fakeSession((text) => {
      if (text.includes("FOR UPDATE") && text.includes("public.trades")) return [tradeRow];
      if (text.startsWith("SELECT * FROM public.decisions")) return [decisionRow];
      if (text.startsWith("SELECT id FROM public.evidence_records") && text.includes("id=ANY")) return gateRows;
      return [];
    });
    const repo = createReviewRepository(session, auth);
    await assert.rejects(
      () =>
        repo.persistReview({
          tradeId: TRADE_ID,
          decisionId: DECISION_ID,
          processClassification: null,
          observedMetrics: { planDrift: [{ evidenceRefs: [EV_SNAPSHOT, EV_OBS] }] },
          aiInference: {},
          dimensions: REVIEW_DIMENSIONS.map((d) => ({
            dimension: d,
            score: 70,
            explanation: "ok",
            confidence: 0.5,
            evidenceRefs: [EV_INPUT],
          })),
        }),
      (error) => error instanceof RepositoryError && error.code === "NOT_FOUND",
    );
    assert.ok(
      !session.calls.some((c) => c.text.startsWith("INSERT INTO public.reviews")),
      "missing or cross-owner plan drift refs must fail before the review insert",
    );
    assert.ok(session.calls.some((c) => c.text === "ROLLBACK"));
    const gate = session.calls.find(
      (c) => c.text.startsWith("SELECT id FROM public.evidence_records") && c.text.includes("id=ANY($2::uuid[])"),
    );
    assert.deepEqual(gate?.values, [USER_ID, [EV_SNAPSHOT, EV_OBS], DECISION_ID, TRADE_ID]);
  }
});

test("malformed plan drift refs are rejected before any transaction", async () => {
  const session = fakeSession(() => []);
  const repo = createReviewRepository(session, auth);
  await assert.rejects(
    () =>
      repo.persistReview({
        tradeId: TRADE_ID,
        decisionId: DECISION_ID,
        processClassification: null,
        observedMetrics: { planDrift: [{ evidenceRefs: ["not-a-uuid"] }] },
        aiInference: {},
        dimensions: REVIEW_DIMENSIONS.map((d) => ({
          dimension: d,
          score: 70,
          explanation: "ok",
          confidence: 0.5,
          evidenceRefs: [EV_INPUT],
        })),
      }),
    (error) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  assert.ok(!session.calls.some((c) => c.text === "BEGIN"));
});

test("getReviewView loads owned plan drift evidence through the scoped lookup and fails closed", async () => {
  const reviewRow = {
    id: REVIEW_ID,
    trade_id: TRADE_ID,
    decision_id: DECISION_ID,
    version: 1,
    is_current: true,
    observed_metrics: { planDrift: [{ evidenceRefs: [EV_SNAPSHOT, EV_OBS] }] },
    ai_inference: {},
  };
  const driftRows = [
    { id: EV_OBS, kind: "trade_data", label: "Retrospective manual observations" },
    { id: EV_SNAPSHOT, kind: "user_input", label: "Confirmed decision snapshot" },
  ];
  const makeSession = (rows: Record<string, unknown>[]) =>
    fakeSession((text) => {
      if (text.startsWith("SELECT * FROM public.reviews")) return [reviewRow];
      if (text.startsWith("SELECT * FROM public.trades")) return [tradeRow];
      if (text.startsWith("SELECT * FROM public.decisions")) return [decisionRow];
      if (text.startsWith("SELECT * FROM public.review_dimensions")) return [{ id: "dim-1" }];
      if (text.includes("public.evidence_records") && text.includes("id=ANY")) return rows;
      return [];
    });
  const session = makeSession(driftRows);
  const repo = createReviewRepository(session, auth);
  const view = await repo.getReviewView(REVIEW_ID);
  assert.equal(view.planDriftEvidence?.length, 2);
  const gate = session.calls.find(
    (c) => c.text.startsWith("SELECT * FROM public.evidence_records") && c.text.includes("id=ANY($2::uuid[])"),
  );
  assert.ok(gate?.text.includes("ORDER BY id"));
  assert.deepEqual(gate?.values, [USER_ID, [EV_SNAPSHOT, EV_OBS], DECISION_ID, TRADE_ID]);
  const missing = createReviewRepository(makeSession([driftRows[0]]), auth);
  await assert.rejects(
    () => missing.getReviewView(REVIEW_ID),
    (error) => error instanceof RepositoryError && error.code === "NOT_FOUND",
  );
});

test("getReview merges plan drift evidence with text from the saved catalog", async () => {
  const snapshotText = "original confirmed decision snapshot:\nintendedTakeProfitMarketCap: 1000000\nmarketCapCurrency: USD";
  const obsText = "phase: after_the_fact manual observations, not decision-time evidence\nretrospective_comments: I moved my target.";
  const planDrift = [{ type: "target_drift", evidenceRefs: [EV_SNAPSHOT, EV_OBS] }];
  const repo = fakeRepo({
    async getReviewView() {
      return {
        review: {
          id: REVIEW_ID,
          version: 1,
          is_current: true,
          process_classification: null,
          created_at: "2026-10-07T00:00:00.000Z",
          observed_metrics: { planDrift, tradeMetrics: { outcome: "unknown" } },
          ai_inference: {
            summary: "s",
            lessons: [],
            ai: { provider: "groq", model: "m", promptVersion: "v", runId: "r" },
            observationBasis: "server_catalog_quotes_selected_by_model",
            dimensions: [],
            evidenceCatalog: [
              { id: EV_SNAPSHOT, kind: "user_input", text: snapshotText },
              { id: EV_OBS, kind: "trade_data", text: obsText },
            ],
          },
        },
        trade: tradeRow,
        decision: decisionRow,
        dimensions: [],
        evidenceLinks: [{ dimension_id: "dim-1", id: EV_INPUT, kind: "user_input", label: "Decision raw input" }],
        planDriftEvidence: [
          { id: EV_SNAPSHOT, kind: "user_input", label: "Confirmed decision snapshot" },
          { id: EV_OBS, kind: "trade_data", label: "Retrospective manual observations" },
        ],
      };
    },
  });
  const view = await getReview(repo, REVIEW_ID);
  assert.equal(view.observationBasis, "server_catalog_quotes_selected_by_model");
  assert.deepEqual(view.planDrift, planDrift);
  const evidence = view.evidence as { evidenceId: string; text: string | null }[];
  assert.equal(evidence.length, 3);
  assert.equal(evidence.find((e) => e.evidenceId === EV_SNAPSHOT)?.text, snapshotText);
  assert.equal(evidence.find((e) => e.evidenceId === EV_OBS)?.text, obsText);
  assert.equal(evidence.find((e) => e.evidenceId === EV_INPUT)?.text, null);
});

test("groundedAutopsySchema wire selects catalog quote pairs by one ref and rejects anything else", () => {
  const catalog = [
    { id: EV_INPUT, text: "decision raw input:\nI looked at no evidence at all." },
    { id: EV_SNAPSHOT, text: "original confirmed decision snapshot:\nintendedTakeProfitMarketCap: 1000000" },
  ];
  const { schema, quoteCatalog } = groundedAutopsySchema(catalog);
  const refFor = (evidenceId: string, quoteIncludes: string) =>
    quoteCatalog.find((q) => q.evidenceId === evidenceId && q.quote.includes(quoteIncludes))!.quoteRef;
  const inputRef = refFor(EV_INPUT, "I looked at no evidence at all.");
  const base = (dimension: string) => ({
    dimension,
    score: null,
    explanation: "insufficient evidence",
    confidence: 0,
    observedFacts: [],
    inferredFindings: [],
  });
  const scored = (quoteRef: string) => ({
    ...base("research_quality"),
    score: 70,
    confidence: 0.8,
    observedFacts: [{ quoteRef }],
  });
  const result = (dimension: Record<string, unknown>, lessons: unknown[] = [], planDriftLessons: unknown[] = []) => ({
    dimensions: [dimension, ...REVIEW_DIMENSIONS.slice(1).map((d) => base(d))],
    summary: "documented process review",
    lessons,
    planDriftLessons,
  });
  const parsed = schema.parse(result(scored(inputRef)));
  assert.equal(parsed.dimensions[0].observedFacts[0].quoteRef, inputRef);
  assert.equal(
    schema.safeParse(result(scored("q999"))).success,
    false,
    "an unknown quoteRef must fail",
  );
  assert.equal(
    schema.safeParse(
      result({ ...scored(inputRef), inferredFindings: [{ finding: "checked", supportQuotes: ["q999"] }] }),
    ).success,
    false,
    "an unknown inferredFinding supportQuotes selector must fail",
  );
  assert.equal(
    schema.safeParse(
      result({ ...scored(inputRef), inferredFindings: [{ finding: "checked", supportQuotes: [] }] }),
    ).success,
    false,
    "an inferred finding with no support quote must fail",
  );
  assert.equal(
    schema.safeParse(result(scored(inputRef), [{ text: "lesson", supportQuotes: ["q999"] }])).success,
    false,
    "an unknown lesson supportQuotes selector must fail",
  );
  assert.equal(
    schema.safeParse(result(scored(inputRef), [{ text: "lesson", supportQuotes: [] }])).success,
    false,
    "a lesson with no support quote must fail",
  );
  assert.equal(
    schema.safeParse(result({ ...scored(inputRef), evidenceRefs: [EV_FOREIGN] })).success,
    false,
    "an evidenceRefs key is not part of the wire shape",
  );
  assert.equal(
    schema.safeParse(result(scored(inputRef), [{ text: "lesson", evidenceRefs: [EV_FOREIGN] }])).success,
    false,
    "a lesson evidenceRefs key is an extra the model never supplies",
  );
  assert.equal(
    schema.safeParse(
      result({ ...scored(inputRef), observedFacts: [{ quoteRef: inputRef, quote: "I looked at no evidence at all." }] }),
    ).success,
    false,
    "a literal quote key is an extra key the model never supplies",
  );
  assert.equal(
    schema.safeParse(
      result({ ...scored(inputRef), observedFacts: [{ quoteRef: inputRef, evidenceId: EV_SNAPSHOT }] }),
    ).success,
    false,
    "a literal evidenceId cannot be supplied independently of the selected pair",
  );
  assert.equal(
    schema.safeParse(result(scored("I looked at no evidence at all."))).success,
    false,
    "the model cannot paraphrase because there is no return quote field",
  );
  assert.equal(
    schema.safeParse(result(scored(inputRef), [], [{ text: "extra drift lesson" }])).success,
    false,
    "the model cannot invent a dedicated drift lesson slot when no finding exists",
  );
  assert.equal(schema.safeParse(result(base("research_quality"))).success, true, "null abstention stays accepted");
  const finding = { evidenceRefs: [EV_INPUT, EV_SNAPSHOT] } as never;
  const drift = groundedAutopsySchema(catalog, [finding]);
  const driftLesson = { text: "The reported target shifted from $1M to $2M while the user did not sell." };
  const driftWire = result(scored(inputRef), [], [driftLesson]);
  assert.equal(drift.schema.safeParse(driftWire).success, true, "one dedicated slot per supplied finding");
  assert.equal(
    drift.schema.safeParse(result(scored(inputRef))).success,
    false,
    "a missing dedicated slot fails",
  );
  assert.equal(
    drift.schema.safeParse(result(scored(inputRef), [], [driftLesson, driftLesson])).success,
    false,
    "an extra dedicated slot fails",
  );
  assert.equal(
    drift.schema
      .safeParse(result(scored(inputRef), [], [{ ...driftLesson, supportQuotes: [inputRef] }]))
      .success,
    false,
    "a supportQuotes key on the dedicated slot is rejected",
  );
  assert.equal(
    drift.schema
      .safeParse(result(scored(inputRef), [], [{ ...driftLesson, evidenceRefs: [EV_INPUT] }]))
      .success,
    false,
    "an evidenceRefs key on the dedicated slot is rejected",
  );
  const driftResolved = resolveAutopsyQuotes(driftWire, drift.quoteCatalog, [finding]);
  assert.deepEqual(driftResolved.lessons, [
    { text: driftLesson.text, evidenceRefs: [EV_INPUT, EV_SNAPSHOT] },
  ]);
  const wire = z.toJSONSchema(schema) as unknown as {
    properties: {
      dimensions: {
        items: {
          properties: {
            evidenceRefs?: unknown;
            observedFacts: { items: { properties: { quoteRef: { enum: string[] } }; anyOf?: unknown } };
            score: { anyOf: unknown[] };
          };
        };
      };
    };
  };
  const dimItem = wire.properties.dimensions.items.properties;
  assert.ok(!("evidenceRefs" in dimItem), "wire dimensions never carry raw evidence ids");
  const factItem = dimItem.observedFacts.items;
  assert.ok(!("anyOf" in factItem), "observedFacts item must stay a flat quoteRef object");
  assert.ok(factItem.properties.quoteRef.enum.includes(inputRef));
  assert.ok(
    factItem.properties.quoteRef.enum.every((ref) => /^q\d+$/.test(ref)),
    "wire keys are transient q-N refs, never persisted evidence ids",
  );
  assert.ok(
    !factItem.properties.quoteRef.enum.some((ref) => ref === EV_INPUT || ref === EV_SNAPSHOT),
    "wire selector enums never contain owned evidence IDs",
  );
  assert.ok(Array.isArray(dimItem.score.anyOf), "nullable score anyOf unchanged");
  assert.throws(
    () => groundedAutopsySchema([]),
    (error) => error instanceof AIError && error.code === "SCHEMA",
  );
});

test("resolveAutopsyQuotes maps refs to exact owned pairs and rejects extras and unknown refs", () => {
  const catalog = [
    { id: EV_INPUT, text: "decision raw input:\nI looked at no evidence at all." },
    { id: EV_SNAPSHOT, text: "original confirmed decision snapshot:\nintendedTakeProfitMarketCap: 1000000" },
  ];
  const { schema, quoteCatalog } = groundedAutopsySchema(catalog);
  const base = (dimension: string) => ({
    dimension,
    score: null,
    explanation: "insufficient evidence",
    confidence: 0,
    observedFacts: [],
    inferredFindings: [],
  });
  const wireResult = (facts: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
    dimensions: [
      { ...base("research_quality"), score: 70, confidence: 0.8, observedFacts: facts, ...extra },
      ...REVIEW_DIMENSIONS.slice(1).map((d) => base(d)),
    ],
    summary: "documented process review",
    lessons: [],
    planDriftLessons: [],
  });
  const ref = quoteCatalog.find((q) => q.evidenceId === EV_INPUT && q.quote === "I looked at no evidence at all.")!.quoteRef;
  const snapshotRef = quoteCatalog.find(
    (q) => q.evidenceId === EV_SNAPSHOT && q.quote === "intendedTakeProfitMarketCap: 1000000",
  )!.quoteRef;
  const resolved = resolveAutopsyQuotes(
    wireResult([{ quoteRef: ref }], { inferredFindings: [{ finding: "target was declared", supportQuotes: [snapshotRef] }] }),
    quoteCatalog,
  );
  assert.deepEqual(resolved.dimensions[0].observedFacts, [
    { evidenceId: EV_INPUT, quote: "I looked at no evidence at all." },
  ]);
  assert.deepEqual(
    resolved.dimensions[0].inferredFindings,
    [{ finding: "target was declared", evidenceRefs: [EV_SNAPSHOT] }],
  );
  assert.deepEqual(
    resolved.dimensions[0].evidenceRefs,
    [EV_INPUT, EV_SNAPSHOT],
    "product refs are derived as the unique union of every selected quote source",
  );
  assert.equal(schema.parse(wireResult([{ quoteRef: ref }])).dimensions[0].score, 70);
  assert.throws(
    () => resolveAutopsyQuotes(wireResult([{ quoteRef: "unknown:0" }]), quoteCatalog),
    (error) => error instanceof AIError && error.code === "GROUNDING",
  );
  assert.throws(
    () =>
      resolveAutopsyQuotes(
        wireResult([{ quoteRef: ref, quote: "I looked at no evidence at all." }]),
        quoteCatalog,
      ),
    "extra wire keys are never silently ignored",
  );
  assert.throws(
    () => resolveAutopsyQuotes(wireResult([{ quoteRef: ref }], { evidenceRefs: [EV_INPUT] }), quoteCatalog),
    "a model-supplied evidenceRefs key is rejected, never trusted",
  );
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
