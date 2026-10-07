import assert from "node:assert/strict";
import test from "node:test";
import { UnauthenticatedError, type AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { RepositoryError, createRepositories } from "../../src/server/db/repositories";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "bbbbbbbb-2222-4333-8444-cccccccccccc";

const auth: AuthContext = { userId: USER_ID, provider: "test", subject: "sub-1" };

type Call = { text: string; values?: readonly unknown[] };
type Handler = (text: string, values?: readonly unknown[]) => Record<string, unknown>[];

interface FakeSession extends DbSession {
  calls: Call[];
}

function fakeSession(handler: Handler = () => [{ ok: true }]): FakeSession {
  const calls: Call[] = [];
  const session: FakeSession = {
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

const VALID_SNAPSHOT = {
  assetSymbol: "BTC",
  assetClass: "crypto",
  side: "long",
  origins: ["original_research"],
  sources: [],
};

test("get uses fixed public table, ownership predicate, limit 1", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.decisions.get(OTHER_ID);
  assert.equal(session.calls.length, 1);
  const call = session.calls[0];
  assert.match(call.text, /^SELECT \* FROM public\.decisions WHERE user_id=\$1 AND id=\$2 LIMIT 1$/);
  assert.deepEqual(call.values, [USER_ID, OTHER_ID]);
});

test("list clamps limit to 1..100 and orders by created_at desc", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.trades.list(0);
  await repos.trades.list(500);
  assert.equal(session.calls[0].values?.[1], 1);
  assert.equal(session.calls[1].values?.[1], 100);
  assert.match(session.calls[0].text, /FROM public\.trades WHERE user_id=\$1 ORDER BY created_at DESC, id DESC LIMIT \$2/);
});

test("users.get is self-only via exact ownership SQL", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.users.get(OTHER_ID);
  const call = session.calls[0];
  assert.match(call.text, /^SELECT \* FROM public\.users WHERE id=\$1 AND id=\$2 LIMIT 1$/);
  assert.deepEqual(call.values, [USER_ID, OTHER_ID]);
});

test("createRepositories rejects invalid auth context", () => {
  const session = fakeSession();
  assert.throws(() => createRepositories(session, { ...auth, userId: "bad" }), UnauthenticatedError);
  assert.throws(() => createRepositories(session, { ...auth, provider: "  " }), UnauthenticatedError);
  assert.throws(() => createRepositories(session, { ...auth, subject: "" }), UnauthenticatedError);
});

test("createDraft preserves rawInput bytes exactly", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.decisions.createDraft({ rawInput: "  original\n" });
  const call = session.calls[0];
  assert.match(call.text, /^INSERT INTO public\.decisions \(user_id,raw_input,structured_inference,asset_symbol,asset_class,side\) VALUES/);
  assert.equal(call.values?.[0], USER_ID);
  assert.equal(call.values?.[1], "  original\n");
});

test("createDraft rejects blank input before any query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.decisions.createDraft({ rawInput: "   " }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  assert.equal(session.calls.length, 0);
});

test("confirm runs lock, update, revision insert in one transaction", async () => {
  const rows = [{ status: "draft", id: OTHER_ID, user_id: USER_ID }];
  const session = fakeSession((text) => {
    if (text.includes("FOR UPDATE")) return rows;
    return [{ ok: true }];
  });
  const repos = createRepositories(session, auth);
  await repos.decisions.confirm(OTHER_ID, VALID_SNAPSHOT);
  const texts = session.calls.map((c) => c.text);
  assert.deepEqual(
    texts.map((t) => (t.startsWith("SELECT * FROM public.decisions") ? "LOCK" : t.startsWith("UPDATE") ? "UPDATE" : t.startsWith("INSERT") ? "INSERT" : t)),
    ["BEGIN", "LOCK", "UPDATE", "INSERT", "COMMIT"],
  );
  const update = session.calls[2];
  assert.match(update.text, /UPDATE public\.decisions SET status='confirmed', confirmed_snapshot=\$3, confirmed_at=now\(\)/);
  assert.deepEqual(update.values?.slice(0, 2), [USER_ID, OTHER_ID]);
  const revision = session.calls[3];
  assert.match(revision.text, /INSERT INTO public\.decision_revisions/);
  assert.match(revision.text, /VALUES\(\$1,\$2,1,\$3,\$4\)/);
});

