import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHistoryPayload,
  normalizeQuotePayload,
  normalizeSentimentPayload,
} from "../../src/server/market/normalize";

test("quote rejects symbol mismatch to prevent cross-asset contamination", () => {
  const payload = { symbol: "MSFT", last_price: 100, last_timestamp: "2026-10-01T00:00:00Z" };
  assert.equal(normalizeQuotePayload(payload, "AAPL"), null);
});

test("quote rejects missing, non-finite, nonpositive, or string-coerced last_price", () => {
  assert.equal(normalizeQuotePayload({ symbol: "AAPL" }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: "abc" }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: Number.POSITIVE_INFINITY }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: null }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: "250" }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: "0xFA" }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: "  " }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: 0 }, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ symbol: "AAPL", last_price: -3.5 }, "AAPL"), null);
});

test("quote rejects undocumented wrappers", () => {
  const doc = { symbol: "AAPL", last_price: 250, last_timestamp: "2026-10-06T20:00:00Z" };
  assert.equal(normalizeQuotePayload([doc, doc], "AAPL"), null);
  assert.equal(normalizeQuotePayload("AAPL", "AAPL"), null);
  assert.equal(normalizeQuotePayload(250, "AAPL"), null);
  assert.equal(normalizeQuotePayload({ quote: doc }, "AAPL"), null);
  assert.equal(normalizeQuotePayload(null, "AAPL"), null);
});

test("quote never fabricates observedAt from invalid timestamps", () => {
  const payload = { symbol: "AAPL", last_price: 250, last_timestamp: "not-a-date" };
  const out = normalizeQuotePayload(payload, "AAPL");
  assert.ok(out);
  assert.equal(out.observedAt, null);
  assert.equal(out.currency, null);
});

test("quote omits non-numeric or non-finite optional bid/ask", () => {
  const payload = {
    symbol: "AAPL",
    last_price: 250,
    last_timestamp: "2026-10-06T20:00:00Z",
    bid: "249.9",
    ask: Number.NaN,
  };
  const out = normalizeQuotePayload(payload, "AAPL");
  assert.ok(out);
  assert.equal("bid" in out, false);
  assert.equal("ask" in out, false);
});

test("history rejects empty and non-array payloads", () => {
  assert.equal(normalizeHistoryPayload([], "AAPL"), null);
  assert.equal(normalizeHistoryPayload({ candles: [] }, "AAPL"), null);
  assert.equal(normalizeHistoryPayload("x", "AAPL"), null);
  assert.equal(normalizeHistoryPayload(null, "AAPL"), null);
});

test("history rejects candles violating OHLCV invariants", () => {
  const valid = { date: "2026-10-06", open: 10, high: 12, low: 9, close: 11, volume: 1000 };
  assert.equal(normalizeHistoryPayload([{ ...valid, high: 10.5 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, low: 10.5 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, open: 0 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, close: -1 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, volume: -5 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, volume: "lots" }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: "10/06/2026" }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: "2026-13-40" }], "AAPL"), null);
});

test("history rejects rolled-over and non-string candle dates", () => {
  const valid = { date: "2026-10-06", open: 10, high: 12, low: 9, close: 11, volume: 1000 };
  assert.equal(normalizeHistoryPayload([{ ...valid, date: "2026-02-30" }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: "2026-04-31" }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: 1759795200000 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: 1759795200 }], "AAPL"), null);
  assert.equal(normalizeHistoryPayload([{ ...valid, date: "1759795200" }], "AAPL"), null);
});

test("history preserves intraday RFC3339 candle timestamps verbatim", () => {
  const raw = "2026-10-06T14:30:00+02:00";
  const out = normalizeHistoryPayload(
    [{ date: raw, open: 10, high: 12, low: 9, close: 11, volume: 100 }],
    "AAPL",
  );
  assert.ok(out);
  assert.equal(out[0].date, raw);
});

test("history rejects rolled-over RFC3339 candle dates", () => {
  const candle = { date: "2026-02-30T14:30:00Z", open: 10, high: 12, low: 9, close: 11, volume: 100 };
  assert.equal(normalizeHistoryPayload([candle], "AAPL"), null);
});

test("history rejects when any single candle is malformed", () => {
  const valid = { date: "2026-10-06", open: 10, high: 12, low: 9, close: 11, volume: 1000 };
  const bad = { date: "2026-10-05", open: "NaN-string", high: 12, low: 9, close: 11, volume: 100 };
  assert.equal(normalizeHistoryPayload([valid, bad], "AAPL"), null);
});

test("sentiment rejects undocumented or malformed shapes", () => {
  assert.equal(normalizeSentimentPayload({}), null);
  assert.equal(normalizeSentimentPayload({ data: [] }), null);
  assert.equal(normalizeSentimentPayload({ data: "current" }), null);
  assert.equal(normalizeSentimentPayload({ value: 25 }), null);
  assert.equal(
    normalizeSentimentPayload({ data: [{ value: "abc", value_classification: "Fear", timestamp: "1759795200" }] }),
    null,
  );
  assert.equal(
    normalizeSentimentPayload({ data: [{ value: "150", value_classification: "Greed", timestamp: "1759795200" }] }),
    null,
  );
  assert.equal(
    normalizeSentimentPayload({ data: [{ value: "25", timestamp: "1759795200" }] }),
    null,
  );
  assert.equal(
    normalizeSentimentPayload({ data: [{ value: "25", value_classification: "Fear", timestamp: "not-unix" }] }),
    null,
  );
});

test("sentiment rejects blank, hex, decimal, and out-of-range value strings", () => {
  const base = { value_classification: "Fear", timestamp: "1759795200" };
  for (const value of ["", "  ", "0x19", "25.5", "-3", "25e1", "101", "999", "abc"]) {
    assert.equal(normalizeSentimentPayload({ data: [{ ...base, value }] }), null, value);
  }
});

test("sentiment rejects non-safe-integer or out-of-range epoch timestamps", () => {
  const base = { value: "25", value_classification: "Fear" };
  for (const timestamp of ["", "abc", "1.5", "9007199254740993", "-5"]) {
    assert.equal(normalizeSentimentPayload({ data: [{ ...base, timestamp }] }), null, timestamp);
  }
});
