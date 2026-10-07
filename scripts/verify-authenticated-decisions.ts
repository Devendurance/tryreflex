import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { z } from "zod";
import { NeonAuthProvider } from "../src/server/auth/neon";
import type { DbSession, Queryable } from "../src/server/db/client";
import { getDatabaseUrls } from "../src/server/db/config";
import { createConfirmHandler, createContextHandler, createGetHandler, createParseHandler } from "../src/server/decisions/http";

const BASE = "http://localhost:3002";
const rawInput = "  I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.\n";
const jarSchema = z.array(z.looseObject({ cookies: z.array(z.string()).min(1) })).min(2);
const sessionSchema = z.looseObject({ user: z.looseObject({ id: z.string().min(1), email: z.string().optional(), name: z.string().optional() }) });

async function liveAuth(cookies: readonly string[]) {
  const response = await fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "), origin: BASE },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  assert.equal(response.status, 200, "real auth session request failed");
  const session = sessionSchema.parse(await response.json());
  return { data: session, error: null };
}

function request(body: unknown): Request {
  return new Request(`${BASE}/api/verification`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const report: Record<string, unknown> = { status: "failed", verificationSurface: "actual route handlers + real managed sessions + Neon transaction" };
  const path = process.argv[2];
  if (!path) throw new Error("private session artifact path required");
  const jar = jarSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const liveA = await liveAuth(jar[0].cookies);
  const liveB = await liveAuth(jar[1].cookies);
  assert.notEqual(liveA.data.user.id, liveB.data.user.id);
  report.auth = { status: "verified", distinctManagedSessions: 2 };
  const db = new Client({ connectionString: getDatabaseUrls().unpooled, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  let transactionOpen = false;
  let savepointSequence = 0;
  const decisionIds: string[] = [];
  const ownerIds: string[] = [];
  await db.connect();
  try {
    await db.query("BEGIN");
    transactionOpen = true;
    const session: DbSession = {
      async query<T>(text: string, values?: readonly unknown[]) {
        const result = await db.query(text, values ? [...values] : undefined);
        return { rows: result.rows as T[] };
      },
      async transaction<T>(fn: (q: Queryable) => Promise<T>) {
        const name = `authenticated_verification_${++savepointSequence}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          const result = await fn(session);
          await db.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await db.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      },
    };
    const authA = new NeonAuthProvider({ db: session, auth: { getSession: () => liveAuth(jar[0].cookies) } });
    const authB = new NeonAuthProvider({ db: session, auth: { getSession: () => liveAuth(jar[1].cookies) } });
    const contextA = await authA.getContext();
    const contextB = await authB.getContext();
    assert.ok(contextA && contextB);
    assert.notEqual(contextA.userId, contextB.userId);
    ownerIds.push(contextA.userId, contextB.userId);
    const baseline = await db.query<{ id: string }>("SELECT id FROM public.users WHERE auth_provider='neon-auth' AND auth_subject=ANY($1::text[])", [[liveA.data.user.id, liveB.data.user.id]]);
    assert.equal(baseline.rows.length, 2);
    const parseResponse = await createParseHandler({ db: session, authProvider: authA })(request({ text: rawInput }));
    const parsed = await parseResponse.json();
    assert.equal(parseResponse.status, 201, `parse failed with safe code ${parsed.error?.code ?? "unknown"}`);
    const decisionId = z.string().uuid().parse(parsed.decision.id);
    decisionIds.push(decisionId);
    assert.equal(parsed.decision.raw_input, rawInput);
    assert.equal(parsed.decision.status, "draft");
    assert.equal(parsed.decision.confirmed_snapshot, null);
    assert.ok(parsed.inference.origins.some((origin: { label: string }) => origin.label === "borrowed_conviction"));
    assert.ok(parsed.inference.origins.some((origin: { label: string }) => origin.label === "social_confirmation"));
    assert.ok(parsed.inference.origins.every((origin: { observedInputFacts: string[] }) => origin.observedInputFacts.every((quote) => rawInput.includes(quote))));
    const snapshot = {
      assetSymbol: "RNVDA", assetClass: "rtoken", side: "long",
      origins: parsed.inference.origins.map((origin: { label: string }) => origin.label),
      sources: parsed.inference.evidence.map((evidence: { sourceType: string; label: string; quote: string; url: string | null }) => ({ sourceType: evidence.sourceType, label: evidence.label, note: evidence.quote, ...(evidence.url === null ? {} : { url: evidence.url }) })),
    };
    const confirm = createConfirmHandler({ db: session, authProvider: authA });
    assert.equal((await confirm(request(snapshot), { id: decisionId })).status, 200);
    const repeated = await confirm(request(snapshot), { id: decisionId });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).decision.idempotent, true);
    const get = createGetHandler({ db: session, authProvider: authA });
    const ownerRead = await get(new Request(`${BASE}/api/decisions/${decisionId}`), { id: decisionId });
    assert.equal(ownerRead.status, 200);
    const ownerData = await ownerRead.json();
    assert.deepEqual(ownerData.decision.confirmedSnapshot, snapshot);
    assert.equal(ownerData.decision.rawInput, rawInput);
    const otherRead = await createGetHandler({ db: session, authProvider: authB })(new Request(`${BASE}/api/decisions/${decisionId}`), { id: decisionId });
    assert.equal(otherRead.status, 404);
    const otherConfirm = await createConfirmHandler({ db: session, authProvider: authB })(request(snapshot), { id: decisionId });
    assert.equal(otherConfirm.status, 404);
    const otherContext = await createContextHandler({ db: session, authProvider: authB })(request({}), { id: decisionId });
    assert.equal(otherContext.status, 404);
    const revisions = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.decision_revisions WHERE user_id=$1 AND decision_id=$2", [contextA.userId, decisionId]);
    assert.equal(revisions.rows[0].count, 1);
    const run = await db.query("SELECT model,prompt_version,pipeline,status,input_entity_ids FROM public.ai_runs WHERE user_id=$1 AND id=$2", [contextA.userId, parsed.ai.runId]);
    assert.equal(run.rows.length, 1);
    assert.equal(run.rows[0].status, "success");
    assert.equal(run.rows[0].pipeline, "decision-parse");
    assert.deepEqual(run.rows[0].input_entity_ids, [decisionId]);
    report.decision = { status: "verified", rawInputPreserved: true, draftCreated: true, model: parsed.ai.model, promptVersion: parsed.ai.promptVersion, origins: snapshot.origins, confirmationIdempotent: true, revisionCount: 1, ownerRead: 200, foreignRead: 404, foreignConfirm: 404, foreignContext: 404 };
    await db.query("SAVEPOINT immutable_probe");
    let mutationRejected = false;
    try {
      await db.query("UPDATE public.decisions SET raw_input=$3 WHERE user_id=$1 AND id=$2", [contextA.userId, decisionId, "prohibited rewrite"]);
    } catch (error) {
      mutationRejected = typeof error === "object" && error !== null && "code" in error && error.code === "23514";
    }
    await db.query("ROLLBACK TO SAVEPOINT immutable_probe");
    await db.query("RELEASE SAVEPOINT immutable_probe");
    assert.equal(mutationRejected, true);
    report.immutability = { rawInputMutationRejected: true };
    report.market = { verification: "separate once-only verify:market probe", allComponents: "UPSTREAM_UNAVAILABLE", noFakeSnapshotCreated: true };
    await db.query("ROLLBACK");
    transactionOpen = false;
    const remaining = await db.query<{ decisions: number; revisions: number; origins: number; sources: number; runs: number }>(
      "SELECT (SELECT count(*)::int FROM public.decisions WHERE id=ANY($1::uuid[])) AS decisions, (SELECT count(*)::int FROM public.decision_revisions WHERE decision_id=ANY($1::uuid[])) AS revisions, (SELECT count(*)::int FROM public.decision_origins WHERE decision_id=ANY($1::uuid[])) AS origins, (SELECT count(*)::int FROM public.decision_sources WHERE decision_id=ANY($1::uuid[])) AS sources, (SELECT count(*)::int FROM public.ai_runs WHERE user_id=ANY($2::uuid[]) AND input_entity_ids && $1::uuid[]) AS runs",
      [decisionIds, ownerIds],
    );
    assert.deepEqual(remaining.rows[0], { decisions: 0, revisions: 0, origins: 0, sources: 0, runs: 0 });
    report.rollback = { status: "verified", remainingRows: remaining.rows[0] };
    report.status = "verified";
  } finally {
    try {
      if (transactionOpen) await db.query("ROLLBACK");
    } finally {
      await db.end();
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(() => {
  console.log(JSON.stringify({ status: "failed", category: "LIVE_AUTH_DECISION_VERIFICATION_FAILED" }));
  process.exitCode = 1;
});
