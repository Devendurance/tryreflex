import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AIError, groundingFailure } from "../../src/server/ai/errors";
import { GroqLLMProvider } from "../../src/server/ai/groq";
import type { AiRunRecorder } from "../../src/server/ai/types";

const savedEnv = { key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL };
process.env.GROQ_API_KEY = "test-key";
process.env.GROQ_MODEL = "test-model";

function fakeRecorder(rows: Record<string, unknown>[] = []): AiRunRecorder & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async record(input: unknown) {
      calls.push(input);
      return rows[0] ?? { id: "run-1" };
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function groqBody(content: string | null, opts: { finish?: string; refusal?: string; model?: string } = {}) {
  return {
    model: opts.model ?? "test-model",
    choices: [
      {
        finish_reason: opts.finish ?? "stop",
        message: { content, refusal: opts.refusal ?? null },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    reasoning: "hidden chain",
  };
}

const objectSchema = z.strictObject({ answer: z.string() });

const REQ = { system: "sys", input: "in", pipeline: "p", promptVersion: "v1" };

function provider(fetchImpl: typeof fetch, opts: { recorder?: AiRunRecorder; timeoutMs?: number } = {}) {
  return new GroqLLMProvider({
    recorder: opts.recorder ?? fakeRecorder(),
    fetch: fetchImpl,
    timeoutMs: opts.timeoutMs,
  });
}

test("missing config or bad timeout fails configuration before any fetch", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  const saved = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    assert.throws(() => provider(fetchImpl), (e) => e instanceof AIError && e.code === "CONFIGURATION");
  } finally {
    process.env.GROQ_API_KEY = saved;
  }
  assert.throws(
    () => provider(fetchImpl, { timeoutMs: 0 }),
    (e) => e instanceof AIError && e.code === "CONFIGURATION",
  );
  assert.throws(
    () => provider(fetchImpl, { timeoutMs: 90001 }),
    (e) => e instanceof AIError && e.code === "CONFIGURATION",
  );
});

test("invalid request rejected before fetch", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  const p = provider(fetchImpl);
  await assert.rejects(() => p.generateText({ ...REQ, input: "" }), (e) => e instanceof AIError && e.code === "SCHEMA");
  await assert.rejects(
    () => p.generateText({ ...REQ, input: "x".repeat(32769) }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
  await assert.rejects(
    () => p.generateText({ ...REQ, inputEntityIds: ["not-uuid"] }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test("structured request sends strict json_schema from zod", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return jsonResponse(groqBody('{"answer":"ok"}'));
  };
  const recorder = fakeRecorder();
  const result = await provider(fetchImpl, { recorder }).generateStructured({
    ...REQ,
    schema: objectSchema,
    schemaName: "answer",
  });
  const body = captured as Record<string, unknown>;
  assert.equal(body.model, "test-model");
  assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, 2048);
  const rf = body.response_format as Record<string, unknown>;
  assert.equal(rf.type, "json_schema");
  const js = rf.json_schema as Record<string, unknown>;
  assert.equal(js.name, "answer");
  assert.equal(js.strict, true);
  const schema = js.schema as Record<string, unknown>;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["answer"]);
  assert.equal(result.value.answer, "ok");
  assert.equal(result.provider, "groq");
  assert.equal(result.model, "test-model");
  assert.equal(result.promptVersion, "v1");
  assert.equal(result.runId, "run-1");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("successful run recorded once with normalized usage, no content", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(groqBody('{"answer":"ok"}'));
  const recorder = fakeRecorder();
  await provider(fetchImpl, { recorder }).generateStructured({ ...REQ, schema: objectSchema, schemaName: "a" });
  assert.equal(recorder.calls.length, 1);
  const run = recorder.calls[0] as Record<string, unknown>;
  assert.equal(run.pipeline, "p");
  assert.equal(run.model, "test-model");
  assert.equal(run.promptVersion, "v1");
  assert.equal(run.status, "success");
  const tu = run.tokenUsage as Record<string, unknown>;
  assert.deepEqual(tu.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  const meta = tu.run as Record<string, unknown>;
  assert.equal(meta.provider, "groq");
  assert.equal(meta.attempts, 1);
  assert.ok(!JSON.stringify(run).includes("answer"));
});

test("text path returns raw content without response_format", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return jsonResponse(groqBody("free text"));
  };
  const result = await provider(fetchImpl).generateText(REQ);
  assert.equal(result.value, "free text");
  assert.equal((captured as Record<string, unknown>).response_format, undefined);
});

test("malformed schema output retried once then succeeds", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody(calls === 1 ? '{"wrong":1}' : '{"answer":"ok"}'));
  };
  const result = await provider(fetchImpl).generateStructured({ ...REQ, schema: objectSchema, schemaName: "a" });
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
});

