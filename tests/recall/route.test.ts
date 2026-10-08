import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { EmbeddingProvider, LLMProvider } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { computeSourceHash } from "../../src/server/db/validation";
import { AIError } from "../../src/server/ai/errors";
import { GroqLLMProvider } from "../../src/server/ai/groq";
import type { AiRunRecorder } from "../../src/server/ai/types";
import { RECALL_QUERIES } from "../../src/server/recall-queries";
import { createRecallHandler } from "../../src/server/recall/http";
import { z } from "zod";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };

type Row = Record<string, unknown>;
type EnvSnapshot = Record<string, string | undefined>;

const D1 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333";
const E1 = "44444444-4444-4444-8444-444444444444";
const P1 = "66666666-6666-4666-8666-666666666666";
const MEM_D = "88888888-8888-4888-8888-888888888888";
const MEM_P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prior: EnvSnapshot = {
    JINA_EMBEDDING_MODEL: process.env.JINA_EMBEDDING_MODEL,
    JINA_EMBEDDING_DIMENSIONS: process.env.JINA_EMBEDDING_DIMENSIONS,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL,
  };
  process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
  process.env.JINA_EMBEDDING_DIMENSIONS = "1024";
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_MODEL = "test-model";
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fakeEmbedder(counter: { calls: number } = { calls: 0 }, failing = false): EmbeddingProvider {
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
      if (failing) throw new AIError("PROVIDER");
      return single(text);
    },
    embedMany: async (texts: readonly string[]) => Promise.all(texts.map(single)),
  };
}

const QUOTE = "original target was $1M then moved to $2M and did not sell";
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

function decisionRow(): Row {
  return {
    id: D1,
    user_id: USER_ID,
    asset_symbol: "RUNNER",
    asset_class: "crypto",
    raw_input: QUOTE,
    confirmed_snapshot: { knowledgeBasis: "confirmed_decision_user_report" },
  };
}

function reviewRow(): Row {
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
  };
}

function patternRow(): Row {
  return {
    id: P1,
    user_id: USER_ID,
    kind: "leak",
    status: "observation",
    evidence_count: 1,
    description: "stored DNA observation",
    observed_statistics: {
      memorySourceHash: "hash-1",
      producer: "decision-dna.v1",
      active: true,
      feature: "weak research score 15",
      basis: "deterministic_server_policy",
      occurrenceCount: 1,
      highQualityCount: 0,
      establishedEligible: false,
      supportingDecisionIds: [D1],
      supportingReviewIds: [R1],
      evidenceRefs: [E1],
    },
  };
}

interface FakeOptions {
  available?: unknown;
  search?: Row[];
}

function fakeDb(options: FakeOptions = {}) {
  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
      const rows = (list: Row[]) => list.filter((row) => String(row.id) === String(values[1]));
      if (text === RECALL_QUERIES.available) return { rows: [{ available: options.available ?? true }] };
      if (text === RECALL_QUERIES.search) return { rows: options.search ?? [] };
      if (text === RECALL_QUERIES.decision) return { rows: rows([decisionRow()]) };
      if (text === RECALL_QUERIES.currentReview) return { rows: [{ id: R1 }] };
      if (text === RECALL_QUERIES.origins) return { rows: [{ label: "pure_impulse", basis: "inference" }] };
      if (text === RECALL_QUERIES.decisionEvidence) return { rows: [{ id: E1, user_id: USER_ID, kind: "user_input" }] };
      if (text === RECALL_QUERIES.pattern) return { rows: rows([patternRow()]) };
      if (text === RECALL_QUERIES.patternEvidence) return { rows: [{ id: E1, user_id: USER_ID }] };
      if (text === RECALL_QUERIES.rule) return { rows: [] };
      if (text === RECALL_QUERIES.ruleEvidence) return { rows: [] };
      if (text.includes("FROM public.reviews WHERE")) return { rows: rows([reviewRow()]) };
      if (text.includes("FROM public.trades WHERE")) return { rows: [] };
      if (text.includes("FROM public.decisions WHERE")) return { rows: rows([decisionRow()]) };
      if (text.includes("FROM public.review_dimensions")) return { rows: [] };
      if (text.includes("review_dimension_evidence")) return { rows: [] };
      if (text.includes("FROM public.evidence_records")) {
        const ids = values[1] as string[];
        return { rows: [{ id: E1, user_id: USER_ID }].filter((row) => ids.includes(String(row.id))) };
      }
      throw new Error(`unexpected query: ${text}`);
  }
  const db: Queryable = {
    query: async <T = Row>(text: string, values: readonly unknown[] = []) => (await dispatch(text, values)) as { rows: T[] },
  };
  return db as unknown as DbSession;
}

const SEARCH = [
  { id: MEM_D, entity_type: "decision", entity_id: D1, similarity: 0.8, source_hash: "hash-d" },
  { id: MEM_P, entity_type: "pattern", entity_id: P1, similarity: 0.6, source_hash: "hash-1" },
];

