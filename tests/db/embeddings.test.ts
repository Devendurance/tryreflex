import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
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

function unitEmbedding(): number[] {
  const v = new Array(1024).fill(0);
  v[0] = 0.5;
  return v;
}

function baseInput() {
  return {
    entityType: "decision" as const,
    entityId: ENTITY_ID,
    embedding: unitEmbedding(),
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText: "thesis text",
  };
}

test("storeValidatedEmbedding inserts serialized vector, derived FK, computed hash", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.memoryEmbeddings.storeValidatedEmbedding(baseInput());
  const call = session.calls[0];
  assert.match(call.text, /INSERT INTO public\.memory_embeddings/);
  assert.match(call.text, /ON CONFLICT \(user_id,entity_type,entity_id,model,dimensions,source_hash\) DO NOTHING/);
  const values = call.values as unknown[];
  assert.equal(values[0], USER_ID);
  assert.equal(values[3], ENTITY_ID);
  assert.equal(values[4], null);
  assert.match(values[7] as string, /^\[0\.5(,0){1023}\]$/);
  assert.equal(values[8], "jina-embeddings-v5-text-small");
  assert.equal(values[9], 1024);
  assert.equal(values[11], computeSourceHash("thesis text"));
});

test("matching FK omitted derives from entityId", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), entityType: "rule", ruleId: undefined });
  const values = session.calls[0].values as unknown[];
  assert.equal(values[6], ENTITY_ID);
  assert.equal(values[3], null);
  assert.equal(values[4], null);
  assert.equal(values[5], null);
});

test("storeValidatedEmbedding returns existing row on dedupe conflict", async () => {
  const existing = { id: "existing", marker: true };
  let phase = 0;
  const session = fakeSession(() => {
    phase += 1;
    return phase === 1 ? [] : [existing];
  });
  const repos = createRepositories(session, auth);
  const row = await repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), entityType: "review", reviewId: ENTITY_ID });
  assert.equal(row, existing);
  assert.match(session.calls[1].text, /SELECT \* FROM public\.memory_embeddings WHERE user_id=\$1 AND entity_type=\$2 AND entity_id=\$3/);
});

test("wrong model or dimensions rejected at schema before any query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(() =>
    repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), model: "other-model" }),
  );
  await assert.rejects(() =>
    repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), dimensions: 768 }),
  );
  assert.equal(session.calls.length, 0);
});

test("mismatched configured profile rejected before query", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  const saved = process.env.JINA_EMBEDDING_DIMENSIONS;
  process.env.JINA_EMBEDDING_DIMENSIONS = "768";
  try {
    await assert.rejects(() => repos.memoryEmbeddings.storeValidatedEmbedding(baseInput()));
  } finally {
    process.env.JINA_EMBEDDING_DIMENSIONS = saved;
  }
  assert.equal(session.calls.length, 0);
});

test("storeValidatedEmbedding rejects entity/FK mismatch and wrong FK set", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () =>
      repos.memoryEmbeddings.storeValidatedEmbedding({
        ...baseInput(),
        decisionId: "99999999-9999-4999-8999-999999999999",
      }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      repos.memoryEmbeddings.storeValidatedEmbedding({
        ...baseInput(),
        decisionId: ENTITY_ID,
        patternId: ENTITY_ID,
      }),
    (e) => e instanceof RepositoryError && e.code === "INVALID_INPUT",
  );
  assert.equal(session.calls.length, 0);
});

test("storeValidatedEmbedding rejects invalid embedding shape", async () => {
  const session = fakeSession();
  const repos = createRepositories(session, auth);
  await assert.rejects(
    () => repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), embedding: new Array(5).fill(1) }),
    /1024/,
  );
  await assert.rejects(
    () =>
      repos.memoryEmbeddings.storeValidatedEmbedding({ ...baseInput(), embedding: new Array(1024).fill(0) }),
    /norm/,
  );
  assert.equal(session.calls.length, 0);
});

test.after(() => {
  if (savedEnv.model === undefined) delete process.env.JINA_EMBEDDING_MODEL;
  else process.env.JINA_EMBEDDING_MODEL = savedEnv.model;
  if (savedEnv.dims === undefined) delete process.env.JINA_EMBEDDING_DIMENSIONS;
  else process.env.JINA_EMBEDDING_DIMENSIONS = savedEnv.dims;
});
