import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { AIError } from "../../src/server/ai/errors";
import { assertGroundedEvidence } from "../../src/server/ai/grounding";
import { MEMORY_TEXT_VERSION, buildMemoryText } from "../../src/server/ai/memory-text";
import { createMemoryStore } from "../../src/server/ai/memory-store";
import type { EmbeddingResult } from "../../src/server/ai/types";
import { RepositoryError, createRepositories } from "../../src/server/db/repositories";
import { computeSourceHash } from "../../src/server/db/validation";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const ENTITY_ID = "bbbbbbbb-2222-4333-8444-cccccccccccc";
const auth: AuthContext = { userId: USER_ID, provider: "test", subject: "sub-1" };

const savedEnv = {
  model: process.env.JINA_EMBEDDING_MODEL,
  dims: process.env.JINA_EMBEDDING_DIMENSIONS,
};
process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
process.env.JINA_EMBEDDING_DIMENSIONS = "1024";

interface FakeSession extends DbSession {
  calls: { text: string; values?: readonly unknown[] }[];
}

function fakeSession(handler: (text: string) => Record<string, unknown>[] = () => [{ ok: true }]): FakeSession {
  const calls: FakeSession["calls"] = [];
  const session: FakeSession = {
    calls,
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return { rows: handler(text) as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      return fn(session);
    },
  };
  return session;
}

function embeddedResult(task: string, sourceText = "src"): EmbeddingResult {
  const vector = new Array(1024).fill(0);
  vector[0] = 0.5;
  return {
    vector,
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText,
    sourceHash: computeSourceHash(sourceText),
    metadata: { provider: "jina", task, retrievedAt: "2026-01-01T00:00:00Z" },
  };
}

test("decision memory text is deterministic with sorted deduped origins", () => {
  const { text, version } = buildMemoryText({
    kind: "decision",
    assetSymbol: "  BTC  ",
    assetClass: "crypto",
    origins: ["social_confirmation", "original_research", "social_confirmation"],
    thesis: "line\n  breaks",
    invalidation: "below x",
  });
  assert.equal(version, MEMORY_TEXT_VERSION);
  assert.equal(
    text,
    "kind: decision\nasset_symbol: BTC\nasset_class: crypto\norigins: original_research|social_confirmation\nthesis: line breaks\ninvalidation: below x",
  );
});

test("decision memory omits missing fields and rejects empty content", () => {
  const { text } = buildMemoryText({ kind: "decision", thesis: "only" });
  assert.equal(text, "kind: decision\nthesis: only");
  assert.throws(() => buildMemoryText({ kind: "decision" }));
});

test("review/pattern/rule memory text", () => {
  assert.equal(
    buildMemoryText({
      kind: "review",
      findings: [" first ", "second"],
      processClassification: "lucky_escape",
    }).text,
    "kind: review\nprocess_classification: lucky_escape\nfinding: first\nfinding: second",
  );
  assert.equal(
    buildMemoryText({
      kind: "pattern",
      patternKind: "leak",
      description: "revenge entries",
      status: "emerging",
      evidenceCount: 3,
    }).text,
    "kind: pattern\npattern_kind: leak\nstatus: emerging\nevidence_count: 3\ndescription: revenge entries",
  );
  assert.equal(
    buildMemoryText({
      kind: "rule",
      title: "wait",
      trigger: "closed market",
      ruleText: "no entries",
      status: "active",
      version: 2,
    }).text,
    "kind: rule\nversion: 2\nstatus: active\ntitle: wait\ntrigger: closed market\nrule_text: no entries",
  );
  assert.throws(() => buildMemoryText({ kind: "review", findings: [] }));
  assert.throws(() => buildMemoryText({ kind: "bogus" }));
  assert.throws(() => buildMemoryText({ kind: "rule", title: "t", trigger: "t", ruleText: "r", status: "s", version: 0 }));
});

test("grounding inspects nested evidence id forms", () => {
  assert.throws(() => assertGroundedEvidence({ evidenceId: "x" }, []), (e) => e instanceof AIError && e.code === "GROUNDING");
  assert.throws(() => assertGroundedEvidence({ a: { evidenceIds: ["ok", "bad"] } }, ["ok"]), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceRefs: [{ evidenceId: "z" }] }, []), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceRefs: ["z"] }, ["ok"]), AIError);
  assertGroundedEvidence({ deep: [{ evidenceId: "ok", evidenceRefs: [{ id: "ok2" }] }] }, ["ok", "ok2"]);
  assertGroundedEvidence({ answer: "none" }, []);
});

