import assert from "node:assert/strict";
import test from "node:test";
import { AIError } from "../../src/server/ai/errors";
import { JinaEmbeddingProvider } from "../../src/server/ai/jina";
import { computeSourceHash } from "../../src/server/db/validation";

const savedEnv = {
  key: process.env.JINA_API_KEY,
  model: process.env.JINA_EMBEDDING_MODEL,
  dims: process.env.JINA_EMBEDDING_DIMENSIONS,
};
process.env.JINA_API_KEY = "test-key";
process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
process.env.JINA_EMBEDDING_DIMENSIONS = "1024";

function vector(seed = 0.5): number[] {
  const v = new Array(1024).fill(0);
  v[0] = seed;
  return v;
}

function jinaBody(texts: readonly string[], opts: { model?: string; vector?: number[]; indices?: number[] } = {}) {
  const indices = opts.indices ?? texts.map((_, i) => i);
  return {
    model: opts.model ?? "jina-embeddings-v5-text-small",
    data: indices.map((index) => ({ index, embedding: opts.vector ?? vector() })),
    usage: { total_tokens: 12 },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test("missing key or mismatched profile fails configuration", () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("no");
  };
  const saved = process.env.JINA_API_KEY;
  delete process.env.JINA_API_KEY;
  try {
    assert.throws(() => new JinaEmbeddingProvider({ fetch: fetchImpl }), AIError);
  } finally {
    process.env.JINA_API_KEY = saved;
  }
  const savedDims = process.env.JINA_EMBEDDING_DIMENSIONS;
  process.env.JINA_EMBEDDING_DIMENSIONS = "768";
  try {
    assert.throws(
      () => new JinaEmbeddingProvider({ fetch: fetchImpl }),
      (e) => e instanceof AIError && e.code === "CONFIGURATION",
    );
  } finally {
    process.env.JINA_EMBEDDING_DIMENSIONS = savedDims;
  }
});

test("document request carries locked profile fields and passage task", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return jsonResponse(jinaBody(["text one"]));
  };
  const result = await new JinaEmbeddingProvider({ fetch: fetchImpl }).embedDocument("text one");
  const body = captured as Record<string, unknown>;
  assert.equal(body.model, "jina-embeddings-v5-text-small");
  assert.deepEqual(body.input, ["text one"]);
  assert.equal(body.task, "retrieval.passage");
  assert.equal(body.dimensions, 1024);
  assert.equal(body.embedding_type, "float");
  assert.equal(body.normalized, true);
  assert.equal(body.truncate, false);
  assert.equal(result.vector.length, 1024);
  assert.equal(result.model, "jina-embeddings-v5-text-small");
  assert.equal(result.dimensions, 1024);
  assert.equal(result.sourceText, "text one");
  assert.equal(result.sourceHash, computeSourceHash("text one"));
  assert.equal(result.metadata.provider, "jina");
  assert.equal(result.metadata.task, "retrieval.passage");
});

test("query request uses retrieval.query task", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return jsonResponse(jinaBody(["q"]));
  };
  const result = await new JinaEmbeddingProvider({ fetch: fetchImpl }).embedQuery("q");
  assert.equal((captured as Record<string, unknown>).task, "retrieval.query");
  assert.equal(result.metadata.task, "retrieval.query");
});

