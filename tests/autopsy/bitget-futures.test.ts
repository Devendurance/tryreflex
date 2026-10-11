import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import {
  createBitgetAvailabilityHandler,
  createPreviewTradesHandler,
} from "../../src/server/trades/http";
import type { TradeHistoryQuery, TradeListResult } from "../../src/server/trades/provider";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_SUBJECT = "owner-subject-bitget";
const FOREIGN_SUBJECT = "foreign-subject-bitget";

const ownerAuth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: OWNER_SUBJECT };
const foreignAuth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: FOREIGN_SUBJECT };

function authProvider(context: AuthContext | null) {
  return { getContext: async () => context };
}

type CountingDb = {
  readonly calls: number;
  query: () => Promise<{ rows: never[] }>;
  transaction: <T>(fn: (q: CountingDb) => Promise<T>) => Promise<T>;
};

function countingDb(): CountingDb {
  let queries = 0;
  const db: CountingDb = {
    get calls() {
      return queries;
    },
    async query() {
      queries += 1;
      return { rows: [] };
    },
    async transaction<T>(fn: (q: CountingDb) => Promise<T>) {
      return fn(db);
    },
  };
  return db;
}

function validQuery(): TradeHistoryQuery {
  const endTime = Date.now() - 24 * 60 * 60 * 1000;
  return { category: "USDT-FUTURES", symbol: "BTCUSDT", startTime: endTime - 9 * 24 * 60 * 60 * 1000, endTime };
}

function previewTrade(externalId: string) {
  return {
    externalId,
    symbol: "BTCUSDT",
    side: "long" as const,
    quantity: "1",
    entryPrice: "50000",
    exitPrice: "52000",
    fees: "2",
    realizedPnl: "1998",
    openedAt: "2026-09-01T00:00:00.000Z",
    closedAt: "2026-09-02T00:00:00.000Z",
    metadata: { provider: "bitget" },
  };
}

function mockProvider(result: Partial<TradeListResult> = {}, calls: unknown[] = []) {
  return {
    async listTrades(query: TradeHistoryQuery): Promise<TradeListResult> {
      calls.push(query);
      return {
        trades: [],
        rejected: [],
        nextCursor: null,
        provider: "bitget" as const,
        retrievedAt: new Date().toISOString(),
        ...result,
      };
    },
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost:3002/api/trades/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function withBinding(subject: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prior = process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  if (subject === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = subject;
  return fn().finally(() => {
    if (prior === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
    else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = prior;
  });
}

test("owner preview returns normalized records without database writes", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const db = countingDb();
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db, provider: mockProvider({ trades: [previewTrade("pos-1")], rejected: [{ externalId: null, code: "NOT_FULLY_CLOSED" }], nextCursor: "cursor-1" }, calls) });
    const response = await handler(postRequest(validQuery()));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.trades.length, 1);
    assert.equal(body.trades[0].externalId, "pos-1");
    assert.equal(body.rejected.length, 1);
    assert.equal(body.nextCursor, "cursor-1");
    assert.equal(body.provider, "bitget");
    assert.ok(typeof body.retrievedAt === "string");
    assert.equal(calls.length, 1);
    assert.equal(db.calls, 0);
  });
});

test("preview accepts a non-decision symbol with no override field", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider({ trades: [previewTrade("pos-x")] }, calls) });
    const query = validQuery();
    const response = await handler(postRequest(query));
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], query);
    assert.ok(!("symbolOverrideReason" in ((calls[0] ?? {}) as Record<string, unknown>)));
  });
});

test("preview rejects extraneous fields to keep a narrow contract", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider({}, calls) });
    const response = await handler(postRequest({ ...validQuery(), symbolOverrideReason: "not needed for preview" }));
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("diagnostic codes accept only bounded numeric values", async () => {
  const { sanitizeDiagnosticCode, diagnosticStageFor } = await import("../../src/server/trades/errors");
  assert.equal(sanitizeDiagnosticCode("40085"), "40085");
  assert.equal(sanitizeDiagnosticCode(40085), "40085");
  assert.equal(sanitizeDiagnosticCode("abc"), undefined);
  assert.equal(sanitizeDiagnosticCode("12ab34"), undefined);
  assert.equal(sanitizeDiagnosticCode(""), undefined);
  assert.equal(sanitizeDiagnosticCode("12345678901"), undefined);
  assert.equal(sanitizeDiagnosticCode(null), undefined);
  assert.equal(sanitizeDiagnosticCode("<script>alert(1)</script>"), undefined);
  assert.equal(diagnosticStageFor("PROVIDER"), "after_request");
  assert.equal(diagnosticStageFor("CONFIGURATION"), "before_request");
  assert.equal(diagnosticStageFor("INVALID_INPUT"), "before_request");
  assert.equal(diagnosticStageFor("TIMEOUT"), "request_unknown");
});

