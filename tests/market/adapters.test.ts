import { test } from "node:test";
import assert from "node:assert/strict";
import { getStockHistory, getStockQuote } from "../../src/server/integrations/bitget/stock";
import { getCryptoSentiment } from "../../src/server/integrations/bitget/signal";
import { SIGNAL_ALT_ME_ERROR_CALL_RESULT, STOCK_503_CALL_RESULT } from "./fixtures";
import type { McpToolCaller } from "../../src/server/integrations/bitget/mcp";

function recordingCaller(result: unknown) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const caller: McpToolCaller = async (tool, args) => {
    calls.push({ tool, args });
    return result;
  };
  return { caller, calls };
}

test("quote call uses exact allowlisted do_query shape", async () => {
  const { caller, calls } = recordingCaller(STOCK_503_CALL_RESULT);
  await getStockQuote("AAPL", caller);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "do_query");
  assert.deepEqual(calls[0].args, { entry_id: "equity_price_quote", params: { symbol: "AAPL" } });
});

test("history call omits time params when not provided", async () => {
  const { caller, calls } = recordingCaller(STOCK_503_CALL_RESULT);
  await getStockHistory("AAPL", undefined, undefined, caller);
  assert.deepEqual(calls[0].args, { entry_id: "equity_price_historical", params: { symbol: "AAPL" } });
});

test("history call forwards provided times as start_time/end_time", async () => {
  const { caller, calls } = recordingCaller(STOCK_503_CALL_RESULT);
  await getStockHistory("AAPL", 1759000000000, 1759600000000, caller);
  assert.deepEqual(calls[0].args, {
    entry_id: "equity_price_historical",
    params: { symbol: "AAPL", start_time: 1759000000000, end_time: 1759600000000 },
  });
});

test("captured 503 envelope maps to UPSTREAM_UNAVAILABLE without raw upstream content", async () => {
  const { caller } = recordingCaller(STOCK_503_CALL_RESULT);
  const res = await getStockQuote("AAPL", caller);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, "UPSTREAM_UNAVAILABLE");
    assert.ok(!res.message.includes("503"));
    assert.ok(!res.message.includes("<html>"));
  }
});

test("signal sentiment call uses exact tool shape", async () => {
  const { caller, calls } = recordingCaller(SIGNAL_ALT_ME_ERROR_CALL_RESULT);
  await getCryptoSentiment(caller);
  assert.equal(calls[0].tool, "sentiment_index");
  assert.deepEqual(calls[0].args, { action: "current" });
});

test("any *_error key in signal payload fails even when empty string", async () => {
  const { caller } = recordingCaller(SIGNAL_ALT_ME_ERROR_CALL_RESULT);
  const res = await getCryptoSentiment(caller);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "UPSTREAM_UNAVAILABLE");
});

test("malformed and empty provider content fail as INVALID_PROVIDER_RESPONSE", async () => {
  for (const result of [
    { content: [{ type: "text", text: "not json" }], isError: false },
    { content: [], isError: false },
    { isError: false },
    { content: [{ type: "text", text: "" }], isError: false },
  ]) {
    const { caller } = recordingCaller(result);
    const res = await getCryptoSentiment(caller);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "INVALID_PROVIDER_RESPONSE");
  }
});

test("isError true maps to UPSTREAM_UNAVAILABLE", async () => {
  const { caller } = recordingCaller({ content: [{ type: "text", text: "upstream blew up with secret url" }], isError: true });
  const res = await getStockQuote("AAPL", caller);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, "UPSTREAM_UNAVAILABLE");
    assert.ok(!res.message.includes("secret url"));
  }
});

test("caller timeout maps to TIMEOUT", async () => {
  const caller: McpToolCaller = async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    throw err;
  };
  const res = await getCryptoSentiment(caller);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "TIMEOUT");
});

test("unexpected caller failure maps to UPSTREAM_UNAVAILABLE", async () => {
  const caller: McpToolCaller = async () => {
    throw new Error("socket hangup internal detail");
  };
  const res = await getStockQuote("AAPL", caller);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, "UPSTREAM_UNAVAILABLE");
    assert.ok(!res.message.includes("socket hangup"));
  }
});

test("malformed envelope maps to INVALID_PROVIDER_RESPONSE", async () => {
  const cases = [
    { structuredContent: { success: "yes", status_code: 200, data: null, error: null }, isError: false },
    { structuredContent: { success: true, status_code: "200", data: null }, isError: false },
    { structuredContent: { status_code: 200, data: {} }, isError: false },
    { structuredContent: { success: true, data: {} }, isError: false },
    { structuredContent: "a string", isError: false },
  ];
  for (const result of cases) {
    const { caller } = recordingCaller(result);
    const res = await getStockQuote("AAPL", caller);
    assert.equal(res.ok, false, JSON.stringify(result));
    if (!res.ok) assert.equal(res.code, "INVALID_PROVIDER_RESPONSE", JSON.stringify(result));
  }
});

test("explicit false success or non-2xx status maps to UPSTREAM_UNAVAILABLE", async () => {
  const cases = [
    { structuredContent: { success: false, status_code: 200, data: null, error: "x" }, isError: false },
    { structuredContent: { success: true, status_code: 500, data: null, error: null }, isError: false },
    { structuredContent: { success: true, status_code: 302, data: null, error: null }, isError: false },
  ];
  for (const result of cases) {
    const { caller } = recordingCaller(result);
    const res = await getStockQuote("AAPL", caller);
    assert.equal(res.ok, false, JSON.stringify(result));
    if (!res.ok) assert.equal(res.code, "UPSTREAM_UNAVAILABLE", JSON.stringify(result));
  }
});

test("caller rejection with MCP RequestTimeout code maps to TIMEOUT", async () => {
  const caller: McpToolCaller = async () => {
    const err = new Error("Request timed out");
    (err as { code?: number }).code = -32001;
    throw err;
  };
  const res = await getStockQuote("AAPL", caller);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "TIMEOUT");
});