function handler(opts: { db?: DbSession; embedder?: EmbeddingProvider; llm?: LLMProvider; authenticated?: boolean } = {}) {
  return createRecallHandler({
    db: opts.db ?? fakeDb({ search: SEARCH }),
    embedder: opts.embedder ?? fakeEmbedder(),
    llm: opts.llm,
    authProvider: { getContext: async () => (opts.authenticated === false ? null : auth) },
  });
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/recall", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function fakeLlm(value: unknown, counter?: { calls: number }): LLMProvider {
  return {
    generateText: async () => {
      throw new AIError("CONFIGURATION");
    },
    generateStructured: async () => {
      if (counter) counter.calls += 1;
      if (value instanceof Error) throw value;
      return { value, provider: "groq", model: "test-model", promptVersion: "pre-trade-recall.v1", runId: "run-1", attempts: 1 };
    },
  } as unknown as LLMProvider;
}

test("anonymous request returns 401 and cross-origin returns 403", () =>
  withEnv(async () => {
    const anon = await handler({ authenticated: false })(post({ text: "buy" }));
    assert.equal(anon.status, 401);
    const crossSite = await handler()(post({ text: "buy" }, { "sec-fetch-site": "cross-site" }));
    assert.equal(crossSite.status, 403);
    const foreign = await handler()(post({ text: "buy" }, { origin: "http://evil.example" }));
    assert.equal(foreign.status, 403);
  }));

test("extra userId and whitespace-only text are rejected with 400", () =>
  withEnv(async () => {
    const extra = await handler()(post({ text: "buy", userId: USER_ID }));
    assert.equal(extra.status, 400);
    const blank = await handler()(post({ text: "   " }));
    assert.equal(blank.status, 400);
  }));

test("empty memory skips embedding and llm and labels empty history", () =>
  withEnv(async () => {
    const counter = { calls: 0 };
    const llmCalls = { calls: 0 };
    const response = await handler({ db: fakeDb({ available: false }), embedder: fakeEmbedder(counter), llm: fakeLlm({}, llmCalls) })(post({ text: "  buy RUNNER now  " }));
    assert.equal(response.status, 200);
    const body = await response.json() as Row;
    assert.equal(counter.calls, 0);
    assert.equal(llmCalls.calls, 0);
    const proposed = body.proposedTrade as Row;
    assert.equal(proposed.rawText, "  buy RUNNER now  ");
    assert.equal(proposed.contextBasis, "user_provided_unverified");
    assert.equal(proposed.durableProposalCreated, false);
    const explanation = body.explanation as Row;
    assert.equal(explanation.mode, "deterministic_empty_or_no_relevant_history");
    assert.equal(explanation.newHistoricalClaimsGenerated, false);
  }));

test("deterministic watchpoints and questions come from stored facts only", () =>
  withEnv(async () => {
    const llm = fakeLlm(new Error("llm disabled"));
    const body = (await (await handler({ llm })(post({ text: "thinking of buying RUNNER" }))).json()) as Row;
    const watchpoints = body.watchpoints as { id: string; text: string }[];
    const drift = watchpoints.find((item) => item.id.startsWith("target_drift_"))!;
    assert.ok(drift.text.includes("1000000") && drift.text.includes("2000000"));
    assert.ok(!/pnl|profit realized|gain|loss of/i.test(drift.text));
    assert.ok(watchpoints.some((item) => item.id === `dna_${P1}`));
    const questions = (body.questions as { id: string }[]).map((item) => item.id);
    assert.ok(questions.includes("define_exit"));
    assert.ok(questions.includes("define_invalidation"));
    assert.ok(questions.includes("justify_target_revision"));
    const explanation = body.explanation as Row;
    assert.equal(explanation.mode, "deterministic_fallback");
    assert.equal(explanation.newHistoricalClaimsGenerated, false);
  }));

test("supplied context suppresses exit and invalidation questions without trusting market facts", () =>
  withEnv(async () => {
    const llm = fakeLlm(new Error("llm disabled"));
    const body = (await (await handler({ llm })(
      post({ text: "buy", context: { takeProfit: "at 2M", invalidation: "below 500k", marketContext: "rumor" } }),
    )).json()) as Row;
    const questions = (body.questions as { id: string }[]).map((item) => item.id);
    assert.ok(!questions.includes("define_exit"));
    assert.ok(!questions.includes("define_invalidation"));
    assert.ok(questions.includes("justify_target_revision"));
    const proposed = body.proposedTrade as Row;
    assert.equal(proposed.contextBasis, "user_provided_unverified");
  }));

test("valid strict selection reorders first while retaining all server items", () =>
  withEnv(async () => {
    const counter = { calls: 0 };
    const llm: LLMProvider = {
      generateText: async () => {
        throw new AIError("CONFIGURATION");
      },
      generateStructured: async () => {
        counter.calls += 1;
        return {
          value: { watchpointIds: [`dna_${P1}`], questionIds: ["define_invalidation"] },
          provider: "groq",
          model: "test-model",
          promptVersion: "pre-trade-recall.v1",
          runId: "run-9",
          attempts: 1,
        };
      },
    } as unknown as LLMProvider;
    const body = (await (await handler({ llm })(post({ text: "buy RUNNER" }))).json()) as Row;
    assert.equal(counter.calls, 1);
    const explanation = body.explanation as Row;
    assert.equal(explanation.mode, "model_selected");
    assert.equal(explanation.runId, "run-9");
    const watchpoints = (body.watchpoints as { id: string }[]).map((item) => item.id);
    assert.equal(watchpoints[0], `dna_${P1}`);
    assert.ok(watchpoints.some((id) => id.startsWith("target_drift_")));
    const questions = (body.questions as { id: string }[]).map((item) => item.id);
    assert.equal(questions[0], "define_invalidation");
    assert.ok(questions.includes("define_exit") && questions.includes("justify_target_revision"));
  }));