test("confirm rejects non-draft decision and rolls back", async () => {
  const session = fakeSession((text) => {
    if (text.includes("FOR UPDATE")) return [{ status: "confirmed" }];
    return [];
  });
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.decisions.confirm(OTHER_ID, VALID_SNAPSHOT),
    (e) => e instanceof RepositoryError && e.code === "CONFLICT",
  );
  assert.equal(session.calls.at(-1)?.text, "ROLLBACK");
});

test("confirm unknown decision reports not found", async () => {
  const session = fakeSession(() => []);
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.decisions.confirm(OTHER_ID, VALID_SNAPSHOT),
    (e) => e instanceof RepositoryError && e.code === "NOT_FOUND",
  );
});

test("appendRevision requires confirmed decision and computes next version", async () => {
  const session = fakeSession((text) => {
    if (text.includes("FOR UPDATE")) return [{ status: "confirmed" }];
    if (text.includes("MAX(version)")) return [{ version: 4 }];
    return [{ version: 4 }];
  });
  const repos = createRepositories(session, auth);
  await repos.decisions.appendRevision(OTHER_ID, { snapshot: VALID_SNAPSHOT, reason: "update" });
  const insert = session.calls[3];
  assert.match(insert.text, /INSERT INTO public\.decision_revisions/);
  assert.deepEqual(insert.values, [USER_ID, OTHER_ID, 4, VALID_SNAPSHOT, "update"]);
});

test("appendProposedVersion locks user row and inserts proposed rule", async () => {
  const session = fakeSession((text) => {
    if (text.includes("MAX(version)")) return [{ version: 2 }];
    return [{ ok: true }];
  });
  const repos = createRepositories(session, auth);
  await repos.playbookRules.appendProposedVersion({
    title: "t",
    trigger: "when x",
    ruleText: "do y",
    rationale: "because",
  });
  const texts = session.calls.map((c) => c.text);
  assert.match(texts[1], /SELECT id FROM public\.users WHERE id=\$1 FOR UPDATE/);
  const insert = session.calls[3];
  assert.match(insert.text, /INSERT INTO public\.playbook_rules/);
  assert.match(insert.text, /'proposed'/);
  assert.match(insert.text, /NULL,NULL\) RETURNING/);
  assert.equal(insert.values?.[1], 2);
});

test("appendUserDecision maps accepted to active with decided_at", async () => {
  const session = fakeSession((text) => {
    if (text.includes("MAX(version)")) return [{ version: 1 }];
    return [{ ok: true }];
  });
  const repos = createRepositories(session, auth);
  await repos.playbookRules.appendUserDecision({
    title: "t",
    trigger: "x",
    ruleText: "y",
    rationale: "r",
    userDecision: "accepted",
  });
  const insert = session.calls[3];
  assert.match(insert.text, /now\(\)\) RETURNING/);
  assert.equal(insert.values?.[4], "active");
  assert.equal(insert.values?.[9], "accepted");
});

test("recordTrade binds exact decimal strings", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.trades.record({
    provider: "manual",
    symbol: "BTC",
    side: "long",
    quantity: "9007199254740993.000000000001",
    entryPrice: "65000.5",
    fees: "0",
    openedAt: "2026-01-01T00:00:00Z",
  });
  const values = session.calls[0].values as unknown[];
  assert.equal(values[6], "9007199254740993.000000000001");
  assert.equal(values[7], "65000.5");
  assert.equal(values[9], "0");
});

test("recordTrade defaults fees to '0' string", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.trades.record({
    provider: "bitget",
    symbol: "BTC",
    side: "short",
    quantity: "1.5",
    entryPrice: "60000",
    openedAt: "2026-01-01T00:00:00Z",
  });
  const values = session.calls[0].values as unknown[];
  assert.equal(values[9], "0");
});

test("recordTrade rejects non-string, scientific, and reversed dates before query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const base = {
    provider: "manual",
    symbol: "BTC",
    side: "long",
    quantity: "1",
    entryPrice: "60000",
    openedAt: "2026-01-01T00:00:00Z",
  };
  await assert.rejects(() => repos.trades.record({ ...base, quantity: 1.5 }));
  await assert.rejects(() => repos.trades.record({ ...base, quantity: "1e3" }));
  await assert.rejects(() => repos.trades.record({ ...base, quantity: "0" }));
  await assert.rejects(() => repos.trades.record({ ...base, quantity: "-1" }));
  await assert.rejects(() => repos.trades.record({ ...base, fees: "-0.5" }));
  await assert.rejects(() =>
    repos.trades.record({ ...base, closedAt: "2025-12-31T23:59:59Z" }),
  );
  assert.equal(session.calls.length, 0);
});

