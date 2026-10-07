import assert from "node:assert/strict";
import test from "node:test";
import { TradeError } from "../../src/server/trades/errors";
import {
  BitgetTradeProvider,
  tradeHistoryQuerySchema,
  type InvokeFn,
} from "../../src/server/trades/provider";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const savedEnv = {
  BITGET_API_KEY: process.env.BITGET_API_KEY,
  BITGET_SECRET_KEY: process.env.BITGET_SECRET_KEY,
  BITGET_PASSPHRASE: process.env.BITGET_PASSPHRASE,
};
process.env.BITGET_API_KEY = "test-key";
process.env.BITGET_SECRET_KEY = "test-secret";
process.env.BITGET_PASSPHRASE = "test-passphrase";
test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function query(overrides: Record<string, unknown> = {}) {
  return {
    category: "USDT-FUTURES" as const,
    symbol: "BTCUSDT",
    startTime: NOW - 7 * DAY,
    endTime: NOW - DAY,
    ...overrides,
  };
}

function position(overrides: Record<string, unknown> = {}) {
  return {
    positionId: "pos-1",
    category: "USDT-FUTURES",
    symbol: "BTCUSDT",
    marginCoin: "USDT",
    posSide: "long",
    openPriceAvg: "100",
    closePriceAvg: "110",
    openTotalPos: "0.1",
    closeTotalPos: "0.1",
    netProfit: "0.8",
    openFeeTotal: "-0.1",
    closeFeeTotal: "-0.1",
    createdTime: String(NOW - 3 * DAY),
    updatedTime: String(NOW - 2 * DAY),
    ...overrides,
  };
}

function provider(list: unknown[], invokeCapture?: { calls: unknown[] }) {
  const invoke: InvokeFn = async (_spec, args) => {
    invokeCapture?.calls.push(args);
    return { ok: true, data: { list, cursor: null } } as never;
  };
  return new BitgetTradeProvider({ invoke });
}

test("query schema enforces required range bounds", () => {
  assert.equal(tradeHistoryQuerySchema.safeParse(query()).success, true);
  assert.equal(tradeHistoryQuerySchema.safeParse(query({ startTime: NOW })).success, false);
  assert.equal(tradeHistoryQuerySchema.safeParse(query({ endTime: NOW + DAY })).success, false);
  assert.equal(
    tradeHistoryQuerySchema.safeParse(query({ startTime: NOW - 40 * DAY })).success,
    false,
  );
  assert.equal(
    tradeHistoryQuerySchema.safeParse(query({ startTime: NOW - 100 * DAY, endTime: NOW - 70 * DAY }))
      .success,
    false,
  );
  assert.equal(
    tradeHistoryQuerySchema.safeParse(query({ category: "COIN-FUTURES" })).success,
    false,
  );
});

test("listTrades initializes real read-only config and invokes position history", async () => {
  const calls: unknown[] = [];
  let specName: unknown;
  const invoke: InvokeFn = async (spec, args) => {
    specName = (spec as { name?: string }).name;
    calls.push(args);
    return { ok: true, data: { list: [position()], cursor: null } } as never;
  };
  const result = await new BitgetTradeProvider({ invoke }).listTrades(query());
  assert.equal(result.provider, "bitget");
  assert.equal(specName, "position");
  const args = calls[0] as Record<string, unknown>;
  assert.equal(args.action, "history");
  assert.equal(args.limit, "20");
  assert.equal(args.view, "full");
  const trade = result.trades[0];
  assert.equal(trade.externalId, "USDT-FUTURES:pos-1");
  assert.equal(trade.side, "long");
  assert.equal(trade.quantity, "0.1");
  assert.equal(trade.fees, "0.2");
  assert.equal(trade.realizedPnl, "0.8");
  assert.equal(trade.metadata.pnlBasis, "provider_net");
  assert.equal(trade.metadata.readOnly, true);
  assert.equal(trade.metadata.feeLedgerTotal, "-0.2");
});

test("positive fee ledger total is recorded as rebate with zero cost", async () => {
  const result = await provider([position({ openFeeTotal: "0.3", closeFeeTotal: "0.2" })]).listTrades(
    query(),
  );
  assert.equal(result.trades[0].fees, "0");
  assert.equal(result.trades[0].metadata.feeRebates, "0.5");
});