test("invalid selections fall back deterministically with status 200", () =>
  withEnv(async () => {
    const cases = [
      { watchpointIds: ["foreign-id"], questionIds: ["define_exit"] },
      { watchpointIds: [`dna_${P1}`, `dna_${P1}`], questionIds: ["define_exit"] },
      { watchpointIds: [`dna_${P1}`], questionIds: ["define_exit"], extra: "prose" },
      { watchpointIds: [], questionIds: ["define_exit"] },
    ];
    for (const value of cases) {
      const response = await handler({ llm: fakeLlm(value) })(post({ text: "buy" }));
      assert.equal(response.status, 200);
      const body = (await response.json()) as Row;
      assert.equal((body.explanation as Row).mode, "deterministic_fallback");
      assert.equal((body.explanation as Row).newHistoricalClaimsGenerated, false);
    }
  }));

test("AIError categories fall back, persistence errors also fall back", () =>
  withEnv(async () => {
    for (const code of ["TIMEOUT", "PROVIDER", "CONFIGURATION"] as const) {
      const body = (await (await handler({ llm: fakeLlm(new AIError(code)) })(post({ text: "buy" }))).json()) as Row;
      const explanation = body.explanation as Row;
      assert.equal(explanation.mode, "deterministic_fallback");
      assert.equal(explanation.failureCategory, code);
    }
    const body = (await (await handler({ llm: fakeLlm(new Error("db down")) })(post({ text: "buy" }))).json()) as Row;
    assert.equal((body.explanation as Row).failureCategory, "SCHEMA_OR_SELECTION_FAILURE");
  }));

test("embedding failure returns honest unavailable response", () =>
  withEnv(async () => {
    const response = await handler({ embedder: fakeEmbedder({ calls: 0 }, true), llm: fakeLlm({}) })(post({ text: "buy" }));
    assert.equal(response.status, 503);
    const body = (await response.json()) as Row;
    assert.equal((body.error as Row).code, "AI_UNAVAILABLE");
  }));

function groqJson(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function groqBody(content: string | null) {
  return {
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content, refusal: null } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function fakeRecorder() {
  const calls: unknown[] = [];
  const recorder: AiRunRecorder & { calls: unknown[] } = {
    calls,
    record: async (input: unknown) => {
      calls.push(input);
      return { id: "run-1" };
    },
  };
  return recorder;
}

test("default deps with empty memory and no Jina key still return 200", () =>
  withEnv(async () => {
    const key = process.env.JINA_API_KEY;
    delete process.env.JINA_API_KEY;
    try {
      const response = await createRecallHandler({
        db: fakeDb({ available: false }),
        authProvider: { getContext: async () => auth },
        llm: fakeLlm({}),
      })(post({ text: "buy RUNNER" }));
      assert.equal(response.status, 200);
      const body = (await response.json()) as Row;
      assert.equal((body.explanation as Row).mode, "deterministic_empty_or_no_relevant_history");
    } finally {
      if (key === undefined) delete process.env.JINA_API_KEY;
      else process.env.JINA_API_KEY = key;
    }
  }));

test("singleAttempt issues exactly one fetch for 503 and schema failures", () =>
  withEnv(async () => {
    const schema = z.strictObject({ answer: z.string() });
    let fetches = 0;
    const fail503: typeof fetch = async () => {
      fetches += 1;
      return groqJson({}, 503);
    };
    const recorder503 = fakeRecorder();
    const provider = new GroqLLMProvider({ recorder: recorder503, fetch: fail503 });
    await assert.rejects(
      () => provider.generateStructured({ system: "s", input: "i", pipeline: "p", promptVersion: "v", schema, schemaName: "a", singleAttempt: true }),
      AIError,
    );
    assert.equal(fetches, 1);
    assert.equal(recorder503.calls.length, 1);
    const run = recorder503.calls[0] as { tokenUsage?: { run?: { attempts?: number } } };
    assert.equal(run.tokenUsage?.run?.attempts, 1);
    fetches = 0;
    const badSchema: typeof fetch = async () => {
      fetches += 1;
      return groqJson(groqBody('{"wrong":1}'));
    };
    const recorder = fakeRecorder();
    const provider2 = new GroqLLMProvider({ recorder, fetch: badSchema });
    await assert.rejects(
      () => provider2.generateStructured({ system: "s", input: "i", pipeline: "p", promptVersion: "v", schema, schemaName: "a", singleAttempt: true }),
      AIError,
    );
    assert.equal(fetches, 1);
    assert.equal(recorder.calls.length, 1);
  }));
