import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import { classifyProcessOutcome, computeDecisionQuality, computeTradeMetrics, REVIEW_DIMENSIONS, type ReviewDimension } from "../src/server/review-policy";

const BASE = "http://localhost:3002";
const jarSchema = z.array(z.looseObject({ cookies: z.array(z.string()).min(1) })).min(2);
const genuineInputSchema = z.strictObject({
  decisionText: z.string().min(1),
  snapshot: decisionSnapshotSchema,
  trade: z.strictObject({
    symbol: z.string().min(1), side: z.enum(["long", "short"]), quantity: z.string(), entryPrice: z.string(),
    exitPrice: z.string().optional(), fees: z.string().optional(), realizedPnl: z.string().optional(),
    openedAt: z.iso.datetime({ offset: true }), closedAt: z.iso.datetime({ offset: true }).optional(),
    settlementCurrency: z.enum(["USD", "USDT", "USDC"]), symbolOverrideReason: z.string().optional(),
  }),
});

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
    const owner = await authA.getContext();
    assert.ok(owner);
    const draft = await expectSuccess(await createParseHandler({ db: session, authProvider: authA })(request({ text: genuine.decisionText })), 201);
    decisionId = z.string().uuid().parse(draft.decision.id);
    await expectSuccess(await createConfirmHandler({ db: session, authProvider: authA })(request(genuine.snapshot), { id: decisionId }), 200);
    const attached = await expectSuccess(await createManualTradeHandler({ db: session, authProvider: authA })(request({ ...genuine.trade, decisionId })), 201);
    tradeId = z.string().uuid().parse(attached.trade.id);
    const generated = await expectSuccess(await createGenerateReviewHandler({ db: session, authProvider: authA })(request({ tradeId })), 201);
    reviewId = z.string().uuid().parse(generated.review.id);
    runId = z.string().uuid().parse(generated.runId);
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
    const expectedMetrics = computeTradeMetrics({ quantity: record.quantity, entryPrice: record.entry_price, exitPrice: record.exit_price, side: record.side, openedAt: record.opened_at, closedAt: record.closed_at, fees: genuine.trade.fees === undefined ? null : record.fees, netRealizedPnl: record.realized_pnl, calculationBasis: "linear_base_quantity" }, { confirmedAt: record.confirmed_at, intendedEntry: genuine.snapshot.intendedEntry ?? null });
    assert.equal(read.review.metrics.tradeMetrics.netRealizedPnl, expectedMetrics.netRealizedPnl);
    assert.equal(read.review.metrics.tradeMetrics.outcome, expectedMetrics.outcome);
    assert.equal(generated.classification, classifyProcessOutcome(quality.overallScore, expectedMetrics.outcome as Parameters<typeof classifyProcessOutcome>[1]));
    assert.deepEqual(record.confirmed_snapshot, genuine.snapshot);
    const links = await client.query<{ owner_valid: boolean; count: number }>(
      "SELECT bool_and(e.user_id=$1) AS owner_valid,count(*)::int AS count FROM public.review_dimension_evidence l JOIN public.review_dimensions dim ON dim.user_id=l.user_id AND dim.id=l.dimension_id JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE dim.user_id=$1 AND dim.review_id=$2", [owner.userId, reviewId],
    );
    if (links.rows[0].count > 0) assert.equal(links.rows[0].owner_valid, true);
    const run = await client.query("SELECT model,pipeline,prompt_version,status FROM public.ai_runs WHERE user_id=$1 AND id=$2", [owner.userId, runId]);
    assert.equal(run.rows[0]?.pipeline, "decision-autopsy");
    assert.equal(run.rows[0]?.status, "success");
    const report = { status: "verified", verificationSurface: "actual route handlers + real managed sessions + genuine user input + Neon rollback", model: run.rows[0].model, promptVersion: run.rows[0].prompt_version, decisionQuality: quality, outcome: expectedMetrics.outcome, classification: generated.classification, dimensions: 5, evidenceLinks: links.rows[0].count, foreignRead: 404, originalSnapshotPreserved: true };
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query<{ decisions: number; trades: number; reviews: number; dimensions: number }>(
      "SELECT (SELECT count(*)::int FROM public.decisions WHERE id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE id=$2) AS trades,(SELECT count(*)::int FROM public.reviews WHERE id=$3) AS reviews,(SELECT count(*)::int FROM public.review_dimensions WHERE review_id=$3) AS dimensions", [decisionId, tradeId, reviewId],
    );
    assert.deepEqual(remaining.rows[0], { decisions: 0, trades: 0, reviews: 0, dimensions: 0 });
    console.log(JSON.stringify({ ...report, rollback: { status: "verified", remainingRows: remaining.rows[0] } }, null, 2));
  } finally {
    try {
      if (inTransaction) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}

main().catch(() => {
  console.log(JSON.stringify({ status: "failed", category: "REAL_AUTOPSY_VERIFICATION_FAILED", realGroqAutopsyVerified: false }));
  process.exitCode = 1;
});
