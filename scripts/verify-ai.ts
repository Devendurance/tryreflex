import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import type { DbSession, Queryable } from "../src/server/db/client";
import { getDatabaseUrls } from "../src/server/db/config";
import { createRepositories } from "../src/server/db/repositories";
import { computeSourceHash } from "../src/server/db/validation";
import { GroqLLMProvider } from "../src/server/ai/groq";
import { JinaEmbeddingProvider } from "../src/server/ai/jina";
import { analyzeDecisionOrigin } from "../src/server/ai/decision-origin";
import type { AiRunRecorder, LLMProvider, EmbeddingProvider } from "../src/server/ai/types";
import { AIError } from "../src/server/ai/errors";

const ORIGIN_INPUT = "I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.";
const MEMORY_TEXTS = [
  "Entered a tokenized US stock after a Telegram call when the native US market was closed and most of the move had already occurred.",
  "Independent earnings research with a defined invalidation and controlled position size.",
  "Re-entered a crypto trade shortly after a losing exit with larger size.",
];
const QUERY_TEXT = "I am thinking of following a social call after the stock has already moved.";

function safeFailure(error: unknown): { category: string } {
  return { category: error instanceof AIError ? error.code : error instanceof assert.AssertionError ? "VERIFICATION_FAILED" : "PERSISTENCE_OR_CONFIGURATION" };
}

