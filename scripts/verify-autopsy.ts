import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createRepositories } from "../src/server/db/repositories";
import { createMemoryStore } from "../src/server/ai/memory-store";
import { buildMemoryText } from "../src/server/ai/memory-text";
import { JinaEmbeddingProvider } from "../src/server/ai/jina";
import { GroqLLMProvider } from "../src/server/ai/groq";
import { AIError } from "../src/server/ai/errors";
import type { LLMProvider, StructuredGenerationRequest } from "../src/server/ai/types";
import { targetDriftMetrics, type TargetDriftFinding } from "../src/server/reviews/plan-drift";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { z } from "zod";
import { NeonAuthProvider } from "../src/server/auth/neon";
import type { DbSession, Queryable } from "../src/server/db/client";
import { getDatabaseUrls } from "../src/server/db/config";
import { decisionSnapshotSchema } from "../src/server/db/validation";
import { createConfirmHandler, createParseHandler } from "../src/server/decisions/http";
import { createManualTradeHandler } from "../src/server/trades/http";
import { createGenerateReviewHandler, createGetReviewHandler } from "../src/server/reviews/http";
import { classifyProcessOutcome, computeDecisionQuality, computeTradeMetrics, computeSparseManualMetrics, REVIEW_DIMENSIONS, decimalUnits, type ReviewDimension } from "../src/server/review-policy";

const BASE = "http://localhost:3002";
let verificationStage = "input";
export const jarSchema = z.array(z.looseObject({ cookies: z.array(z.union([
  z.string().min(1),
  z.strictObject({ name: z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/), value: z.string().regex(/^[^;\r\n]*$/) }).transform((cookie) => `${cookie.name}=${cookie.value}`),
])).min(1) })).min(2);
export const genuineInputSchema = z.strictObject({
  decisionText: z.string().min(1),
  memoryQuery: z.string().trim().min(1).max(32768).optional(),
  snapshot: decisionSnapshotSchema.omit({ origins: true }).extend({ origins: decisionSnapshotSchema.shape.origins.optional() }),
  trade: z.strictObject({
    symbol: z.string().min(1), side: z.enum(["long", "short"]), quantity: z.string().nullish(), entryPrice: z.string().nullish(),
    exitPrice: z.string().nullish(), fees: z.string().nullish(), realizedPnl: z.string().nullish(),
    openedAt: z.iso.datetime({ offset: true }).nullish(), closedAt: z.iso.datetime({ offset: true }).nullish(),
    settlementCurrency: z.string().nullish(), symbolOverrideReason: z.string().nullish(),
    executionState: z.enum(["open", "closed", "unknown"]).nullish(),
    amountInvested: z.string().nullish(), proceedsReceived: z.string().nullish(),
    cashFlowBasis: z.enum(["gross_excluding_fees", "net_including_fees", "unknown"]).nullish(),
    entryMarketCap: z.string().nullish(), exitMarketCap: z.string().nullish(), peakObservedMarketCap: z.string().nullish(),
    marketCapCurrency: z.string().nullish(),
    captureBasis: z.enum(["contemporaneous", "retrospective", "unknown"]).nullish(),
    retrospectiveComments: z.string().nullish(), contractAddress: z.string().nullish(), chain: z.string().nullish(),
  }),
});

export function resolveVerificationSnapshot(
  input: z.infer<typeof genuineInputSchema>["snapshot"],
  inferredOrigins: unknown,
) {
  return decisionSnapshotSchema.parse({ ...input, origins: input.origins ?? decisionSnapshotSchema.shape.origins.parse(inferredOrigins) });
}