test("findBySource issues exact dedupe lookup SQL", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.memoryEmbeddings.findBySource({ entityType: "decision", entityId: ENTITY_ID, sourceText: "abc" });
  const call = session.calls[0];
  assert.match(
    call.text,
    /^SELECT \* FROM public\.memory_embeddings WHERE user_id=\$1 AND entity_type=\$2 AND entity_id=\$3 AND model=\$4 AND dimensions=\$5 AND source_hash=\$6 LIMIT 1$/,
  );
  assert.deepEqual(call.values?.slice(0, 4), [USER_ID, "decision", ENTITY_ID, "jina-embeddings-v5-text-small"]);
  assert.equal(call.values?.[4], 1024);
  assert.equal((call.values?.[5] as string).length, 64);
});

test("searchByVector issues exact similarity SQL with clamped limit", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const embedding = new Array(1024).fill(0);
  embedding[0] = 0.5;
  await repos.memoryEmbeddings.searchByVector({
    embedding,
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    limit: 500,
  });
  const call = session.calls[0];
  assert.match(call.text, /1-\(embedding <=> \$2::vector\) AS similarity FROM public\.memory_embeddings/);
  assert.match(call.text, /ORDER BY embedding <=> \$2::vector,id LIMIT \$5$/);
  const values = call.values as unknown[];
  assert.equal(values[0], USER_ID);
  assert.match(values[1] as string, /^\[0\.5(,0){1023}\]$/);
  assert.equal(values[4], 100);
});

test("searchByVector rejects wrong profile and bad vector before query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const embedding = new Array(1024).fill(0);
  embedding[0] = 0.5;
  await assert.rejects(
    () =>
      repos.memoryEmbeddings.searchByVector({ embedding, model: "other", dimensions: 1024 }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      repos.memoryEmbeddings.searchByVector({ embedding: [1, 2], model: "jina-embeddings-v5-text-small", dimensions: 1024 }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  assert.equal(session.calls.length, 0);
});

test("storeDocument dedupes via findBySource before any paid call", async () => {
  const existing = { id: "emb-existing" };
  const session = fakeSession((text) => {
    if (text.includes("FROM public.decisions")) return [{ id: ENTITY_ID }];
    if (text.includes("FROM public.memory_embeddings")) return [existing];
    return [];
  });
  let embedCalls = 0;
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async () => {
      embedCalls += 1;
      return embeddedResult("retrieval.passage");
    },
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  });
  const row = await store.storeDocument({ entityType: "decision", entityId: ENTITY_ID, sourceText: "x" });
  assert.equal(row, existing);
  assert.equal(embedCalls, 0);
  assert.ok(!session.calls.some((c) => c.text.startsWith("INSERT INTO public.memory_embeddings")));
});

test("storeDocument verifies entity, embeds once, stores with provider metadata", async () => {
  const session = fakeSession((text) => {
    if (text.includes("FROM public.decisions")) return [{ id: ENTITY_ID }];
    if (text.includes("FROM public.memory_embeddings")) return [];
    return [{ id: "new-emb" }];
  });
  let embedCalls = 0;
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async (text) => {
      embedCalls += 1;
      return embeddedResult("retrieval.passage", text);
    },
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  });
  await store.storeDocument({
    entityType: "decision",
    entityId: ENTITY_ID,
    sourceText: "x",
    metadata: { task: "caller-override", note: "kept" },
  });
  assert.equal(embedCalls, 1);
  const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.memory_embeddings"));
  assert.ok(insert);
  const meta = (insert.values as unknown[])[12] as Record<string, unknown>;
  assert.equal(meta.task, "retrieval.passage");
  assert.equal(meta.note, "kept");
});

test("storeDocument fails safely for nonexistent entity and DB errors", async () => {
  const notFound = fakeSession(() => []);
  let embedCalls = 0;
  const embedder = {
    embedDocument: async () => {
      embedCalls += 1;
      return embeddedResult("retrieval.passage");
    },
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  };
  await assert.rejects(
    () =>
      createMemoryStore(createRepositories(notFound, auth), embedder).storeDocument({
        entityType: "decision",
        entityId: ENTITY_ID,
        sourceText: "x",
      }),
    (e) => e instanceof RepositoryError && e.code === "NOT_FOUND",
  );
  assert.equal(embedCalls, 0);
  const broken = fakeSession(() => {
    throw new Error("socket hangup");
  });
  await assert.rejects(
    () =>
      createMemoryStore(createRepositories(broken, auth), embedder).storeDocument({
        entityType: "decision",
        entityId: ENTITY_ID,
        sourceText: "x",
      }),
    (e) => e instanceof AIError && e.code === "PERSISTENCE",
  );
  await assert.rejects(
    () =>
      createMemoryStore(createRepositories(notFound, auth), embedder).storeDocument({
        entityType: "bogus",
        entityId: ENTITY_ID,
        sourceText: "x",
      }),
    (e) => e instanceof AIError && e.code === "SCHEMA",
  );
});