test("auth failure and refusal do not retry", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({ error: { message: "no" } }, 401);
  };
  await assert.rejects(
    () => provider(fetchImpl).generateText(REQ),
    (e) => e instanceof AIError && e.code === "PROVIDER" && e.status === 401,
  );
  assert.equal(calls, 1);
  calls = 0;
  const refuse: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody(null, { refusal: "no" }));
  };
  await assert.rejects(
    () => provider(refuse).generateText(REQ),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
  assert.equal(calls, 1);
});

test("transient 503 retries, truncated and model mismatch do not", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({}, 503);
    return jsonResponse(groqBody("ok"));
  };
  const result = await provider(fetchImpl).generateText(REQ);
  assert.equal(result.attempts, 2);
  calls = 0;
  const trunc: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody("partial", { finish: "length" }));
  };
  await assert.rejects(() => provider(trunc).generateText(REQ), (e) => e instanceof AIError);
  assert.equal(calls, 1);
  calls = 0;
  const wrongModel: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody("ok", { model: "other-model" }));
  };
  await assert.rejects(() => provider(wrongModel).generateText(REQ), (e) => e instanceof AIError);
  assert.equal(calls, 1);
});

test("unknown nested evidence ids reject without retry, allowed ids pass", async () => {
  const payload = {
    answer: "x",
    nested: { evidenceRefs: [{ id: "ev-unknown" }], evidenceIds: ["ev-unknown"] },
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody(JSON.stringify(payload)));
  };
  const schema = z.strictObject({
    answer: z.string(),
    nested: z.strictObject({
      evidenceRefs: z.array(z.strictObject({ id: z.string() })),
      evidenceIds: z.array(z.string()),
    }),
  });
  await assert.rejects(
    () =>
      provider(fetchImpl).generateStructured({ ...REQ, schema, schemaName: "a", allowedEvidenceIds: ["ev-ok"] }),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  assert.equal(calls, 1);
  const ok = await provider(fetchImpl).generateStructured({
    ...REQ,
    schema,
    schemaName: "a",
    allowedEvidenceIds: ["ev-unknown"],
  });
  assert.equal(ok.value.answer, "x");
});

test("default deny: no allowed list rejects any evidence id", async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse(groqBody('{"answer":"x","evidenceId":"e1"}'));
  const schema = z.strictObject({ answer: z.string(), evidenceId: z.string() });
  await assert.rejects(
    () => provider(fetchImpl).generateStructured({ ...REQ, schema, schemaName: "a" }),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
});

test("domain validate failure is grounding, no retry", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody('{"answer":"x"}'));
  };
  await assert.rejects(
    () =>
      provider(fetchImpl).generateStructured({
        ...REQ,
        schema: objectSchema,
        schemaName: "a",
        validate: () => {
          throw new Error("bad");
        },
      }),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  assert.equal(calls, 1);
});

