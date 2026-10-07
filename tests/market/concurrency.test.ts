import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../../src/server/market/concurrency";

test("limiter admits up to cap then rejects until release", () => {
  const limiter = createLimiter(4);
  const a = limiter.tryAcquire();
  const b = limiter.tryAcquire();
  const c = limiter.tryAcquire();
  const d = limiter.tryAcquire();
  assert.ok(a && b && c && d);
  assert.equal(limiter.tryAcquire(), null);
  c();
  const e = limiter.tryAcquire();
  assert.ok(e);
  assert.equal(limiter.tryAcquire(), null);
  a();
  b();
  d();
  e();
  assert.equal(limiter.inFlight(), 0);
});

test("release is idempotent", () => {
  const limiter = createLimiter(1);
  const r = limiter.tryAcquire();
  assert.ok(r);
  r();
  r();
  assert.equal(limiter.inFlight(), 0);
});
