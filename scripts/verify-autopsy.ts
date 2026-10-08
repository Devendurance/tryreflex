import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
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
    const replayPath = process.env.VERIFY_DECISION_DNA === "1" ? process.env.VERIFY_ACCEPTED_REVIEW_FILE : undefined;
    const replayFile = replayPath ? await readFile(replayPath, "utf8") : null;
    const replayStart = replayFile?.lastIndexOf('\n{\n  "status": "verified"') ?? -1;
    if (replayFile !== null) assert.ok(replayStart >= 0, "accepted historical artifact must contain its final verified report");
    const historicalSchema = z.looseObject({
      status: z.literal("verified"), model: z.literal("openai/gpt-oss-120b"), promptVersion: z.literal("decision-autopsy.v22"),
      originalSnapshotPreserved: z.literal(true), confirmedSnapshot: z.record(z.string(), z.unknown()),
      dimensionResults: z.array(z.looseObject({ dimension: z.enum(REVIEW_DIMENSIONS), score: z.string().nullable(), explanation: z.string(), confidence: z.string(), observedFacts: z.array(z.strictObject({ evidenceId: z.string().uuid(), quote: z.string() })), inferredFindings: z.array(z.strictObject({ finding: z.string(), evidenceRefs: z.array(z.string().uuid()) })) })).length(5),
      lessons: z.array(z.strictObject({ text: z.string(), evidenceRefs: z.array(z.string().uuid()) })).length(1),
      evidence: z.array(z.looseObject({ evidenceId: z.string().uuid(), kind: z.string(), label: z.string(), text: z.string() })),
      rollback: z.looseObject({ status: z.literal("verified"), remainingRows: z.record(z.string(), z.literal(0)) }),
    });
    const historical = replayFile === null ? null : historicalSchema.parse(JSON.parse(replayFile.slice(replayStart)));
    if (historical) assert.deepEqual(historical.confirmedSnapshot, snapshot, "historical replay must preserve the genuine confirmed snapshot exactly");
    const llm: LLMProvider = {
      generateText: (generationRequest) => groq.generateText(generationRequest),
      generateStructured: async <T>(structuredRequest: StructuredGenerationRequest<T>) => {
        const originalValidate = structuredRequest.validate;
        if (historical) {
          const supplied = z.looseObject({ evidenceLedger: z.array(z.looseObject({ evidenceId: z.string().uuid(), evidenceType: z.string(), quotes: z.array(z.looseObject({ quoteRef: z.string(), quote: z.string() })) })), planDrift: z.array(z.looseObject({ behaviorQuoteRefs: z.array(z.string()).min(1) })).length(1) }).parse(JSON.parse(structuredRequest.input));
          const quoteFor = (fact: { evidenceId: string; quote: string }) => {
            const oldSource = historical.evidence.find((entry) => entry.evidenceId === fact.evidenceId);
            assert.ok(oldSource && oldSource.text.includes(fact.quote));
            const source = supplied.evidenceLedger.find((entry) => entry.evidenceType === oldSource.kind && entry.quotes.some((quote) => quote.quote === fact.quote));
            const quote = source?.quotes.find((entry) => entry.quote === fact.quote);
            assert.ok(quote, "every historical quote must map exactly to its newly owned source evidence");
            return quote.quoteRef;
          };
          const historicalLesson = historical.lessons[0].text;
          const takeawayStart = historicalLesson.indexOf("When you raise your profit target,");
          const takeawayEnd = historicalLesson.indexOf(" These are retrospective market-cap observations,");
          assert.ok(takeawayStart >= 0 && takeawayEnd > takeawayStart, "frozen accepted lesson must retain its original model takeaway");
          const wire = {
            dimensions: historical.dimensionResults.map((dimension) => ({
              dimension: dimension.dimension, score: dimension.score === null ? null : Number(dimension.score), explanation: dimension.explanation, confidence: Number(dimension.confidence),
              observedFacts: dimension.observedFacts.map((fact) => ({ quoteRef: quoteFor(fact) })),
              inferredFindings: dimension.inferredFindings.map((finding) => ({ finding: finding.finding, supportQuotes: finding.evidenceRefs.map((id) => {
                const fact = dimension.observedFacts.find((entry) => entry.evidenceId === id);
                assert.ok(fact, "historical inferred finding must retain observed source support");
                return quoteFor(fact);
              }) })),
            })),
            lessons: [],
            planDriftLessons: [{ text: historicalLesson.slice(takeawayStart, takeawayEnd), executionQuoteRef: supplied.planDrift[0].behaviorQuoteRefs[0], behavioralQuoteRef: supplied.planDrift[0].behaviorQuoteRefs[0] }],
          };
          const value = structuredRequest.schema.parse(wire);
          originalValidate?.(value);
          const saved = await runRecorder.record({ pipeline: "decision-autopsy", model: historical.model, promptVersion: structuredRequest.promptVersion, inputEntityIds: structuredRequest.inputEntityIds, status: "success", latencyMs: 0, tokenUsage: { usage: {}, run: { provider: "historical_groq_review_replay", sourceArtifactSha256: createHash("sha256").update(replayFile!).digest("hex"), originalPromptVersion: historical.promptVersion, noNewAutopsyGeneration: true } } });
          return { value, provider: "historical_groq_review_replay", model: historical.model, promptVersion: structuredRequest.promptVersion, runId: String(saved.id), attempts: 0 };
        }
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
      status: "verified", verificationSurface: historical ? "historical accepted real Groq review replay + actual route handlers + real managed sessions + genuine user input + real Jina + Neon rollback" : "actual route handlers + real managed sessions + genuine user input + Neon rollback",
      autopsySource: historical ? "frozen_accepted_groq_v22_review" : "new_live_groq_generation", newGroqAutopsyGenerated: historical === null,
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
    const dnaPatternIds: string[] = [];
    if (process.env.VERIFY_DECISION_DNA === "1") {
      verificationStage = "decision_dna";
      const { createPatternsRepository } = await import("../src/server/patterns/repository");
      const { createRecomputePatternsHandler, createDNAHandler } = await import("../src/server/patterns/http");
      const { DNA_QUERIES } = await import("../src/server/decision-dna-queries");
      const existing = await client.query("SELECT id FROM public.patterns WHERE user_id=$1 AND observed_statistics->>'producer'='decision-dna.v1'", [owner.userId]);
      assert.equal(existing.rows.length, 0, "sparse DNA proof requires no pre-existing DNA patterns for this verification owner");
      const jina = new JinaEmbeddingProvider();
      let documentCalls = 0;
      const countedJina = {
        embedDocument: async (text: string) => { documentCalls += 1; return jina.embedDocument(text); },
        embedQuery: (text: string) => jina.embedQuery(text),
        embedMany: (texts: readonly string[], mode: "document" | "query") => jina.embedMany(texts, mode),
      };
      const recompute = createRecomputePatternsHandler({ db: session, authProvider: authA, embedder: countedJina });
      const first = await expectSuccess(await recompute(request({})), 200);
      const view = await expectSuccess(await createDNAHandler({ db: session, authProvider: authA })(), 200);
      assert.equal(first.eventsLoaded, 1, "genuine sparse proof must contain exactly one eligible review");
      assert.equal(view.evidenceStats.independentDecisionCount, 1);
      for (const key of ["edges", "leaks", "influences", "executionPatterns", "regimes"] as const) assert.equal(view[key].length, 0);
      assert.ok(view.observations.length > 0);
      assert.ok(view.observations.every((item: { status: string; count: number }) => item.status === "observation" && item.count === 1));
      const targetObservation = view.observations.find((item: { category: string; stats: { feature: string } }) => item.category === "execution" && item.stats.feature === "target_drift");
      assert.ok(targetObservation, "genuine target drift must remain an observation");
      assert.deepEqual(targetObservation.supportingDecisionIds, [decisionId]);
      assert.deepEqual(targetObservation.supportingReviewIds, [reviewId]);
      for (const item of view.observations) {
        assert.ok(item.evidenceRefs.length > 0);
        assert.ok(item.evidenceRefs.every((id: string) => item.evidence.some((entry: { id: string }) => entry.id === id)));
        assert.equal(item.stats.supporting.knownOutcomes.unknown, 1);
        assert.equal(item.stats.supporting.knownOutcomes.positive, 0);
        assert.equal(item.stats.supporting.knownOutcomes.negative, 0);
      }
      for (const origin of draft.inference.origins) {
        const observation = view.observations.find((item: { category: string; stats: { feature: string; basis: string } }) => item.category === "influence" && item.stats.feature === origin.label && item.stats.basis === "inference");
        assert.ok(observation, "real parser origin stays inference in sparse DNA");
      }
      dnaPatternIds.push(...first.patterns.map((item: { id: string }) => item.id));
      assert.equal(documentCalls, dnaPatternIds.length);
      const second = await expectSuccess(await recompute(request({})), 200);
      assert.deepEqual(second.patterns.map((item: { id: string }) => item.id), dnaPatternIds);
      assert.equal(documentCalls, dnaPatternIds.length, "unchanged canonical pattern text must not be re-embedded");
      const marker = await client.query("SELECT count(*)::int AS count FROM public.evidence_records WHERE user_id=$1 AND kind='prior_review' AND review_id=$2 AND label='Decision DNA supporting review'", [owner.userId, reviewId]);
      assert.equal(marker.rows[0].count, 1);
      const patternLinks = await client.query("SELECT l.pattern_id,l.evidence_id,e.user_id FROM public.pattern_evidence l JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.pattern_id=ANY($2::uuid[])", [owner.userId, dnaPatternIds]);
      assert.ok(patternLinks.rows.length > 0);
      assert.ok(patternLinks.rows.every((row) => row.user_id === owner.userId));
      const foreignOwner = await authB.getContext();
      assert.ok(foreignOwner);
      assert.notEqual(foreignOwner.userId, owner.userId);
      const foreignView = await expectSuccess(await createDNAHandler({ db: session, authProvider: authB })(), 200);
      const foreignIds = [...foreignView.observations, ...foreignView.edges, ...foreignView.leaks, ...foreignView.influences, ...foreignView.executionPatterns, ...foreignView.regimes].map((item: { id: string }) => item.id);
      assert.ok(!foreignIds.some((id: string) => dnaPatternIds.includes(id)));
      const queryText = "I changed my profit target after the trade had already exceeded my original target.";
      const embeddedQuery = await jina.embedQuery(queryText);
      const hits = await client.query(DNA_QUERIES.searchCurrentPatternMemory, [owner.userId, `[${embeddedQuery.vector.join(",")}]`, embeddedQuery.model, embeddedQuery.dimensions, 20]);
      const rank = hits.rows.findIndex((hit) => hit.entity_id === targetObservation.id);
      assert.ok(rank >= 0, "target drift observation must be semantically retrievable");
      const foreignHits = await client.query(DNA_QUERIES.searchCurrentPatternMemory, [foreignOwner.userId, `[${embeddedQuery.vector.join(",")}]`, embeddedQuery.model, embeddedQuery.dimensions, 20]);
      assert.ok(!foreignHits.rows.some((hit) => dnaPatternIds.includes(String(hit.entity_id))));
      const ownedPattern = await createPatternsRepository(session, foreignOwner).getDNA();
      assert.ok(!ownedPattern.observations.some((item) => dnaPatternIds.includes(item.id)));
      report.decisionDNA = { status: "verified", view, repeatedRecomputeStable: true, documentEmbeddingCalls: documentCalls, evidenceLinks: patternLinks.rows.length, ownerIsolation: "verified", retrieval: { query: queryText, observationId: targetObservation.id, rank: rank + 1, similarity: hits.rows[rank].similarity, model: embeddedQuery.model, dimensions: embeddedQuery.dimensions, meaning: "retrieval in this verification corpus only" } };
    }
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query<{ decisions: number; trades: number; reviews: number; dimensions: number; embeddings: number; aiRuns: number; evidence: number; events: number }>(
      "SELECT (SELECT count(*)::int FROM public.decisions WHERE id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE id=$2) AS trades,(SELECT count(*)::int FROM public.reviews WHERE id=$3) AS reviews,(SELECT count(*)::int FROM public.review_dimensions WHERE review_id=$3) AS dimensions,(SELECT count(*)::int FROM public.memory_embeddings WHERE entity_type='review' AND entity_id=$3) AS embeddings,(SELECT count(*)::int FROM public.ai_runs WHERE id=ANY($4::uuid[])) AS \"aiRuns\",(SELECT count(*)::int FROM public.evidence_records WHERE decision_id=$1 OR trade_id=$2) AS evidence,(SELECT count(*)::int FROM public.trade_events WHERE trade_id=$2) AS events", [decisionId, tradeId, reviewId, [draft.ai.runId, runId]],
    );
    assert.deepEqual(remaining.rows[0], { decisions: 0, trades: 0, reviews: 0, dimensions: 0, embeddings: 0, aiRuns: 0, evidence: 0, events: 0 });
    if (process.env.VERIFY_DECISION_DNA === "1") {
      const dnaRemaining = await client.query("SELECT (SELECT count(*)::int FROM public.patterns WHERE user_id=$1 AND id=ANY($2::uuid[])) AS patterns,(SELECT count(*)::int FROM public.pattern_evidence WHERE user_id=$1 AND pattern_id=ANY($2::uuid[])) AS links,(SELECT count(*)::int FROM public.memory_embeddings WHERE user_id=$1 AND entity_type='pattern' AND entity_id=ANY($2::uuid[])) AS embeddings,(SELECT count(*)::int FROM public.evidence_records WHERE user_id=$1 AND review_id=$3 AND kind='prior_review') AS reviewEvidence", [owner.userId, dnaPatternIds, reviewId]);
      assert.deepEqual(dnaRemaining.rows[0], { patterns: 0, links: 0, embeddings: 0, reviewevidence: 0 });
      report.decisionDNARollback = { status: "verified", remainingRows: dnaRemaining.rows[0] };
    }
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