test("grounding rejects malformed evidence structures", () => {
  assert.throws(() => assertGroundedEvidence({ evidenceId: 5 }, ["5"]), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceIds: "x" }, ["x"]), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceIds: ["ok", 7] }, ["ok"]), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceRefs: "x" }, []), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceRefs: [{ note: "no id" }] }, []), AIError);
  assert.throws(() => assertGroundedEvidence({ evidenceRefs: [42] }, []), AIError);
  assert.throws(
    () => assertGroundedEvidence({ evidenceRefs: [{ id: "allowed", evidenceId: "unknown" }] }, ["allowed"]),
    AIError,
  );
  assert.throws(
    () => assertGroundedEvidence({ evidenceRefs: [{ id: "allowed", nested: { evidenceId: "bad" } }] }, ["allowed"]),
    AIError,
  );
  assertGroundedEvidence({ evidenceIds: [], evidenceRefs: [] }, []);
  assertGroundedEvidence({ evidenceRefs: [{ id: "a" }, "b", { evidenceId: "c" }] }, ["a", "b", "c"]);
});

test("storeDocument validates text and metadata before any DB or paid call", async () => {
  const session = fakeSession();
  let embedCalls = 0;
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async () => {
      embedCalls += 1;
      return embeddedResult("retrieval.passage");
    },
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  });
  const base = { entityType: "decision", entityId: ENTITY_ID };
  await assert.rejects(() => store.storeDocument({ ...base, sourceText: "   " }), AIError);
  await assert.rejects(() => store.storeDocument({ ...base, sourceText: "x".repeat(32769) }), AIError);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(
    () => store.storeDocument({ ...base, sourceText: "x", metadata: { loop: circular } }),
    AIError,
  );
  await assert.rejects(
    () => store.storeDocument({ ...base, sourceText: "x", metadata: { nested: { apiKey: "k" } } }),
    AIError,
  );
  await assert.rejects(
    () => store.storeDocument({ ...base, sourceText: "x", metadata: { fn: () => 1 } }),
    AIError,
  );
  assert.equal(embedCalls, 0);
  assert.equal(session.calls.length, 0);
});

test("storeDocument rejects mismatched provider source text or hash", async () => {
  const session = fakeSession((text) => {
    if (text.includes("FROM public.decisions")) return [{ id: ENTITY_ID }];
    return [];
  });
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async () => embeddedResult("retrieval.passage", "different text"),
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  });
  await assert.rejects(
    () => store.storeDocument({ entityType: "decision", entityId: ENTITY_ID, sourceText: "x" }),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
  const badHash = fakeSession((text) => {
    if (text.includes("FROM public.decisions")) return [{ id: ENTITY_ID }];
    return [];
  });
  const store2 = createMemoryStore(createRepositories(badHash, auth), {
    embedDocument: async (text) => ({ ...embeddedResult("retrieval.passage", text), sourceHash: "f".repeat(64) }),
    embedQuery: async () => embeddedResult("retrieval.query"),
    embedMany: async () => [],
  });
  await assert.rejects(
    () => store2.storeDocument({ entityType: "decision", entityId: ENTITY_ID, sourceText: "x" }),
    (e) => e instanceof AIError && e.code === "PROVIDER",
  );
});

test("search rejects oversized or blank queries before paid call", async () => {
  const session = fakeSession();
  let embedCalls = 0;
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async () => embeddedResult("retrieval.passage"),
    embedQuery: async () => {
      embedCalls += 1;
      return embeddedResult("retrieval.query");
    },
    embedMany: async () => [],
  });
  await assert.rejects(() => store.search("x".repeat(32769)), (e) => e instanceof AIError && e.code === "SCHEMA");
  assert.equal(embedCalls, 0);
});

test("search embeds the query then searches by vector", async () => {
  const rows = [{ id: "hit" }];
  const session = fakeSession((text) => {
    if (text.includes("ORDER BY embedding")) return rows;
    return [];
  });
  let queryText = "";
  const store = createMemoryStore(createRepositories(session, auth), {
    embedDocument: async () => embeddedResult("retrieval.passage"),
    embedQuery: async (text) => {
      queryText = text;
      return embeddedResult("retrieval.query", text);
    },
    embedMany: async () => [],
  });
  const result = await store.search("what went wrong", 5);
  assert.equal(result, rows);
  assert.equal(queryText, "what went wrong");
  const searchCall = session.calls[0];
  assert.equal((searchCall.values as unknown[])[4], 5);
  await assert.rejects(() => store.search("  "), (e) => e instanceof AIError && e.code === "SCHEMA");
});

test.after(() => {
  if (savedEnv.model === undefined) delete process.env.JINA_EMBEDDING_MODEL;
  else process.env.JINA_EMBEDDING_MODEL = savedEnv.model;
  if (savedEnv.dims === undefined) delete process.env.JINA_EMBEDDING_DIMENSIONS;
  else process.env.JINA_EMBEDDING_DIMENSIONS = savedEnv.dims;
});