test("owner provider failures carry safe diagnosis without changing the message", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const { TradeError } = await import("../../src/server/trades/errors");
    const db = countingDb();
    const coded = { listTrades: async () => { throw new TradeError("PROVIDER", "40085"); } };
    const codedResponse = await createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db, provider: coded })(postRequest(validQuery()));
    assert.equal(codedResponse.status, 503);
    const codedBody = await codedResponse.json();
    assert.equal(codedBody.error.code, "PROVIDER");
    assert.equal(codedBody.error.message, "the trade provider returned an unusable response");
    assert.deepEqual(codedBody.error.diagnosis, { stage: "after_request", providerCode: "40085" });
    const bare = { listTrades: async () => { throw new TradeError("TIMEOUT"); } };
    const bareResponse = await createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db, provider: bare })(postRequest(validQuery()));
    assert.equal(bareResponse.status, 503);
    assert.deepEqual((await bareResponse.json()).error.diagnosis, { stage: "request_unknown", providerCode: "CODE_UNAVAILABLE" });
    const dirty = { listTrades: async () => { throw new TradeError("PROVIDER", "<script>alert(1)</script>"); } };
    const dirtyText = await (await createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db, provider: dirty })(postRequest(validQuery()))).text();
    assert.ok(!dirtyText.includes("<script>"));
    assert.ok(dirtyText.includes("CODE_UNAVAILABLE"));
    assert.equal(db.calls, 0);
  });
});

test("non-owners never receive diagnostics", async () => {
  const anon = await createPreviewTradesHandler({ authProvider: authProvider(null), db: countingDb(), provider: mockProvider() })(postRequest(validQuery()));
  assert.equal(anon.status, 401);
  assert.ok(!("diagnosis" in (await anon.json()).error));
  await withBinding(OWNER_SUBJECT, async () => {
    const denied = await createPreviewTradesHandler({ authProvider: authProvider(foreignAuth), db: countingDb(), provider: mockProvider() })(postRequest(validQuery()));
    assert.equal(denied.status, 403);
    assert.ok(!("diagnosis" in (await denied.json()).error));
  });
  await withBinding(undefined, async () => {
    const unbound = await createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider() })(postRequest(validQuery()));
    assert.equal(unbound.status, 503);
    assert.ok(!("diagnosis" in (await unbound.json()).error));
  });
});

test("unauthenticated preview is rejected before provider work", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const handler = createPreviewTradesHandler({ authProvider: authProvider(null), db: countingDb(), provider: mockProvider({}, calls) });
    const response = await handler(postRequest(validQuery()));
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("foreign subject preview is forbidden before provider work", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const handler = createPreviewTradesHandler({ authProvider: authProvider(foreignAuth), db: countingDb(), provider: mockProvider({}, calls) });
    const response = await handler(postRequest(validQuery()));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "PRIVATE_ACCOUNT_FORBIDDEN");
    assert.equal(calls.length, 0);
  });
});

test("missing account binding blocks preview without provider work", async () => {
  await withBinding(undefined, async () => {
    const calls: unknown[] = [];
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider({}, calls) });
    const response = await handler(postRequest(validQuery()));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PRIVATE_ACCOUNT_NOT_BOUND");
    assert.equal(calls.length, 0);
  });
});

test("invalid date windows are rejected without provider work", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const db = countingDb();
    const provider = mockProvider({}, calls);
    const base = validQuery();
    for (const bad of [
      { ...base, endTime: base.startTime - 1 },
      { ...base, startTime: base.endTime - 31 * 24 * 60 * 60 * 1000 },
      { ...base, startTime: Date.now() - 91 * 24 * 60 * 60 * 1000, endTime: Date.now() - 61 * 24 * 60 * 60 * 1000 },
      { ...base, symbol: "btc_usdt" },
      { ...base, category: "SPOT" },
    ]) {
      const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db, provider });
      const response = await handler(postRequest(bad));
      assert.equal(response.status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal(db.calls, 0);
  });
});

test("empty provider history returns an empty preview", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider() });
    const response = await handler(postRequest(validQuery()));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.trades, []);
    assert.deepEqual(body.rejected, []);
    assert.equal(body.nextCursor, null);
  });
});

test("provider failures map to safe unavailable errors", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const { TradeError } = await import("../../src/server/trades/errors");
    for (const [thrown, status, code] of [
      [new TradeError("PROVIDER"), 503, "PROVIDER"],
      [new TradeError("TIMEOUT"), 503, "TIMEOUT"],
      [new TradeError("CONFIGURATION"), 503, "CONFIGURATION"],
    ] as const) {
      const provider = { listTrades: async () => { throw thrown; } };
      const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider });
      const response = await handler(postRequest(validQuery()));
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
  });
});

test("preview responses never carry credentials or account identity", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const handler = createPreviewTradesHandler({ authProvider: authProvider(ownerAuth), db: countingDb(), provider: mockProvider({ trades: [previewTrade("pos-9")] }) });
    const response = await handler(postRequest(validQuery()));
    const text = await response.text();
    assert.ok(!/api[_-]?key|secret|passphrase|private[_-]?key|bearer|cookie/i.test(text));
    assert.ok(!text.includes(OWNER_SUBJECT));
  });
});

test("availability reports binding state without provider work", async () => {
  await withBinding(OWNER_SUBJECT, async () => {
    const calls: unknown[] = [];
    const db = countingDb();
    const ok = await createBitgetAvailabilityHandler({ authProvider: authProvider(ownerAuth), db, provider: mockProvider({}, calls) })();
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { available: true });
    const denied = await createBitgetAvailabilityHandler({ authProvider: authProvider(foreignAuth), db, provider: mockProvider({}, calls) })();
    assert.equal(denied.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(db.calls, 0);
  });
  await withBinding(undefined, async () => {
    const unbound = await createBitgetAvailabilityHandler({ authProvider: authProvider(ownerAuth), db: countingDb() })();
    assert.equal(unbound.status, 503);
  });
  const anon = await createBitgetAvailabilityHandler({ authProvider: authProvider(null), db: countingDb() })();
  assert.equal(anon.status, 401);
});