test("batch reorders by index and rejects duplicate or out-of-range indices", async () => {
  const fetchImpl: typeof fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as { input: string[] };
    return jsonResponse(jinaBody(req.input, { indices: [2, 0, 1] }));
  };
  const results = await new JinaEmbeddingProvider({ fetch: fetchImpl }).embedMany(["a", "b", "c"], "document");
  assert.deepEqual(results.map((r) => r.sourceText), ["a", "b", "c"]);
  const dup: typeof fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as { input: string[] };
    return jsonResponse(jinaBody(req.input, { indices: [0, 0, 1] }));
  };
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: dup }).embedMany(["a", "b", "c"], "document"),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
  const oob: typeof fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as { input: string[] };
    return jsonResponse(jinaBody(req.input, { indices: [0, 1, 7] }));
  };
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: oob }).embedMany(["a", "b", "c"], "document"),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test("invalid vectors, wrong length, and model mismatch rejected", async () => {
  const nanFetch: typeof fetch = async () =>
    jsonResponse({ model: "jina-embeddings-v5-text-small", data: [{ index: 0, embedding: [NaN] }] });
  const p = new JinaEmbeddingProvider({ fetch: nanFetch });
  await assert.rejects(() => p.embedDocument("x"), AIError);
  const inf = vector();
  inf[0] = Infinity;
  const infFetch: typeof fetch = async () => jsonResponse(jinaBody(["x"], { vector: inf }));
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: infFetch }).embedDocument("x"),
    AIError,
  );
  const shortFetch: typeof fetch = async () => jsonResponse(jinaBody(["x"], { vector: [0.5] }));
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: shortFetch }).embedDocument("x"),
    AIError,
  );
  const zeroFetch: typeof fetch = async () => jsonResponse(jinaBody(["x"], { vector: vector(0) }));
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: zeroFetch }).embedDocument("x"),
    AIError,
  );
  const wrongModel: typeof fetch = async () => jsonResponse(jinaBody(["x"], { model: "other" }));
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: wrongModel }).embedDocument("x"),
    AIError,
  );
  const wrongCount: typeof fetch = async () =>
    jsonResponse({ model: "jina-embeddings-v5-text-small", data: [{ index: 0, embedding: vector() }] });
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: wrongCount }).embedMany(["a", "b"], "document"),
    AIError,
  );
});

test("input validation: blank, oversized, oversized batch, bad mode", async () => {
  const p = new JinaEmbeddingProvider({ fetch: async () => jsonResponse({}) });
  await assert.rejects(() => p.embedDocument("   "), AIError);
  await assert.rejects(() => p.embedDocument("x".repeat(32769)), AIError);
  await assert.rejects(() => p.embedMany([], "document"), AIError);
  await assert.rejects(() => p.embedMany(new Array(65).fill("x"), "document"), AIError);
  await assert.rejects(
    () => p.embedMany(["x"], "bogus" as "document"),
    AIError,
  );
});

test("string vectors and bad usage counters rejected", async () => {
  const stringVec: typeof fetch = async () =>
    jsonResponse({
      model: "jina-embeddings-v5-text-small",
      data: [{ index: 0, embedding: new Array(1024).fill("0.5") }],
    });
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: stringVec }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
  const badUsage: typeof fetch = async () =>
    jsonResponse({
      model: "jina-embeddings-v5-text-small",
      data: [{ index: 0, embedding: vector() }],
      usage: { total_tokens: -1 },
    });
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: badUsage }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test("hanging stream times out and oversized stream cancels", async () => {
  const hanging: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"model":"jina-embeddings-v5-text-small"'));
        },
      }),
      { status: 200 },
    );
  const started = Date.now();
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: hanging, timeoutMs: 200 }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
  assert.ok(Date.now() - started < 5000);
  let cancelled = false;
  const big = new Uint8Array(17 * 1024 * 1024);
  const oversized: typeof fetch = async () =>
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
    () => new JinaEmbeddingProvider({ fetch: oversized }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
  assert.equal(cancelled, true);
});

test("provider failure and timeout map to fixed errors", async () => {
  const errFetch: typeof fetch = async () => jsonResponse({ detail: "x" }, 500);
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: errFetch }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "PROVIDER" && e.status === 500,
  );
  const hanging: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  await assert.rejects(
    () => new JinaEmbeddingProvider({ fetch: hanging, timeoutMs: 100 }).embedDocument("x"),
    (e) => e instanceof AIError && e.code === "TIMEOUT",
  );
});

test.after(() => {
  if (savedEnv.key === undefined) delete process.env.JINA_API_KEY;
  else process.env.JINA_API_KEY = savedEnv.key;
  if (savedEnv.model === undefined) delete process.env.JINA_EMBEDDING_MODEL;
  else process.env.JINA_EMBEDDING_MODEL = savedEnv.model;
  if (savedEnv.dims === undefined) delete process.env.JINA_EMBEDDING_DIMENSIONS;
  else process.env.JINA_EMBEDDING_DIMENSIONS = savedEnv.dims;
});