test("not fully closed positions are rejected visibly", async () => {
  const result = await provider([position({ closeTotalPos: "0.05" })]).listTrades(query());
  assert.equal(result.trades.length, 0);
  assert.deepEqual(result.rejected, [
    { externalId: "USDT-FUTURES:pos-1", code: "NOT_FULLY_CLOSED" },
  ]);
});

test("mismatched, zero, or malformed economics fail closed", async () => {
  for (const bad of [
    { category: "USDC-FUTURES" },
    { symbol: "ETHUSDT" },
    { marginCoin: "USDC" },
    { posSide: "both" },
    { openPriceAvg: "abc" },
    { openPriceAvg: "-100" },
    { openPriceAvg: "0" },
    { openTotalPos: "0.000" },
    { netProfit: "profit" },
    { createdTime: "soon" },
    { updatedTime: String(NOW + DAY) },
    { createdTime: "99999999999999999999" },
  ]) {
    await assert.rejects(
      () => provider([position(bad)]).listTrades(query()),
      (error) => error instanceof TradeError && error.code === "PROVIDER",
    );
  }
});

test("missing or blank fee fields fail closed", async () => {
  const missing: InvokeFn = async () =>
    ({ ok: true, data: { list: [{ ...position(), openFeeTotal: undefined }], cursor: null } }) as never;
  await assert.rejects(
    () => new BitgetTradeProvider({ invoke: missing }).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
  await assert.rejects(
    () => provider([position({ closeFeeTotal: "" })]).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
});

test("updated before created fails closed", async () => {
  await assert.rejects(
    () =>
      provider([
        position({ createdTime: String(NOW - DAY), updatedTime: String(NOW - 2 * DAY) }),
      ]).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
});

test("duplicate external ids and oversized pages fail closed", async () => {
  await assert.rejects(
    () => provider([position(), position()]).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
  await assert.rejects(
    () =>
      provider(
        Array.from({ length: 21 }, (_, i) => position({ positionId: `pos-${i}` })),
      ).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
});

test("oversized returned cursor fails closed", async () => {
  const invoke: InvokeFn = async () =>
    ({ ok: true, data: { list: [], cursor: "x".repeat(201) } }) as never;
  await assert.rejects(
    () => new BitgetTradeProvider({ invoke }).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
});

test("provider failure maps to sanitized provider error or timeout", async () => {
  const bad: InvokeFn = async () =>
    ({ ok: false, error: { code: "40009!bad stuff", type: "BitgetApiError" } }) as never;
  await assert.rejects(
    () => new BitgetTradeProvider({ invoke: bad }).listTrades(query()),
    (error) =>
      error instanceof TradeError && error.code === "PROVIDER" && error.providerCode === "40009badstuff",
  );
  const timeout: InvokeFn = async () =>
    ({ ok: false, error: { type: "NetworkError" } }) as never;
  await assert.rejects(
    () => new BitgetTradeProvider({ invoke: timeout }).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "TIMEOUT",
  );
});

test("malformed envelope and malformed list items fail closed", async () => {
  for (const data of [{ list: "nope" }, { wrong: true }]) {
    const invoke: InvokeFn = async () => ({ ok: true, data }) as never;
    await assert.rejects(
      () => new BitgetTradeProvider({ invoke }).listTrades(query()),
      (error) => error instanceof TradeError && error.code === "PROVIDER",
    );
  }
  await assert.rejects(
    () => provider([{ positionId: "x" }]).listTrades(query()),
    (error) => error instanceof TradeError && error.code === "PROVIDER",
  );
});

test("invalid query rejected before invoke", async () => {
  let called = 0;
  const invoke: InvokeFn = async () => {
    called += 1;
    return { ok: true, data: { list: [] } } as never;
  };
  await assert.rejects(
    () => new BitgetTradeProvider({ invoke }).listTrades(query({ endTime: NOW + DAY }) as never),
    (error) => error instanceof TradeError && error.code === "INVALID_INPUT",
  );
  assert.equal(called, 0);
});

test("cursor passed through and next cursor returned", async () => {
  const calls: unknown[] = [];
  const invoke: InvokeFn = async (_spec, args) => {
    calls.push(args);
    return { ok: true, data: { list: [], cursor: "next-page" } } as never;
  };
  const result = await new BitgetTradeProvider({ invoke }).listTrades(query({ cursor: "page-2" }));
  assert.equal((calls[0] as Record<string, unknown>).cursor, "page-2");
  assert.equal(result.nextCursor, "next-page");
});