test("wall-clock deadline aborts a pending fetch", async () => {
  const fetchImpl: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  const started = Date.now();
  await assert.rejects(
    () => provider(fetchImpl, { timeoutMs: 200 }).generateText(REQ),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
  assert.ok(Date.now() - started < 5000);
});

test("recorder failure surfaces persistence, records exactly once, fetches once", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    return jsonResponse(groqBody('{"answer":"x"}'));
  };
  let recordCalls = 0;
  const recorder: AiRunRecorder = {
    record: async () => {
      recordCalls += 1;
      throw new Error("db down");
    },
  };
  await assert.rejects(
    () => provider(fetchImpl, { recorder }).generateStructured({ ...REQ, schema: objectSchema, schemaName: "a" }),
    (e) => e instanceof AIError && e.code === "PERSISTENCE",
  );
  assert.equal(recordCalls, 1);
  assert.equal(fetchCalls, 1);
});

test("failed run recorded once with safe validation error category", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ error: {} }, 400);
  const recorder = fakeRecorder();
  await assert.rejects(() => provider(fetchImpl, { recorder }).generateText(REQ), AIError);
  assert.equal(recorder.calls.length, 1);
  const run = recorder.calls[0] as Record<string, unknown>;
  assert.equal(run.status, "failed");
  assert.deepEqual(run.validationErrors, [{ category: "PROVIDER" }]);
  assert.ok(!JSON.stringify(run).includes("sys"));
});

test("grounding diagnostics are recorded with the failed run", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(groqBody('{"answer":"x"}'));
  const recorder = fakeRecorder();
  await assert.rejects(
    () =>
      provider(fetchImpl, { recorder }).generateStructured({
        ...REQ,
        schema: objectSchema,
        schemaName: "a",
        validate: () => groundingFailure("QUOTE_NOT_EXACT", "dimensions[0].observedFacts[0].quote"),
      }),
    (e) =>
      e instanceof AIError &&
      e.code === "GROUNDING" &&
      e.grounding?.reason === "QUOTE_NOT_EXACT" &&
      e.grounding.path === "dimensions[0].observedFacts[0].quote",
  );
  const run = recorder.calls[0] as {
    status: string;
    validationErrors: { category: string; grounding?: { reason: string; path: string } }[];
  };
  assert.equal(run.status, "failed");
  assert.deepEqual(run.validationErrors, [
    { category: "GROUNDING", grounding: { reason: "QUOTE_NOT_EXACT", path: "dimensions[0].observedFacts[0].quote" } },
  ]);
});

test("coerced, stripped, or transformed output is rejected fail-closed", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(groqBody('{"n":"5"}'));
  const coerce = z.strictObject({ n: z.coerce.number() });
  await assert.rejects(
    () => provider(fetchImpl).generateStructured({ ...REQ, schema: coerce, schemaName: "a" }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
  let calls = 0;
  const stripFetch: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(groqBody('{"a":"x","extra":1}'));
  };
  const strip = z.object({ a: z.string() });
  await assert.rejects(
    () => provider(stripFetch).generateStructured({ ...REQ, schema: strip, schemaName: "a" }),
    AIError,
  );
  assert.ok(calls <= 2);
  const transformed = z.strictObject({ a: z.string().transform((s) => s.toUpperCase()) });
  await assert.rejects(
    () =>
      provider(async () => jsonResponse(groqBody('{"a":"x"}'))).generateStructured({
        ...REQ,
        schema: transformed,
        schemaName: "a",
      }),
    AIError,
  );
  const ok = await provider(async () => jsonResponse(groqBody('{"a":"x","n":5}'))).generateStructured({
    ...REQ,
    schema: z.strictObject({ a: z.string(), n: z.number() }),
    schemaName: "a",
  });
  assert.equal(ok.value.n, 5);
});

