import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketContext, overallStatus } from "../../src/server/market/service";
import { marketContextResponseSchema } from "../../src/server/market/schemas";
import { getStockHistory, getStockQuote } from "../../src/server/integrations/bitget/stock";
import { getCryptoSentiment } from "../../src/server/integrations/bitget/signal";
import { SIGNAL_ALT_ME_ERROR_CALL_RESULT, STOCK_503_CALL_RESULT } from "./fixtures";
import type { McpToolCaller } from "../../src/server/integrations/bitget/mcp";

const caller503: McpToolCaller = async () => STOCK_503_CALL_RESULT;
const callerAltMeError: McpToolCaller = async () => SIGNAL_ALT_ME_ERROR_CALL_RESULT;
const callerGarbage: McpToolCaller = async () => ({ content: [{ type: "text", text: "<<<not-json>>>" }] });

const deps503 = {
  getQuote: (symbol: string) => getStockQuote(symbol, caller503),
  getHistory: (symbol: string, start?: number, end?: number) => getStockHistory(symbol, start, end, caller503),
  getSentiment: () => getCryptoSentiment(callerAltMeError),
};

test("stock request with captured 503 upstream yields unavailable components", async () => {
  const res = await getMarketContext({ assetClass: "stock", symbol: "AAPL" }, deps503);
  assert.equal(res.assetClass, "stock");
  assert.equal(res.symbol, "AAPL");
  assert.equal(res.status, "unavailable");
  for (const key of ["quote", "history"] as const) {
    const c = res.components[key];
    assert.ok(c, key);
    assert.equal(c.status, "unavailable");
    if (c.status === "unavailable") {
      assert.equal(c.code, "UPSTREAM_UNAVAILABLE");
      assert.ok(!c.message.includes("503"));
      assert.ok(!c.message.includes("<html>"));
    }
  }
  assert.ok(!("sentiment" in res.components));
  assert.match(res.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("crypto request with captured alt_me_error yields unavailable sentiment", async () => {
  const res = await getMarketContext({ assetClass: "crypto" }, deps503);
  assert.equal(res.assetClass, "crypto");
  assert.equal(res.status, "unavailable");
  assert.ok(!("symbol" in res));
  const s = res.components.sentiment;
  assert.ok(s);
  assert.equal(s.status, "unavailable");
  if (s.status === "unavailable") assert.equal(s.code, "UPSTREAM_UNAVAILABLE");
});

test("malformed provider JSON maps to INVALID_PROVIDER_RESPONSE", async () => {
  const res = await getMarketContext(
    { assetClass: "crypto" },
    { getQuote: deps503.getQuote, getHistory: deps503.getHistory, getSentiment: () => getCryptoSentiment(callerGarbage) },
  );
  const s = res.components.sentiment;
  assert.equal(s?.status, "unavailable");
  if (s?.status === "unavailable") assert.equal(s.code, "INVALID_PROVIDER_RESPONSE");
});

test("unavailable service results satisfy the response boundary schema", async () => {
  const stock = await getMarketContext({ assetClass: "stock", symbol: "AAPL" }, deps503);
  assert.equal(marketContextResponseSchema.safeParse(stock).success, true);
  const crypto = await getMarketContext({ assetClass: "crypto" }, deps503);
  assert.equal(marketContextResponseSchema.safeParse(crypto).success, true);
});

test("overallStatus aggregates component outcomes", () => {
  assert.equal(overallStatus(["available", "available"]), "available");
  assert.equal(overallStatus(["available", "unavailable"]), "partial");
  assert.equal(overallStatus(["unavailable", "unavailable"]), "unavailable");
  assert.equal(overallStatus(["unavailable"]), "unavailable");
});
