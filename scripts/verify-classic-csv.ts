import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseEnv } from "node:util";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { z } from "zod";
import { parseClassicCSV } from "../src/server/bitget-classic-policy";
import { CLASSIC_CSV_QUERIES } from "../src/server/bitget-classic-queries";
import { NeonAuthProvider } from "../src/server/auth/neon";
import { PersistenceUnavailableError } from "../src/server/db/repositories";
import type { DbSession, Queryable } from "../src/server/db/client";

const BASE = "http://localhost:3002";
const countsQuery = "SELECT (SELECT count(*)::int FROM public.spot_csv_imports WHERE user_id=$1) AS imports,(SELECT count(*)::int FROM public.spot_activities WHERE user_id=$1) AS activities,(SELECT count(*)::int FROM public.spot_executions WHERE user_id=$1) AS executions,(SELECT count(*)::int FROM public.spot_activity_events WHERE user_id=$1) AS events,(SELECT count(*)::int FROM public.decisions WHERE user_id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE user_id=$1) AS trades,(SELECT count(*)::int FROM public.reviews WHERE user_id=$1) AS reviews,(SELECT count(*)::int FROM public.patterns WHERE user_id=$1) AS patterns,(SELECT count(*)::int FROM public.memory_embeddings WHERE user_id=$1) AS memory";
const rollbackQuery = "SELECT (SELECT count(*)::int FROM public.spot_csv_imports WHERE user_id=$1 AND id=ANY($2::uuid[])) AS imports,(SELECT count(*)::int FROM public.spot_activities WHERE user_id=$1 AND id=ANY($3::uuid[])) AS activities,(SELECT count(*)::int FROM public.spot_executions WHERE user_id=$1 AND activity_id=ANY($3::uuid[])) AS executions,(SELECT count(*)::int FROM public.spot_activity_events WHERE user_id=$1 AND (activity_id=ANY($3::uuid[]) OR import_id=ANY($2::uuid[]))) AS events";
let stage = "genuine_file";