test("schemaName pattern and whitespace-only request fields rejected before fetch", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  const p = provider(fetchImpl);
  for (const name of ["", "1abc", "bad-name!", "a".repeat(65)]) {
    await assert.rejects(
      () => p.generateStructured({ ...REQ, schema: objectSchema, schemaName: name }),
      (e) => e instanceof AIError && e.code === "SCHEMA",
    );
  }
  await assert.rejects(
    () => p.generateText({ ...REQ, system: "   " }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
  await assert.rejects(
    () => p.generateText({ ...REQ, pipeline: "  " }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test("hanging response stream hits the wall-clock deadline", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"model":"test-model"'));
        },
      }),
      { status: 200 },
    );
  const started = Date.now();
  await assert.rejects(
    () => provider(fetchImpl, { timeoutMs: 200 }).generateText(REQ),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
  assert.ok(Date.now() - started < 5000);
});

test("oversized stream cancels the body and aborts", async () => {
  let cancelled = false;
  const big = new Uint8Array(3 * 1024 * 1024);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(big);
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => provider(fetchImpl).generateText(REQ),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
  assert.equal(cancelled, true);
});

test("noncooperative cancel promises cannot stall cleanup", async () => {
  const hangingCancel = () => new Promise<void>(() => {});
  const errFetch: typeof fetch = async () =>
    new Response(new ReadableStream({ cancel: hangingCancel }), { status: 500 });
  const started = Date.now();
  await assert.rejects(
    () => provider(errFetch).generateText(REQ),
    (e) => e instanceof AIError && e.code === "PROVIDER" && e.status === 500,
  );
  const big = new Uint8Array(3 * 1024 * 1024);
  const overflowFetch: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(big);
        },
        cancel: hangingCancel,
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => provider(overflowFetch).generateText(REQ),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
  assert.ok(Date.now() - started < 5000);
});

test("timed-out body still cancels the reader", async () => {
  let cancelled = false;
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"));
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => provider(fetchImpl, { timeoutMs: 200 }).generateText(REQ),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
  assert.equal(cancelled, true);
});

test("expired first attempt never resets the shared deadline", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      throw new TypeError("socket reset");
    }
    return new Promise<Response>(() => {});
  };
  const started = Date.now();
  await assert.rejects(
    () => provider(fetchImpl, { timeoutMs: 300 }).generateText(REQ),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
  assert.ok(Date.now() - started < 5000);
});

test("unrepresentable loose schema fails locally before fetch", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  const loose = z.looseObject({ answer: z.string() });
  await assert.rejects(
    () => provider(fetchImpl).generateStructured({ ...REQ, schema: loose, schemaName: "a" }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test.after(() => {
  if (savedEnv.key === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedEnv.key;
  if (savedEnv.model === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = savedEnv.model;
});

test("maxCompletionTokens defaults to 2048 in both payloads and accepts bounded overrides", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return jsonResponse(groqBody('{"answer":"ok"}'));
  };
  const def = new GroqLLMProvider({ recorder: fakeRecorder(), fetch: fetchImpl });
  await def.generateStructured({ ...REQ, schema: objectSchema, schemaName: "a" });
  assert.equal((captured as Record<string, unknown>).max_completion_tokens, 2048);
  await def.generateText(REQ);
  assert.equal((captured as Record<string, unknown>).max_completion_tokens, 2048);

  const override = new GroqLLMProvider({ recorder: fakeRecorder(), fetch: fetchImpl, maxCompletionTokens: 8192 });
  const result = await override.generateStructured({ ...REQ, schema: objectSchema, schemaName: "a" });
  assert.equal((captured as Record<string, unknown>).max_completion_tokens, 8192);
  assert.equal(result.value.answer, "ok");

  const maxBoundary = new GroqLLMProvider({ recorder: fakeRecorder(), fetch: fetchImpl, maxCompletionTokens: 16384 });
  await maxBoundary.generateText(REQ);
  assert.equal((captured as Record<string, unknown>).max_completion_tokens, 16384);
});

test("invalid maxCompletionTokens fails CONFIGURATION before any fetch", () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 16385]) {
    assert.throws(
      () => new GroqLLMProvider({ recorder: fakeRecorder(), fetch: fetchImpl, maxCompletionTokens: value }),
      (e) => e instanceof AIError && e.code === "CONFIGURATION",
      `value ${value} must be rejected`,
    );
  }
});