export async function verifyAiInfrastructure(
  client: Client,
  createLlm: (recorder: AiRunRecorder) => LLMProvider,
  createEmbedder: () => EmbeddingProvider,
): Promise<Record<string, unknown>> {
  const userA = randomUUID();
  const userB = randomUUID();
  let inTransaction = false;
  let savepointSequence = 0;
  const report: Record<string, unknown> = { status: "failed" };
  let failure = false;
  await client.connect();
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const session: DbSession = {
      async query<T>(text: string, values?: readonly unknown[]) {
        const result = await client.query(text, values ? [...values] : undefined);
        return { rows: result.rows as T[] };
      },
      async transaction<T>(fn: (q: Queryable) => Promise<T>) {
        const name = `ai_verification_${++savepointSequence}`;
        await client.query(`SAVEPOINT ${name}`);
        try {
          const result = await fn(session);
          await client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await client.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      },
    };
    const reposA = createRepositories(session, { userId: userA, provider: "isolated-ai-rollback-verification", subject: userA });
    const reposB = createRepositories(session, { userId: userB, provider: "isolated-ai-rollback-verification", subject: userB });
    await reposA.users.provision();
    await reposB.users.provision();
    await client.query("SAVEPOINT groq_verification");
    try {
      const result = await analyzeDecisionOrigin(createLlm(reposA.aiRuns), ORIGIN_INPUT);
      assert.equal(result.model, process.env.GROQ_MODEL);
      assert.ok(result.value.labels.includes("borrowed_conviction"));
      assert.ok(result.value.labels.includes("social_confirmation"));
      assert.ok(!result.value.labels.includes("original_research"));
      assert.ok(!result.value.labels.includes("pure_impulse"));
      assert.ok(result.value.observedInputFacts.length > 0);
      assert.ok(result.value.observedInputFacts.every((quote) => ORIGIN_INPUT.includes(quote)));
      const run = await reposA.aiRuns.get(result.runId);
      assert.ok(run);
      assert.equal(run.model, result.model);
      assert.equal(run.pipeline, "decision-origin");
      assert.equal(run.prompt_version, "decision-origin.v1");
      assert.equal(run.status, "success");
      assert.equal(run.input_entity_ids, null);
      report.groq = { status: "verified", model: result.model, result: result.value, run: { pipeline: run.pipeline, promptVersion: run.prompt_version, status: run.status, latencyMs: run.latency_ms, metadata: run.token_usage } };
      await client.query("RELEASE SAVEPOINT groq_verification");
    } catch (error) {
      failure = true;
      report.groq = { status: "failed", ...safeFailure(error) };
      await client.query("ROLLBACK TO SAVEPOINT groq_verification");
      await client.query("RELEASE SAVEPOINT groq_verification");
    }
    await client.query("SAVEPOINT jina_verification");
    try {
      const embedder = createEmbedder();
      const documents = await embedder.embedMany(MEMORY_TEXTS, "document");
      const query = await embedder.embedQuery(QUERY_TEXT);
      assert.equal(documents.length, 3);
      for (const [index, document] of documents.entries()) {
        assert.equal(document.model, "jina-embeddings-v5-text-small");
        assert.equal(document.dimensions, 1024);
        assert.equal(document.vector.length, 1024);
        assert.equal(document.sourceHash, computeSourceHash(MEMORY_TEXTS[index]));
        assert.equal(document.metadata.task, "retrieval.passage");
      }
      assert.equal(query.model, "jina-embeddings-v5-text-small");
      assert.equal(query.vector.length, 1024);
      assert.equal(query.dimensions, 1024);
      assert.equal(query.metadata.task, "retrieval.query");
      report.jina = { status: "verified", model: query.model, documentDimensions: documents.map((d) => d.vector.length), queryDimensions: query.vector.length, documentTask: documents[0].metadata.task, queryTask: query.metadata.task };
      const entityIds: string[] = [];
      for (const [index, document] of documents.entries()) {
        const decision = await reposA.decisions.createDraft({ rawInput: MEMORY_TEXTS[index] });
        const entityId = String(decision.id);
        entityIds.push(entityId);
        const stored = await reposA.memoryEmbeddings.storeValidatedEmbedding({ entityType: "decision", entityId, embedding: document.vector, model: document.model, dimensions: document.dimensions, sourceText: document.sourceText, metadata: document.metadata });
        const duplicate = await reposA.memoryEmbeddings.storeValidatedEmbedding({ entityType: "decision", entityId, embedding: document.vector, model: document.model, dimensions: document.dimensions, sourceText: document.sourceText, metadata: document.metadata });
        assert.equal(duplicate.id, stored.id);
      }
      const otherDecision = await reposB.decisions.createDraft({ rawInput: MEMORY_TEXTS[0] });
      await reposB.memoryEmbeddings.storeValidatedEmbedding({ entityType: "decision", entityId: String(otherDecision.id), embedding: documents[0].vector, model: documents[0].model, dimensions: documents[0].dimensions, sourceText: documents[0].sourceText, metadata: documents[0].metadata });
      const rows = await reposA.memoryEmbeddings.searchByVector({ embedding: query.vector, model: query.model, dimensions: query.dimensions, limit: 10 });
      assert.equal(rows.length, 3);
      assert.equal(rows[0].entity_id, entityIds[0], "social-call memory must rank first");
      assert.ok(rows.every((row) => entityIds.includes(String(row.entity_id))), "foreign owner's memory leaked");
      assert.ok(rows.every((row) => typeof row.similarity === "number" && Number.isFinite(row.similarity)));
      const otherRows = await reposB.memoryEmbeddings.searchByVector({ embedding: query.vector, model: query.model, dimensions: query.dimensions, limit: 10 });
      assert.equal(otherRows.length, 1);
      assert.equal(otherRows[0].entity_id, otherDecision.id);
      report.pgvector = { status: "verified", deduplication: "same row returned", ownerFiltering: "A sees 3 own rows, B sees 1 own row", ranking: rows.map((row) => ({ memory: MEMORY_TEXTS[entityIds.indexOf(String(row.entity_id))], similarity: row.similarity })) };
      await client.query("RELEASE SAVEPOINT jina_verification");
    } catch (error) {
      failure = true;
      report.embeddingRoundTrip = { status: "failed", ...safeFailure(error) };
      await client.query("ROLLBACK TO SAVEPOINT jina_verification");
      await client.query("RELEASE SAVEPOINT jina_verification");
    }
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query<{ users: number; decisions: number; embeddings: number; runs: number }>(
      "SELECT (SELECT count(*)::int FROM public.users WHERE id=ANY($1::uuid[])) AS users, (SELECT count(*)::int FROM public.decisions WHERE user_id=ANY($1::uuid[])) AS decisions, (SELECT count(*)::int FROM public.memory_embeddings WHERE user_id=ANY($1::uuid[])) AS embeddings, (SELECT count(*)::int FROM public.ai_runs WHERE user_id=ANY($1::uuid[])) AS runs",
      [[userA, userB]],
    );
    assert.deepEqual(remaining.rows[0], { users: 0, decisions: 0, embeddings: 0, runs: 0 });
    report.rollback = { status: "verified", remainingRows: remaining.rows[0] };
    report.status = failure ? "failed" : "verified";
    return report;
  } finally {
    try {
      if (inTransaction) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  try {
    const client = new Client({ connectionString: getDatabaseUrls().unpooled, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 });
    const report = await verifyAiInfrastructure(client, (recorder) => new GroqLLMProvider({ recorder }), () => new JinaEmbeddingProvider());
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "verified") process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: "failed", ...safeFailure(error) }));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/verify-ai.ts")) void main();