test("evidence record enforces kind-specific FK mapping", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.evidenceRecords.record({ kind: "user_input" }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => repos.evidenceRecords.record({ kind: "trade_data", tradeId: OTHER_ID, reviewId: OTHER_ID }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  assert.equal(session.calls.length, 0);
  await repos.evidenceRecords.record({ kind: "trade_data", tradeId: OTHER_ID });
  assert.match(session.calls[0].text, /INSERT INTO public\.evidence_records/);
});

test("provider connection config rejects secret-looking fields", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(() =>
    repos.providerConnections.record({ provider: "groq", status: "configured", config: { apiKey: "x" } }),
  );
  assert.equal(session.calls.length, 0);
});

test("link methods validate strict uuid input", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(() => repos.patternEvidence.link({ patternId: "no", evidenceId: OTHER_ID }));
  await assert.rejects(() => repos.playbookRuleEvidence.link({ ruleId: OTHER_ID, evidenceId: OTHER_ID, extra: 1 }));
  await repos.patternEvidence.link({ patternId: OTHER_ID, evidenceId: USER_ID });
  assert.match(session.calls[0].text, /INSERT INTO public\.pattern_evidence/);
  assert.deepEqual(session.calls[0].values, [USER_ID, OTHER_ID, USER_ID]);
});

test("owned get/list available on revisions and link tables", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.decisionRevisions.get(OTHER_ID);
  await repos.patternEvidence.list(5);
  await repos.playbookRuleEvidence.get(OTHER_ID);
  await repos.reviewDimensionEvidence.list(10);
  const texts = session.calls.map((c) => c.text);
  assert.match(texts[0], /FROM public\.decision_revisions WHERE user_id=\$1 AND id=\$2/);
  assert.match(texts[1], /FROM public\.pattern_evidence WHERE user_id=\$1 ORDER BY created_at DESC/);
  assert.match(texts[2], /FROM public\.playbook_rule_evidence WHERE user_id=\$1 AND id=\$2/);
  assert.match(texts[3], /FROM public\.review_dimension_evidence WHERE user_id=\$1 ORDER BY created_at DESC/);
});

test("recordAiRun binds validationErrors as JSON text at param index 8", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const issues = [{ path: ["field"], message: "bad" }, "plain string issue"];
  await repos.aiRuns.record({
    pipeline: "p",
    model: "m",
    promptVersion: "v1",
    status: "failed",
    validationErrors: issues,
  });
  const call = session.calls[0];
  assert.match(call.text, /INSERT INTO public\.ai_runs/);
  const values = call.values as unknown[];
  assert.equal(values.length, 9);
  assert.equal(typeof values[8], "string");
  assert.deepEqual(JSON.parse(values[8] as string), issues);
});

test("recordAiRun rejects non-JSON validationErrors before query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const base = { pipeline: "p", model: "m", promptVersion: "v1", status: "failed" as const };
  await assert.rejects(() => repos.aiRuns.record({ ...base, validationErrors: [{ fn: () => {} }] }));
  await assert.rejects(() => repos.aiRuns.record({ ...base, validationErrors: [Number.NaN] }));
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(() => repos.aiRuns.record({ ...base, validationErrors: [circular] }));
  assert.equal(session.calls.length, 0);
});

test("provisionUser inserts on auth identity conflict and verifies binding", async () => {
  const session = fakeSession((text) => {
    if (text.startsWith("INSERT INTO public.users")) return [];
    if (text.startsWith("SELECT * FROM public.users")) return [{ id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }];
    return [];
  });
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.users.provision(),
    (e) => e instanceof RepositoryError && e.code === "CONFLICT",
  );
});

test("provisionUser returns row when identity matches", async () => {
  const session = fakeSession((text) => {
    if (text.startsWith("INSERT INTO public.users")) return [{ id: USER_ID }];
    return [];
  });
  const repos = createRepositories(session, auth);
  const row = await repos.users.provision();
  assert.equal(row.id, USER_ID);
  const call = session.calls[0];
  assert.match(call.text, /ON CONFLICT \(auth_provider,auth_subject\) DO NOTHING/);
  assert.deepEqual(call.values, [USER_ID, "test", "sub-1", null]);
});
