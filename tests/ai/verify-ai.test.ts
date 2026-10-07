import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { verifyAiInfrastructure } from "../../scripts/verify-ai";
import type { EmbeddingResult, GenerationResult, LLMProvider } from "../../src/server/ai/types";
import { computeSourceHash } from "../../src/server/db/validation";

const MODEL = "fake-model";
const savedEnv = { model: process.env.GROQ_MODEL, jModel: process.env.JINA_EMBEDDING_MODEL, jDims: process.env.JINA_EMBEDDING_DIMENSIONS };
process.env.GROQ_MODEL = MODEL;
process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
process.env.JINA_EMBEDDING_DIMENSIONS = "1024";

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";
const DB = "44444444-4444-4444-8444-444444444444";

function vector(): number[] {
  const v = new Array(1024).fill(0);
  v[0] = 0.5;
  return v;
}

function emb(sourceText: string, task: string): EmbeddingResult {
  return {
    vector: vector(),
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText,
    sourceHash: computeSourceHash(sourceText),
    metadata: { provider: "jina", task, retrievedAt: "2026-01-01T00:00:00Z" },
  };
}

function fakeLlm(): LLMProvider {
  return {
    async generateText() {
      throw new Error("unused");
    },
    async generateStructured<T>(): Promise<GenerationResult<T>> {
      return {
        value: {
          labels: ["borrowed_conviction", "social_confirmation"],
          explanation: "Borrowed idea confirmed by a chat group.",
          confidence: 0.8,
          observedInputFacts: ["someone in my Telegram group called it", "everyone looked bullish"],
        } as T,
        provider: "fake",
        model: MODEL,
        promptVersion: "decision-origin.v1",
        runId: "run-1",
        attempts: 1,
      };
    },
  };
}

interface FakeClient extends Client {
  calls: string[];
  ended: boolean;
}

function fakeClient(searchOrder: string[] = [D1, D2, D3], opts: { failAt?: string } = {}): FakeClient {
  const calls: string[] = [];
  let draftIdx = 0;
  const draftIds = [D1, D2, D3, DB];
  let searchCalls = 0;
  const client = {
    calls,
    ended: false,
    async connect() {},
    async end() {
      client.ended = true;
    },
    async query(text: string, values?: readonly unknown[]) {
      calls.push(text);
      if (opts.failAt && text.startsWith(opts.failAt)) throw new Error("simulated failure");
      if (text.includes("count(*)::int")) return { rows: [{ users: 0, decisions: 0, embeddings: 0, runs: 0 }] };
      if (text.startsWith("INSERT INTO public.users")) return { rows: [{ id: values?.[0] }] };
      if (text.startsWith("INSERT INTO public.decisions"))
        return { rows: [{ id: draftIds[draftIdx++ % draftIds.length] }] };
      if (text.startsWith("INSERT INTO public.ai_runs")) return { rows: [{ id: "run-1" }] };
      if (text.includes("FROM public.ai_runs"))
        return {
          rows: [
            {
              id: "run-1",
              model: MODEL,
              pipeline: "decision-origin",
              prompt_version: "decision-origin.v1",
              status: "success",
              input_entity_ids: null,
              latency_ms: 5,
              token_usage: { usage: { inputTokens: 1 } },
            },
          ],
        };
      if (text.startsWith("INSERT INTO public.memory_embeddings")) return { rows: [{ id: "emb-1" }] };
      if (text.includes("ORDER BY embedding")) {
        searchCalls += 1;
        const order = searchCalls === 1 ? searchOrder : [DB];
        return { rows: order.map((id, i) => ({ entity_id: id, similarity: 0.9 - i * 0.1 })) };
      }
      if (text.includes("FROM public.memory_embeddings")) return { rows: [{ id: "emb-1" }] };
      return { rows: [] };
    },
  };
  return client as unknown as FakeClient;
}

function factories() {
  return {
    createLlm: () => fakeLlm(),
    createEmbedder: () => ({
      embedDocument: async (text: string) => emb(text, "retrieval.passage"),
      embedQuery: async (text: string) => emb(text, "retrieval.query"),
      embedMany: async (texts: readonly string[]) => texts.map((t) => emb(t, "retrieval.passage")),
    }),
  };
}

test("successful verification wraps work in BEGIN then ROLLBACK with cleanup and end", async () => {
  const client = fakeClient();
  const result = await verifyAiInfrastructure(client, factories().createLlm, factories().createEmbedder);
  assert.equal(result.status, "verified");
  assert.equal((result.groq as Record<string, unknown>).status, "verified");
  assert.equal((result.jina as Record<string, unknown>).status, "verified");
  assert.equal((result.pgvector as Record<string, unknown>).status, "verified");
  assert.equal(client.calls[0], "BEGIN");
  const rollbackIdx = client.calls.lastIndexOf("ROLLBACK");
  assert.ok(rollbackIdx > 0);
  assert.ok(client.calls.slice(rollbackIdx).some((q) => q.includes("count(*)::int")));
  assert.equal(client.ended, true);
});

test("owner filtering assertion exercised via second-owner search", async () => {
  const client = fakeClient();
  const result = await verifyAiInfrastructure(client, factories().createLlm, factories().createEmbedder);
  const pgvector = result.pgvector as Record<string, unknown>;
  assert.equal(pgvector.ownerFiltering, "A sees 3 own rows, B sees 1 own row");
  const searches = client.calls.filter((q) => q.includes("ORDER BY embedding"));
  assert.equal(searches.length, 2);
});

test("failed ranking marks verification failed and still rolls back", async () => {
  const client = fakeClient([D2, D1, D3]);
  const result = await verifyAiInfrastructure(client, factories().createLlm, factories().createEmbedder);
  assert.equal(result.status, "failed");
  assert.equal((result.embeddingRoundTrip as Record<string, unknown>).status, "failed");
  assert.equal(client.calls[0], "BEGIN");
  assert.ok(client.calls.includes("ROLLBACK"));
  assert.ok(client.calls.slice(client.calls.lastIndexOf("ROLLBACK")).some((q) => q.includes("count(*)::int")));
  assert.equal(client.ended, true);
});

test("client ends on hard errors before transaction opens", async () => {
  const client = fakeClient(undefined, { failAt: "BEGIN" });
  await assert.rejects(() => verifyAiInfrastructure(client, factories().createLlm, factories().createEmbedder));
  assert.equal(client.ended, true);
});

test("client ends when post-rollback cleanup query fails", async () => {
  const client = fakeClient(undefined, { failAt: "SELECT (SELECT count" });
  await assert.rejects(() => verifyAiInfrastructure(client, factories().createLlm, factories().createEmbedder));
  assert.equal(client.ended, true);
});

test.after(() => {
  if (savedEnv.model === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = savedEnv.model;
  if (savedEnv.jModel === undefined) delete process.env.JINA_EMBEDDING_MODEL;
  else process.env.JINA_EMBEDDING_MODEL = savedEnv.jModel;
  if (savedEnv.jDims === undefined) delete process.env.JINA_EMBEDDING_DIMENSIONS;
  else process.env.JINA_EMBEDDING_DIMENSIONS = savedEnv.jDims;
});
