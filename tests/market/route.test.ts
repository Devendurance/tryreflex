import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostHandler } from "../../src/server/market/context-handler";
import { createLimiter } from "../../src/server/market/concurrency";
import type { MarketContextResult } from "../../src/server/market/service";
import type { MarketRequest } from "../../src/server/market/schemas";

const unavailableResult = (req: MarketRequest): MarketContextResult => ({
  assetClass: req.assetClass,
  ...(req.assetClass === "stock" ? { symbol: req.symbol } : {}),
  capturedAt: "2026-10-07T14:00:00.000Z",
  status: "unavailable",
  components: {},
});

function recordingService(result: MarketContextResult | ((req: MarketRequest) => MarketContextResult)) {
  const seen: MarketRequest[] = [];
  const service = async (req: MarketRequest) => {
    seen.push(req);
    return typeof result === "function" ? result(req) : result;
  };
  return { service, seen };
}

function post(body: string, contentType = "application/json") {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Request("http://localhost/api/market/context", { method: "POST", headers, body });
}

test("rejects non-json content type with 415", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "", "application/jsonfoo", "text/plain; application/json", "application/jsonx"]) {
    const res = await handler(post("{}", ct));
    assert.equal(res.status, 415, ct);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("accepts application/json with charset parameter", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const res = await handler(post(JSON.stringify({ assetClass: "crypto" }), "application/json; charset=utf-8"));
  assert.notEqual(res.status, 415);
});

test("rejects body over 4096 stream bytes with 413", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const res = await handler(post("x".repeat(4097)));
  assert.equal(res.status, 413);
  const res2 = await handler(post(JSON.stringify({ assetClass: "crypto", pad: "x".repeat(5000) })));
  assert.equal(res2.status, 413);
});

test("rejects invalid JSON with 400", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const res = await handler(post("{nope"));
  assert.equal(res.status, 400);
});

test("rejects invalid symbols with 400", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  for (const symbol of ["!!!", "1ABC", "TOOLONGSYMBOLNAME12", "", "AA PL", "AAPL;DROP", "AAPL$"]) {
    const res = await handler(post(JSON.stringify({ assetClass: "stock", symbol })));
    assert.equal(res.status, 400, symbol);
  }
});

test("rejects extra keys with 400", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const res = await handler(post(JSON.stringify({ assetClass: "crypto", symbol: "BTC" })));
  assert.equal(res.status, 400);
  const res2 = await handler(post(JSON.stringify({ assetClass: "stock", symbol: "AAPL", admin: true })));
  assert.equal(res2.status, 400);
});

test("rejects invalid time ranges with 400", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const cases = [
    { assetClass: "stock", symbol: "AAPL", startTime: now, endTime: now - day },
    { assetClass: "stock", symbol: "AAPL", startTime: now + day * 10 },
    { assetClass: "stock", symbol: "AAPL", endTime: now + day * 10 },
    { assetClass: "stock", symbol: "AAPL", startTime: -5 },
    { assetClass: "stock", symbol: "AAPL", startTime: 1.5 },
    { assetClass: "stock", symbol: "AAPL", startTime: now - 400 * day, endTime: now },
    { assetClass: "stock", symbol: "AAPL", startTime: "2026-01-01" },
  ];
  for (const body of cases) {
    const res = await handler(post(JSON.stringify(body)));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("rejects unknown assetClass with 400", async () => {
  const handler = createPostHandler({ service: async () => unavailableResult({ assetClass: "crypto" }) });
  const res = await handler(post(JSON.stringify({ assetClass: "forex" })));
  assert.equal(res.status, 400);
});

test("maps unavailable service result to 503 with no-store", async () => {
  const { service, seen } = recordingService(unavailableResult);
  const handler = createPostHandler({ service });
  const res = await handler(post(JSON.stringify({ assetClass: "stock", symbol: " aapl " })));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(seen[0].assetClass, "stock");
  if (seen[0].assetClass === "stock") assert.equal(seen[0].symbol, "AAPL");
  const body = await res.text();
  assert.ok(!body.includes("<html>"));
});

test("malformed service result never produces 200 and maps to INVALID_PROVIDER_RESPONSE 503", async () => {
  const malformed = [
    { assetClass: "crypto", capturedAt: "2026-10-07T14:00:00.000Z", status: "available", components: {} },
    { assetClass: "crypto", capturedAt: "2026-10-07T14:00:00.000Z", status: "partial", components: { sentiment: { status: "unavailable", code: "UPSTREAM_UNAVAILABLE", message: "x" } } },
    { assetClass: "stock", capturedAt: "bad-date", status: "unavailable", components: {} },
    { status: "unavailable" },
    null,
    "ok",
  ];
  for (const bad of malformed) {
    const { service } = recordingService(bad as never);
    const handler = createPostHandler({ service });
    const res = await handler(post(JSON.stringify({ assetClass: "crypto" })));
    assert.equal(res.status, 503, JSON.stringify(bad));
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_PROVIDER_RESPONSE", JSON.stringify(bad));
  }
});

test("service throw maps to 503 UPSTREAM_UNAVAILABLE safe error body", async () => {
  const handler = createPostHandler({
    service: async () => {
      throw new Error("internal stack with upstream url https://leak.example");
    },
  });
  const res = await handler(post(JSON.stringify({ assetClass: "crypto" })));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
  assert.ok(!JSON.stringify(body).includes("leak.example"));
});

test("returns 429 when concurrency cap is saturated", async () => {
  const limiter = createLimiter(4);
  const releases = [limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()];
  assert.ok(releases.every(Boolean));
  const { service } = recordingService(unavailableResult);
  const handler = createPostHandler({ service, limiter });
  const res = await handler(post(JSON.stringify({ assetClass: "crypto" })));
  assert.equal(res.status, 429);
  releases.forEach((r) => r?.());
});
