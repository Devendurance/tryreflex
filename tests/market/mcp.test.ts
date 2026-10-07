import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpCaller, McpCallError, mcpTimeoutMs } from "../../src/server/integrations/bitget/mcp";

const ENV_KEY = "MCP_TIMEOUT_MS";

test("mcpTimeoutMs defaults to 60000 when unset or invalid", () => {
  const saved = process.env[ENV_KEY];
  try {
    delete process.env[ENV_KEY];
    assert.equal(mcpTimeoutMs(), 60000);
    for (const bad of ["abc", "500", "90001", "1.5", "-1", ""]) {
      process.env[ENV_KEY] = bad;
      assert.equal(mcpTimeoutMs(), 60000, bad);
    }
    process.env[ENV_KEY] = "5000";
    assert.equal(mcpTimeoutMs(), 5000);
    process.env[ENV_KEY] = "1000";
    assert.equal(mcpTimeoutMs(), 1000);
    process.env[ENV_KEY] = "90000";
    assert.equal(mcpTimeoutMs(), 90000);
  } finally {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  }
});

test("caller aborts a hanging transport fetch at the wall deadline and throws TIMEOUT", async () => {
  const saved = process.env[ENV_KEY];
  process.env[ENV_KEY] = "1000";
  let receivedSignal: AbortSignal | undefined;
  let abortObserved = false;
  const pendingFetch: typeof fetch = (_input, init) => {
    receivedSignal = init?.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal || signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          abortObserved = true;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true },
      );
    });
  };
  try {
    const caller = createMcpCaller("https://unreachable.invalid/mcp", pendingFetch);
    const started = Date.now();
    await assert.rejects(
      caller("sentiment_index", { action: "current" }),
      (err: unknown) => err instanceof McpCallError && err.code === "TIMEOUT",
    );
    assert.ok(Date.now() - started < 3000, "caller did not time out within the wall deadline");
    assert.ok(receivedSignal, "fetchImpl never received a signal");
    assert.equal(abortObserved, true);
    assert.equal(receivedSignal.aborted, true);
  } finally {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  }
});
