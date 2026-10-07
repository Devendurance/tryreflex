import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import { ConcurrencySaturatedError, createConcurrencyLimiter } from "../../src/server/http/authenticated";
import { createGenerateReviewHandler, createGetReviewHandler } from "../../src/server/reviews/http";
import { createImportTradesHandler, createManualTradeHandler } from "../../src/server/trades/http";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const REVIEW_ID = "523e4567-e89b-42d3-a456-426614174000";

const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };

function authProvider(context: AuthContext | null = auth) {
  return { getContext: async () => context };
}

function emptyDb() {
  return {
    async query() {
      return { rows: [] };
    },
    async transaction<T>(fn: (q: { query: (t: string, v?: readonly unknown[]) => Promise<{ rows: never[] }> }) => Promise<T>) {
      return fn({ query: async () => ({ rows: [] }) });
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3002/api/trades/manual", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function withBoundSubject<T>(subject: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  if (subject === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = subject;
  return fn().finally(() => {
    if (prior === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
    else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = prior;
  });
}

test("unauthenticated requests return 401 before body or provider work", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(null), db: emptyDb() });
  const response = await handler(request({ decisionId: DECISION_ID }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("wrong content type returns 415", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(
    new Request("http://localhost:3002/api/trades/manual", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 415);
});

test("cross-origin unsafe request returns 403", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(request({ decisionId: DECISION_ID }, { origin: "https://evil.example" }));
  assert.equal(response.status, 403);
});

test("import without private binding returns 503 without provider call", async () => {
  await withBoundSubject(undefined, async () => {
    let called = 0;
    const provider = {
      async listTrades() {
        called += 1;
        throw new Error("should not run");
      },
    };
    const handler = createImportTradesHandler({ authProvider: authProvider(), db: emptyDb(), provider });
    const response = await handler(
      request({
        decisionId: DECISION_ID,
        query: { category: "USDT-FUTURES", symbol: "BTCUSDT", startTime: 1, endTime: 2 },
        externalIds: ["x"],
      }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PRIVATE_ACCOUNT_NOT_BOUND");
    assert.equal(called, 0);
  });
});

test("import for foreign subject returns 403 without provider call", async () => {
  await withBoundSubject("someone-else", async () => {
    let called = 0;
    const provider = {
      async listTrades() {
        called += 1;
        throw new Error("should not run");
      },
    };
    const handler = createImportTradesHandler({ authProvider: authProvider(), db: emptyDb(), provider });
    const response = await handler(
      request({
        decisionId: DECISION_ID,
        query: { category: "USDT-FUTURES", symbol: "BTCUSDT", startTime: 1, endTime: 2 },
        externalIds: ["x"],
      }),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "PRIVATE_ACCOUNT_FORBIDDEN");
    assert.equal(called, 0);
  });
});

test("cross-owner review id returns 404 without leaking existence", async () => {
  const handler = createGetReviewHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(
    new Request(`http://localhost:3002/api/reviews/${REVIEW_ID}`),
    { id: REVIEW_ID },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("generate review validates body strictly", async () => {
  const handler = createGenerateReviewHandler({ authProvider: authProvider(), db: emptyDb(), llm: {} as never });
  const response = await handler(request({ tradeId: "nope" }));
  assert.equal(response.status, 400);
});

test("non-exact media type suffix returns 415", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(
    new Request("http://localhost:3002/api/trades/manual", {
      method: "POST",
      headers: { "content-type": "application/jsonfoo" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 415);
});

test("malformed JSON returns 400", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(
    new Request("http://localhost:3002/api/trades/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
});

test("scheme-mismatched origin returns 403", async () => {
  const handler = createManualTradeHandler({ authProvider: authProvider(), db: emptyDb() });
  const response = await handler(
    new Request("https://localhost:3002/api/trades/manual", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3002" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 403);
});

test("concurrency limiter rejects saturated calls with fixed error", async () => {
  const limiter = createConcurrencyLimiter(1);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => (release = resolve));
  const first = limiter(() => blocker);
  await assert.rejects(
    () => limiter(async () => "second"),
    (error) => error instanceof ConcurrencySaturatedError,
  );
  release();
  await first;
});