async function main() {
  const path = process.argv[2];
  assert.ok(path, "a genuine CSV path is required");
  const bytes = await readFile(path);
  const parsed = parseClassicCSV(bytes);
  assert.equal(parsed.summary.totalOrders, 2);
  assert.equal(parsed.summary.totalExecutionRows, 2);
  assert.deepEqual(parsed.summary.uniqueTradingPairs, ["INJ/USDT"]);
  assert.equal(parsed.summary.sells, 2);
  assert.equal(parsed.summary.buys, 0);
  assert.equal(parsed.importEligible, true);
  assert.ok(parsed.orders.every((order) => order.purpose === "unknown" && order.originalOrderId.startsWith("\t") && order.orderId === order.originalOrderId.trim() && /^\d+$/.test(order.orderId) && order.orderId.length > 15 && order.timezoneStatus === "unknown"));
  assert.ok(parsed.orders.some((order) => order.orderPrice === "7.404" && order.executions[0].price === "7.407"));
  assert.deepEqual(parsed.orders.map((order) => order.dateText.slice(0, 10)).sort(), ["2026-09-24", "2026-09-30"]);
  const group = parsed.summary.financialGroups[0];
  assert.equal(group.filledQuantity, "2");
  assert.equal(group.grossVolume, "15.185");
  assert.deepEqual(group.reportedFees, [{ currency: "USDT", amount: "0.015185" }]);
  assert.equal(group.netProceeds, "15.169815");
  assert.equal(group.realizedPnl, null);
  const report: Record<string, unknown> = {
    status: "verified", verificationSurface: "genuine private Bitget Classic nested CSV", sourceHash: parsed.sourceHash,
    parsedSummary: parsed.summary, warnings: parsed.warnings, missingData: parsed.missingData,
    idIntegrity: "long order IDs preserved as strings, original leading tabs retained separately",
    orderAndFillPricesDistinct: true, timestampBasis: "original text, timezone unknown",
  };
  if (process.argv[3] === "--parse-only") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const jarPath = process.argv[3];
  assert.ok(jarPath, "real managed-session jar required for rollback verification");
  loadEnvConfig(process.cwd());
  const projectEnv = parseEnv(await readFile(".env.local", "utf8"));
  assert.ok(projectEnv.DATABASE_URL_UNPOOLED && projectEnv.BITGET_ACCOUNT_AUTH_SUBJECT);
  const jar = z.array(z.looseObject({ cookies: z.array(z.union([z.string(), z.strictObject({ name: z.string(), value: z.string() }).transform((cookie) => `${cookie.name}=${cookie.value}`)])) })).min(2).parse(JSON.parse(await readFile(jarPath, "utf8")));
  const dbConfig = { connectionString: projectEnv.DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 };
  const client = new Client(dbConfig);
  const imports: string[] = [];
  const activities: string[] = [];
  let inTransaction = false;
  let sequence = 0;
  await client.connect();
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const session: DbSession = {
      query: async <T>(text: string, values?: readonly unknown[]) => ({ rows: (await client.query(text, values ? [...values] : undefined)).rows as T[] }),
      transaction: async <T>(fn: (q: Queryable) => Promise<T>) => {
        const name = `classic_csv_${++sequence}`;
        await client.query(`SAVEPOINT ${name}`);
        try { const result = await fn(session); await client.query(`RELEASE SAVEPOINT ${name}`); return result; }
        catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); await client.query(`RELEASE SAVEPOINT ${name}`); throw error; }
      },
    };
    const managedSession = async (cookies: readonly string[]) => {
      const response = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "), origin: BASE }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      assert.equal(response.status, 200);
      const data = z.looseObject({ user: z.looseObject({ id: z.string() }) }).parse(await response.json());
      return { data, error: null };
    };
    stage = "managed_auth";
    const candidates = await Promise.all(jar.slice(0, 2).map(async (entry) => {
      const provider = new NeonAuthProvider({ db: session, auth: { getSession: () => managedSession(entry.cookies) } });
      return { provider, context: await provider.getContext() };
    }));
    const intended = candidates.find((candidate) => candidate.context?.subject === projectEnv.BITGET_ACCOUNT_AUTH_SUBJECT);
    const other = candidates.find((candidate) => candidate.context && candidate.context.subject !== projectEnv.BITGET_ACCOUNT_AUTH_SUBJECT);
    assert.ok(intended?.context && other?.context, "valid managed sessions for the bound owner and another owner are required");
    const authA = intended.provider;
    const authB = other.provider;
    const owner = intended.context;
    const foreign = other.context;
    assert.notEqual(owner.userId, foreign.userId);
    const handlers = await import("../src/server/imports/bitget-classic/http");
    const deps = { db: session, authProvider: authA };
    const purposes = parsed.orders.map((order) => ({ orderId: order.orderId, purpose: "payment_conversion" }));
    const upload = (commit = false, overrides: Record<string, string> = {}) => {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: "text/csv" }), basename(path));
      form.set("accountScope", "main");
      if (commit) { form.set("previewHash", parsed.sourceHash); form.set("confirmed", "true"); form.set("purposes", JSON.stringify(purposes)); }
      for (const [key, value] of Object.entries(overrides)) form.set(key, value);
      return new Request(`${BASE}/api/imports/bitget-classic/${commit ? "commit" : "preview"}`, { method: "POST", headers: { origin: BASE }, body: form });
    };
    const success = async (response: Response) => { const body = await response.json(); assert.equal(response.status, 200, `CSV operation failed (${body.error?.code ?? "unknown"})`); return body; };
    const baseline = (await client.query(countsQuery, [owner.userId])).rows[0];
    stage = "preview";
    const preview = await success(await handlers.createClassicCSVPreviewHandler(deps)(upload()));
    assert.deepEqual(preview.preview, parsed);
    assert.equal(preview.accountScopeBasis, "user_declared_unverified");
    assert.deepEqual((await client.query(countsQuery, [owner.userId])).rows[0], baseline, "preview must not persist application rows");
    assert.equal((await handlers.createClassicCSVPreviewHandler({ ...deps, authProvider: { getContext: async () => null } })(upload())).status, 401);
    stage = "approval_guards";
    const commit = handlers.createClassicCSVCommitHandler(deps);
    assert.equal((await commit(upload(true, { confirmed: "false" }))).status, 400);
    assert.equal((await commit(upload(true, { previewHash: "0".repeat(64) }))).status, 400);
    assert.equal((await commit(upload(true, { purposes: "[]" }))).status, 400);
    assert.deepEqual((await client.query(countsQuery, [owner.userId])).rows[0], baseline);
    stage = "atomic_failure";
    let insertedAttempts = 0;
    const failingDb: DbSession = {
      query: session.query,
      transaction: (fn) => session.transaction((q) => fn({ query: async <T>(text: string, values?: readonly unknown[]) => {
        if (text === CLASSIC_CSV_QUERIES.insertExecution && ++insertedAttempts === 2) throw new PersistenceUnavailableError();
        return q.query<T>(text, values);
      } })),
    };
    assert.equal((await handlers.createClassicCSVCommitHandler({ ...deps, db: failingDb })(upload(true))).status, 503);
    assert.equal(insertedAttempts, 2);
    assert.deepEqual((await client.query(countsQuery, [owner.userId])).rows[0], baseline, "a failed import must roll back its receipt, orders, fills and events");
    stage = "approved_commit";
    const saved = await success(await commit(upload(true)));
    assert.equal(saved.insertedOrderCount, 2);
    assert.equal(saved.insertedExecutionCount, 2);
    assert.equal(saved.existingOrderCount, 0);
    assert.equal(saved.existingExecutionCount, 0);
    imports.push(z.string().uuid().parse(saved.import.id));
    activities.push(...saved.activities.map((activity: { id: string }) => z.string().uuid().parse(activity.id)));
    assert.equal(activities.length, 2);
    stage = "readback";
    for (const id of activities) {
      const activity = await success(await handlers.createSpotActivityHandler(deps)(new Request(`${BASE}/api/activities/${id}`), { id }));
      assert.equal(activity.purpose.value, "payment_conversion");
      assert.equal(activity.purpose.version, 1);
      assert.equal(activity.safety.tradingIntelligenceEligible, false);
      assert.equal(activity.safety.decisionLinked, false);
      assert.equal(activity.accountScopeBasis, "user_declared_unverified");
      const original = parsed.orders.find((order) => order.orderId === activity.order.orderId);
      assert.ok(original);
      assert.deepEqual(activity.order, original);
      assert.equal(activity.executions.length, original.executions.length);
      assert.equal(activity.metrics.financialGroups[0].realizedPnl, null);
      assert.equal((await handlers.createSpotActivityHandler({ ...deps, authProvider: authB })(new Request(`${BASE}/api/activities/${id}`), { id })).status, 404);
    }
    const receipt = await success(await handlers.createClassicCSVImportHandler(deps)(new Request(`${BASE}/api/imports/bitget-classic/${imports[0]}`), { id: imports[0] }));
    assert.equal(receipt.activities.length, 2);
    assert.equal((await handlers.createClassicCSVImportHandler({ ...deps, authProvider: authB })(new Request(`${BASE}/api/imports/bitget-classic/${imports[0]}`), { id: imports[0] })).status, 404);
    stage = "reimport";
    const repeated = await success(await commit(upload(true)));
    assert.equal(repeated.import.id, imports[0]);
    assert.equal(repeated.insertedOrderCount, 0);
    assert.equal(repeated.insertedExecutionCount, 0);
    assert.equal(repeated.existingOrderCount, 2);
    assert.equal(repeated.existingExecutionCount, 2);
    const ownerLockProbe = new Client(dbConfig);
    await ownerLockProbe.connect();
    try {
      await ownerLockProbe.query("BEGIN");
      await assert.rejects(() => ownerLockProbe.query("SELECT id FROM public.users WHERE id=$1 FOR UPDATE NOWAIT", [owner.userId]), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55P03");
      await ownerLockProbe.query("ROLLBACK");
    } finally { await ownerLockProbe.end(); }
    stage = "purpose_audit";
    const purposeRequest = (purpose: string, expectedVersion: number) => new Request(`${BASE}/api/activities/${activities[0]}/purpose`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ purpose, expectedVersion, reason: "Explicit verification-only user purpose change" }) });
    const change = handlers.createSpotActivityPurposeHandler(deps);
    assert.equal((await handlers.createSpotActivityPurposeHandler({ ...deps, authProvider: authB })(purposeRequest("unknown", 1), { id: activities[0] })).status, 404);
    const changed = await success(await change(purposeRequest("other_nontrading", 1), { id: activities[0] }));
    assert.equal(changed.purpose.version, 2);
    assert.equal(changed.purpose.value, "other_nontrading");
    assert.equal(changed.purposeAudit.length, 2);
    assert.deepEqual(changed.order, parsed.orders.find((order) => order.orderId === changed.order.orderId));
    const retry = await success(await change(purposeRequest("other_nontrading", 1), { id: activities[0] }));
    assert.equal(retry.purpose.version, 2);
    assert.equal((await change(purposeRequest("unknown", 1), { id: activities[0] })).status, 409);
    const restored = await success(await change(purposeRequest("payment_conversion", 2), { id: activities[0] }));
    assert.equal(restored.purposeAudit.length, 3);
    const after = (await client.query(countsQuery, [owner.userId])).rows[0];
    for (const key of ["decisions", "trades", "reviews", "patterns", "memory"]) assert.equal(after[key], baseline[key], "CSV activities must not create trading-intelligence records");
    report.application = { status: "verified", previewWithoutWrites: true, explicitConfirmationRequired: true, contentHashChecked: true, paymentConversionConfirmedByOwner: true, insertedOrders: 2, insertedExecutions: 2, reimport: { insertedOrders: 0, insertedExecutions: 0, existingOrders: 2, existingExecutions: 2 }, crossOwnerReadAndMutationDenied: true, purposeAuditAppendOnly: true, atomicFailureRolledBack: true, ownerSerializationLock: "second real Neon connection NOWAIT rejected while import owner lock was held", noTradingIntelligenceRowsCreated: true };
    stage = "rollback";
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = (await client.query(rollbackQuery, [owner.userId, imports, activities])).rows[0];
    assert.deepEqual(remaining, { imports: 0, activities: 0, executions: 0, events: 0 });
    assert.deepEqual((await client.query(countsQuery, [owner.userId])).rows[0], baseline);
    report.rollback = { status: "verified", remainingRows: remaining };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (inTransaction) await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.log(JSON.stringify({ status: "failed", stage, type: error instanceof Error ? error.name : "unknown", message: error instanceof assert.AssertionError ? "verification invariant failed" : "verification did not complete" }));
  process.exitCode = 1;
});