function request(body: unknown) {
  return new Request(`${BASE}/api/verification`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
}

async function managedSession(cookies: readonly string[]) {
  const response = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "), origin: BASE }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  assert.equal(response.status, 200);
  const data = z.looseObject({ user: z.looseObject({ id: z.string().min(1), email: z.string().optional(), name: z.string().optional() }) }).parse(await response.json());
  return { data, error: null };
}

async function expectSuccess(response: Response, status: number) {
  const body = await response.json();
  assert.equal(response.status, status, `verification operation failed (${typeof body.error?.code === "string" ? body.error.code : "unknown"})`);
  return body;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const jarPath = process.argv[2];
  const tradePath = process.argv[3];
  if (!jarPath || !tradePath) {
    console.log(JSON.stringify({ status: "blocked", category: !jarPath ? "REAL_AUTH_SESSION_REQUIRED" : "GENUINE_TRADE_INPUT_REQUIRED", realGroqAutopsyVerified: false }));
    process.exitCode = 1;
    return;
  }
  const jar = jarSchema.parse(JSON.parse(await readFile(jarPath, "utf8")));
  const genuine = genuineInputSchema.parse(JSON.parse(await readFile(tradePath, "utf8")));
  const memoryQuery = process.argv[4] === undefined
    ? genuine.memoryQuery
    : z.string().min(1).max(2000).parse(process.argv[4]);
  const client = new Client({ connectionString: getDatabaseUrls().unpooled, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  let inTransaction = false;
  let sequence = 0;
  let decisionId: string | null = null;
  let tradeId: string | null = null;
  let reviewId: string | null = null;
  let runId: string | null = null;
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
        const name = `genuine_autopsy_${++sequence}`;
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
    const authA = new NeonAuthProvider({ db: session, auth: { getSession: () => managedSession(jar[0].cookies) } });
    const authB = new NeonAuthProvider({ db: session, auth: { getSession: () => managedSession(jar[1].cookies) } });
    verificationStage = "managed_session";
    const owner = await authA.getContext();
    assert.ok(owner);
    verificationStage = "decision_parse";
    const draft = await expectSuccess(await createParseHandler({ db: session, authProvider: authA })(request({ text: genuine.decisionText })), 201);
    decisionId = z.string().uuid().parse(draft.decision.id);
    assert.equal(draft.decision.raw_input, genuine.decisionText);
    const snapshot = resolveVerificationSnapshot(genuine.snapshot, draft.inference.origins.map((origin: { label: string }) => origin.label));
    for (const origin of draft.inference.origins) {
      assert.ok(origin.observedInputFacts.length > 0);
      for (const quote of origin.observedInputFacts) assert.ok(genuine.decisionText.includes(quote));
    }
    verificationStage = "decision_confirm";
    await expectSuccess(await createConfirmHandler({ db: session, authProvider: authA })(request(snapshot), { id: decisionId }), 200);
    verificationStage = "trade_attach";
    const attached = await expectSuccess(await createManualTradeHandler({ db: session, authProvider: authA })(request({ ...genuine.trade, decisionId })), 201);
    tradeId = z.string().uuid().parse(attached.trade.id);
    verificationStage = "autopsy_generate";
    const runRecorder = createRepositories(session, owner).aiRuns;
    const groq = new GroqLLMProvider({ maxCompletionTokens: 8192, recorder: { record: async (input) => {
      const saved = await runRecorder.record(input);
      const meta = input as Record<string, unknown>;
      console.log(JSON.stringify({ status: "ai_run_recorded", pipeline: meta.pipeline ?? null, model: meta.model ?? null, promptVersion: meta.promptVersion ?? null, runStatus: meta.status ?? null, safeErrors: meta.validationErrors ?? null, tokenUsage: meta.tokenUsage ?? null }));
      return saved;
    } } });
    const llm: LLMProvider = {
      generateText: (generationRequest) => groq.generateText(generationRequest),
      generateStructured: async <T>(structuredRequest: StructuredGenerationRequest<T>) => {
        const originalValidate = structuredRequest.validate;
        return groq.generateStructured<T>({
          ...structuredRequest,
          validate: (wireValue) => {
            try {
              originalValidate?.(wireValue);
            } catch (error) {
              if (error instanceof AIError && error.grounding) {
                console.log(JSON.stringify({
                  status: "local_grounding_diagnostic",
                  grounding: error.grounding,
                  rejectedOutput: structuredRequest.schema.parse(wireValue),
                }, null, 2));
              }
              throw error;
            }
          },
        });
      },
    };
    console.log(JSON.stringify({ status: "decision_confirmed_before_autopsy", decisionOrigins: draft.inference.origins, confirmedSnapshot: snapshot }));
    const generated = await expectSuccess(await createGenerateReviewHandler({ db: session, authProvider: authA, llm })(request({ tradeId })), 201);
    reviewId = z.string().uuid().parse(generated.review.id);
    runId = z.string().uuid().parse(generated.runId);
    verificationStage = "autopsy_read_and_invariants";
    const read = await expectSuccess(await createGetReviewHandler({ db: session, authProvider: authA })(new Request(`${BASE}/api/reviews/${reviewId}`), { id: reviewId }), 200);
    const foreign = await createGetReviewHandler({ db: session, authProvider: authB })(new Request(`${BASE}/api/reviews/${reviewId}`), { id: reviewId });
    assert.equal(foreign.status, 404);
    const dimensions = z.array(z.looseObject({ dimension: z.enum(REVIEW_DIMENSIONS), score: z.union([z.number().int(), z.string(), z.null()]) })).length(5).parse(read.review.dimensions);
    const scores = {} as Record<ReviewDimension, number | null>;
    for (const dimension of dimensions) scores[dimension.dimension] = dimension.score === null ? null : Number(dimension.score);
    const quality = computeDecisionQuality(scores);
    assert.equal(quality.overallScore, generated.decisionQuality.overallScore);
    const records = await client.query("SELECT t.*, d.confirmed_at, d.confirmed_snapshot FROM public.trades t JOIN public.decisions d ON d.user_id=t.user_id AND d.id=t.decision_id WHERE t.user_id=$1 AND t.id=$2", [owner.userId, tradeId]);
    assert.equal(records.rows.length, 1);
    const record = records.rows[0];
    const provenance = await client.query("SELECT facts FROM public.trade_events WHERE user_id=$1 AND trade_id=$2 AND facts->>'kind'='trade_provenance' ORDER BY created_at,id LIMIT 1", [owner.userId, tradeId]);
    assert.equal(provenance.rows.length, 1);
    const observations = provenance.rows[0].facts.manualObservations;
    const nullableDecimal = (value: unknown): string | null => typeof value === "string" ? value : null;
    const expectedMetrics = provenance.rows[0].facts.calculationBasis === "manual_observations"
      ? computeSparseManualMetrics({
          quantity: nullableDecimal(record.quantity), entryPrice: nullableDecimal(record.entry_price), exitPrice: nullableDecimal(record.exit_price),
          side: record.side, openedAt: record.opened_at, closedAt: record.closed_at,
          executionState: observations.executionState, fees: genuine.trade.fees == null ? null : record.fees,
          netRealizedPnl: nullableDecimal(record.realized_pnl), amountInvested: nullableDecimal(observations.amountInvested),
          proceedsReceived: nullableDecimal(observations.proceedsReceived), cashFlowBasis: observations.cashFlowBasis,
          settlementCurrency: observations.settlementCurrency ?? null, entryMarketCap: nullableDecimal(observations.entryMarketCap),
          exitMarketCap: nullableDecimal(observations.exitMarketCap), peakObservedMarketCap: nullableDecimal(observations.peakObservedMarketCap),
          intendedTakeProfitMarketCap: observations.marketCapCurrency !== null && observations.marketCapCurrency !== undefined && observations.marketCapCurrency === record.confirmed_snapshot.marketCapCurrency ? nullableDecimal(record.confirmed_snapshot.intendedTakeProfitMarketCap) : null,
          marketCapCurrency: observations.marketCapCurrency ?? null,
          captureBasis: record.confirmed_snapshot.knowledgeBasis === "retrospective_recollection" ? "retrospective" : observations.captureBasis,
        }, { confirmedAt: record.confirmed_at, intendedEntry: genuine.snapshot.intendedEntry ?? null })
      : computeTradeMetrics({ quantity: record.quantity, entryPrice: record.entry_price, exitPrice: record.exit_price, side: record.side, openedAt: record.opened_at, closedAt: record.closed_at, fees: genuine.trade.fees == null ? null : record.fees, netRealizedPnl: record.realized_pnl, calculationBasis: "linear_base_quantity" }, { confirmedAt: record.confirmed_at, intendedEntry: genuine.snapshot.intendedEntry ?? null });
    assert.equal(read.review.metrics.tradeMetrics.netRealizedPnl, expectedMetrics.netRealizedPnl);
    assert.equal(read.review.metrics.tradeMetrics.outcome, expectedMetrics.outcome);
    assert.equal(read.review.metrics.tradeMetrics.holdingDurationMs, expectedMetrics.holdingDurationMs);
    if ("marketCapMovementMultiple" in expectedMetrics) {
      assert.equal(read.review.metrics.tradeMetrics.marketCapMovementMultiple, expectedMetrics.marketCapMovementMultiple);
      assert.equal(read.review.metrics.tradeMetrics.exitVsTargetMarketCapMultiple, expectedMetrics.exitVsTargetMarketCapMultiple);
      assert.equal(read.review.metrics.tradeMetrics.quantity, record.quantity);
      assert.equal(read.review.metrics.tradeMetrics.entryPrice, record.entry_price);
    }
    assert.deepEqual(generated.decisionQuality, quality);
    assert.deepEqual(read.review.decisionQuality, quality);
    assert.equal(generated.classification, classifyProcessOutcome(quality.status === "final" ? quality.score : null, expectedMetrics.outcome as Parameters<typeof classifyProcessOutcome>[1]));
    assert.deepEqual(record.confirmed_snapshot, snapshot);
    for (const [key, column] of [["quantity", "quantity"], ["entryPrice", "entry_price"], ["exitPrice", "exit_price"], ["openedAt", "opened_at"], ["closedAt", "closed_at"], ["realizedPnl", "realized_pnl"]] as const) {
      if (genuine.trade[key] == null) assert.equal(record[column], null);
    }
    for (const key of ["amountInvested", "proceedsReceived", "entryMarketCap", "exitMarketCap", "peakObservedMarketCap", "retrospectiveComments"] as const) {
      if (genuine.trade[key] !== undefined) assert.equal(observations[key], genuine.trade[key]);
    }
    if (genuine.trade.fees != null) assert.equal(decimalUnits(record.fees), decimalUnits(genuine.trade.fees));
    if ("peakMarketCapMovementMultiple" in expectedMetrics) assert.equal(read.review.metrics.tradeMetrics.peakMarketCapMovementMultiple, expectedMetrics.peakMarketCapMovementMultiple);
    const links = await client.query<{ owner_valid: boolean; count: number }>(
      "SELECT bool_and(e.user_id=$1) AS owner_valid,count(*)::int AS count FROM public.review_dimension_evidence l JOIN public.review_dimensions dim ON dim.user_id=l.user_id AND dim.id=l.dimension_id JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE dim.user_id=$1 AND dim.review_id=$2", [owner.userId, reviewId],
    );
    if (links.rows[0].count > 0) assert.equal(links.rows[0].owner_valid, true);
    assert.ok(Array.isArray(read.review.planDrift));
    const planDrift = read.review.planDrift as TargetDriftFinding[];
    assert.deepEqual(planDrift, generated.planDrift);
    const driftRefs = [...new Set(planDrift.flatMap((finding) => finding.evidenceRefs))];
    if (driftRefs.length > 0) {
      const ownedDrift = await client.query("SELECT id FROM public.evidence_records WHERE user_id=$1 AND id=ANY($2::uuid[]) AND (decision_id=$3 OR trade_id=$4)", [owner.userId, driftRefs, decisionId, tradeId]);
      assert.equal(ownedDrift.rows.length, driftRefs.length);
    }
    for (const finding of planDrift) {
      assert.equal(finding.type, "target_drift");
      assert.equal(finding.evidenceBasis, "retrospective_user_report");
      assert.equal(decimalUnits(finding.originalPlan.value), decimalUnits(record.confirmed_snapshot.intendedTakeProfitMarketCap));
      assert.deepEqual(finding.metrics, targetDriftMetrics(finding.originalPlan.value, finding.revisedPlan.value, finding.observations.peakMarketCap, finding.observations.exitMarketCap));
      for (const fact of [...finding.observedFacts, { evidenceId: finding.ordering.evidenceId, quote: finding.ordering.quote }]) {
        const source = read.review.evidence.find((entry: { evidenceId: string }) => entry.evidenceId === fact.evidenceId);
        assert.ok(source && typeof source.text === "string" && source.text.includes(fact.quote));
      }
    }
    const run = await client.query("SELECT model,pipeline,prompt_version,status FROM public.ai_runs WHERE user_id=$1 AND id=$2", [owner.userId, runId]);
    assert.equal(run.rows[0]?.pipeline, "decision-autopsy");
    assert.equal(run.rows[0]?.status, "success");
    const report: Record<string, unknown> = {
      status: "verified", verificationSurface: "actual route handlers + real managed sessions + genuine user input + Neon rollback",
      model: run.rows[0].model, promptVersion: run.rows[0].prompt_version,
      decisionOriginLabels: draft.inference.origins.map((origin: { label: string }) => origin.label),
      decisionOrigins: draft.inference.origins, originBasis: "model inference, not an independently user-confirmed classification",
      confirmedSnapshot: record.confirmed_snapshot, tradeSummary: read.review.trade,
      context: { status: "unavailable", reason: "No time-aligned decision context attached by this verifier. Current enrichment is not historical evidence." },
      deterministicMetrics: read.review.metrics.tradeMetrics, decisionQuality: quality, outcome: expectedMetrics.outcome,
      classification: generated.classification, dimensionResults: read.review.dimensions, planDrift,
      summary: read.review.summary, summaryBasis: read.review.summaryBasis, lessonBasis: read.review.lessonBasis,
      lessons: read.review.lessons, evidence: read.review.evidence,
      evidenceLinks: links.rows[0].count, foreignRead: 404, originalSnapshotPreserved: true,
      unavailableDimensions: read.review.dimensions.filter((dimension: { score: unknown }) => dimension.score === null).map((dimension: { dimension: string; explanation: string }) => ({ dimension: dimension.dimension, explanation: dimension.explanation })),
    };
    console.log(JSON.stringify({ ...report, status: "autopsy_generated_before_rollback" }, null, 2));
    if (memoryQuery !== undefined) {
      verificationStage = "memory_embedding_and_retrieval";
      const repos = createRepositories(session, owner);
      const embedder = new JinaEmbeddingProvider();
      const memory = createMemoryStore(repos, embedder);
      const canonical = buildMemoryText({
        kind: "review", assetSymbol: genuine.trade.symbol,
        findings: [read.review.summary, ...read.review.dimensions.map((dimension: { explanation: string }) => dimension.explanation), ...read.review.lessons.map((lesson: { text: string }) => lesson.text), ...planDrift.map((finding) => finding.explanation), ...planDrift.flatMap((finding) => finding.userSelfAssessment.map((assessment) => `User retrospective self-assessment: ${assessment.text}`))],
        ...(generated.classification === null ? {} : { processClassification: generated.classification }),
      });
      const stored = await memory.storeDocument({ entityType: "review", entityId: reviewId, sourceText: canonical.text, metadata: { textVersion: canonical.version } });
      assert.equal(stored.user_id, owner.userId);
      assert.equal(stored.entity_id, reviewId);
      assert.equal(stored.model, "jina-embeddings-v5-text-small");
      assert.equal(stored.dimensions, 1024);
      const query = await embedder.embedQuery(memoryQuery);
      assert.equal(query.model, stored.model);
      assert.equal(query.dimensions, stored.dimensions);
      const hits = await repos.memoryEmbeddings.searchByVector({ embedding: query.vector, model: query.model, dimensions: query.dimensions, limit: 10 });
      const rank = hits.findIndex((hit) => hit.entity_type === "review" && hit.entity_id === reviewId);
      assert.ok(rank >= 0, "genuine review must be found by semantic retrieval");
      const foreignOwner = await authB.getContext();
      assert.ok(foreignOwner);
      assert.notEqual(foreignOwner.userId, owner.userId);
      const foreignRepos = createRepositories(session, foreignOwner);
      assert.equal(await foreignRepos.memoryEmbeddings.get(String(stored.id)), null);
      const foreignHits = await foreignRepos.memoryEmbeddings.searchByVector({ embedding: query.vector, model: query.model, dimensions: query.dimensions, limit: 10 });
      assert.ok(!foreignHits.some((hit) => hit.entity_id === reviewId));
      report.memory = { status: "verified", model: stored.model, dimensions: stored.dimensions, textVersion: canonical.version, sourceText: canonical.text, query: memoryQuery, retrievalRank: rank + 1, similarity: hits[rank].similarity, ownerIsolation: "verified" };
    }
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query<{ decisions: number; trades: number; reviews: number; dimensions: number; embeddings: number; aiRuns: number; evidence: number; events: number }>(
      "SELECT (SELECT count(*)::int FROM public.decisions WHERE id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE id=$2) AS trades,(SELECT count(*)::int FROM public.reviews WHERE id=$3) AS reviews,(SELECT count(*)::int FROM public.review_dimensions WHERE review_id=$3) AS dimensions,(SELECT count(*)::int FROM public.memory_embeddings WHERE entity_type='review' AND entity_id=$3) AS embeddings,(SELECT count(*)::int FROM public.ai_runs WHERE id=ANY($4::uuid[])) AS \"aiRuns\",(SELECT count(*)::int FROM public.evidence_records WHERE decision_id=$1 OR trade_id=$2) AS evidence,(SELECT count(*)::int FROM public.trade_events WHERE trade_id=$2) AS events", [decisionId, tradeId, reviewId, [draft.ai.runId, runId]],
    );
    assert.deepEqual(remaining.rows[0], { decisions: 0, trades: 0, reviews: 0, dimensions: 0, embeddings: 0, aiRuns: 0, evidence: 0, events: 0 });
    console.log(JSON.stringify({ ...report, rollback: { status: "verified", remainingRows: remaining.rows[0] } }, null, 2));
  } finally {
    try {
      if (inTransaction) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}

if (process.argv[1] && /^verify-autopsy\.(?:ts|js)$/.test(basename(process.argv[1]))) {
  main().catch((error: unknown) => {
    const details = error instanceof assert.AssertionError ? { operator: error.operator, assertion: error.message.startsWith("verification operation failed") ? error.message.split("\n")[0] : "invariant failed" } : {};
    console.log(JSON.stringify({ status: "failed", category: "REAL_AUTOPSY_VERIFICATION_FAILED", stage: verificationStage, errorType: error instanceof Error ? error.name : "unknown", ...details, realGroqAutopsyVerified: false }));
    process.exitCode = 1;
  });
}
