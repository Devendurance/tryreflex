import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { EmbeddingProvider } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { computeSourceHash } from "../../src/server/db/validation";
import { RepositoryError } from "../../src/server/db/repositories";
import { AIError } from "../../src/server/ai/errors";
import { DNA_QUERIES } from "../../src/server/decision-dna-queries";
import { createPatternsRepository } from "../../src/server/patterns/repository";
import { createDNAHandler, createRecomputePatternsHandler } from "../../src/server/patterns/http";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };

type Row = Record<string, unknown>;
type EnvSnapshot = Record<string, string | undefined>;

function withEmbeddingEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prior: EnvSnapshot = {
    JINA_EMBEDDING_MODEL: process.env.JINA_EMBEDDING_MODEL,
    JINA_EMBEDDING_DIMENSIONS: process.env.JINA_EMBEDDING_DIMENSIONS,
  };
  process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
  process.env.JINA_EMBEDDING_DIMENSIONS = "1024";
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fakeEmbedder(counter: { calls: number }): EmbeddingProvider {
  const single = async (text: string) => ({
    vector: new Array(1024).fill(0.01),
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText: text,
    sourceHash: computeSourceHash(text),
    metadata: {},
  });
  return {
    embedDocument: async (text: string) => { counter.calls += 1; return single(text); },
    embedQuery: async (text: string) => { counter.calls += 1; return single(text); },
    embedMany: async (texts: readonly string[]) => {
      counter.calls += texts.length;
      return Promise.all(texts.map(single));
    },
  };
}

const QUOTE = "bought because it was trending, original target was $1M then moved to $2M and did not sell";
const E1 = "10000000-0000-4000-8000-000000000001";
const MARKER = "10000000-0000-4000-8000-000000000002";

function reviewRow(): Row {
  return {
    id: "r1",
    user_id: USER_ID,
    decision_id: "d1",
    trade_id: "t1",
    is_current: true,
    created_at: "2026-10-01T00:00:00.000Z",
    asset_class: "crypto",
    asset_symbol: "RUNNER",
    raw_input: QUOTE,
    confirmed_snapshot: {},
    structured_inference: {},
    opened_at: null,
    closed_at: "2026-10-02T00:00:00.000Z",
    ai_inference: {
      evidenceCatalog: [
        {
          id: E1,
          text: QUOTE,
          kind: "user_input",
          sourceEntityId: "d1",
          knowledgeBasis: "original",
          timing: "decision_time",
          normalizedFact: "user entered because the asset was trending",
        },
      ],
      dimensions: [
        { dimension: "research_quality", observedFacts: [{ evidenceId: E1, quote: "bought because it was trending" }] },
        { dimension: "risk_discipline", observedFacts: [{ evidenceId: E1, quote: "original target was $1M" }] },
        { dimension: "execution_quality", observedFacts: [{ evidenceId: E1, quote: "moved to $2M" }] },
        { dimension: "behavioral_control", observedFacts: [{ evidenceId: E1, quote: "did not sell" }] },
      ],
    },
    observed_metrics: {
      tradeMetrics: { outcome: "unknown" },
      planDrift: [
        {
          type: "target_drift",
          status: "observed",
          evidenceBasis: "retrospective_user_report",
          evidenceRefs: [E1],
          ordering: { evidenceId: E1, quote: "then moved to $2M and did not sell", basis: "explicit_user_statement" },
          observedFacts: [
            { evidenceId: E1, quote: "original target was $1M" },
            { evidenceId: E1, quote: "moved to $2M" },
          ],
        },
      ],
    },
  };
}

function dimensionRows(): Row[] {
  return [
    { id: "dim-rq", review_id: "r1", dimension: "research_quality", score: "15", confidence: "0.9" },
    { id: "dim-ca", review_id: "r1", dimension: "context_awareness", score: null, confidence: null },
    { id: "dim-rd", review_id: "r1", dimension: "risk_discipline", score: "55", confidence: "0.9" },
    { id: "dim-eq", review_id: "r1", dimension: "execution_quality", score: "45", confidence: "0.9" },
    { id: "dim-bc", review_id: "r1", dimension: "behavioral_control", score: "40", confidence: "0.9" },
  ];
}

interface FakeOptions {
  reviews?: Row[];
  markerPreexisting?: boolean;
  retired?: Row[];
  reviewPatch?: Row;
  dimensions?: Row[];
  extraEvidence?: Row[];
  extraLinks?: Row[];
  evidenceHasMarker?: boolean;
}

function fakeDb(options: FakeOptions = {}) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const reviews =
    options.reviews === undefined ? [{ ...reviewRow(), ...(options.reviewPatch ?? {}) }] : options.reviews;
  const markerRow: Row = { id: MARKER, user_id: USER_ID, kind: "prior_review", review_id: "r1", label: "Decision DNA supporting review" };
  const evidenceRows: Row[] = [
    { id: E1, user_id: USER_ID, kind: "user_input", decision_id: "d1", label: QUOTE },
    ...(options.evidenceHasMarker === false ? [] : [markerRow]),
    ...(options.extraEvidence ?? []),
  ];
  const storedPatterns = new Map<string, Row>();
  const storedEmbeddings = new Map<string, Row>();
  const retired = options.retired ?? [];

  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    calls.push({ text, values });
    if (text === DNA_QUERIES.lock) return { rows: [] };
    if (text === DNA_QUERIES.eligibleReviews) return { rows: reviews };
    if (text === DNA_QUERIES.dimensions) return { rows: options.dimensions ?? dimensionRows() };
    if (text === DNA_QUERIES.dimensionLinks) {
      return {
        rows: [
          ...["dim-rq", "dim-rd", "dim-eq", "dim-bc"].map((dimension_id) => ({ dimension_id, evidence_id: E1 })),
          ...(options.extraLinks ?? []),
        ],
      };
    }
    if (text === DNA_QUERIES.origins) return { rows: [{ label: "pure_impulse", basis: "inference", confidence: "0.9" }] };
    if (text === DNA_QUERIES.sources) return { rows: [] };
    if (text === DNA_QUERIES.contexts) return { rows: [] };
    if (text === DNA_QUERIES.evidence) return { rows: evidenceRows };
    if (text === DNA_QUERIES.reviewEvidence) {
      return { rows: options.markerPreexisting === false ? [] : [markerRow] };
    }
    if (text === DNA_QUERIES.createReviewEvidence) return { rows: [markerRow] };
    if (text === DNA_QUERIES.upsertPattern) {
      const stats = values[4] as Row;
      const fingerprint = String(stats.fingerprint);
      const existing = storedPatterns.get(fingerprint);
      const row = existing ?? { id: `00000000-0000-4000-8000-${String(storedPatterns.size + 1).padStart(12, "0")}`, user_id: USER_ID, kind: values[1], status: values[2], description: values[3], observed_statistics: stats, evidence_count: values[6] };
      storedPatterns.set(fingerprint, row);
      return { rows: [row] };
    }
    if (text === DNA_QUERIES.ownedEvidence) return { rows: (values[1] as string[]).map((id) => ({ id })) };
    if (text === DNA_QUERIES.linkEvidence) return { rows: [] };
    if (text === DNA_QUERIES.retirePatterns) return { rows: retired };
    if (text === DNA_QUERIES.listPatterns) return { rows: [...storedPatterns.values(), ...retired] };
    if (text === DNA_QUERIES.activePatterns) {
      return { rows: [...storedPatterns.values()].filter((row) => (row.observed_statistics as Row).active === true) };
    }
    if (text === DNA_QUERIES.currentEvidence) {
      const rows: Row[] = [];
      for (const pattern of storedPatterns.values()) {
        const refs = ((pattern.observed_statistics as Row).evidenceRefs as string[]) ?? [];
        for (const ref of refs) {
          const evidence = [...evidenceRows, markerRow].find((entry) => entry.id === ref);
          if (evidence) rows.push({ pattern_id: pattern.id, ...evidence });
        }
      }
      return { rows };
    }
    if (text.includes("FROM public.memory_embeddings") && text.startsWith("SELECT")) {
      const key = `${values[2]}:${values[5]}`;
      const existing = storedEmbeddings.get(key);
      return { rows: existing ? [existing] : [] };
    }
    if (text.startsWith("INSERT INTO public.memory_embeddings")) {
      const row: Row = {
        id: `mem-${storedEmbeddings.size + 1}`,
        user_id: values[0],
        entity_type: values[1],
        entity_id: values[2],
        embedding: values[7],
        model: values[8],
        dimensions: values[9],
        source_text: values[10],
        source_hash: values[11],
        metadata: values[12],
      };
      storedEmbeddings.set(`${values[2]}:${values[11]}`, row);
      return { rows: [row] };
    }
    if (text.startsWith("SELECT * FROM public.patterns WHERE user_id=$1 AND id=$2")) {
      const row = [...storedPatterns.values()].find((entry) => entry.id === values[1]);
      return { rows: row ? [row] : [] };
    }
    throw new Error(`unexpected query in fake db: ${text.slice(0, 120)}`);
  }

  const asQueryable = <T>(text: string, values?: readonly unknown[]) => dispatch(text, values) as Promise<{ rows: T[] }>;
  const queryable: Queryable = { query: asQueryable };
  const db: DbSession = {
    query: asQueryable,
    transaction: (fn) => fn(queryable),
  };
  return { db, calls, storedPatterns, storedEmbeddings };
}

test("recompute runs inside an advisory-locked transaction and persists deterministic candidates", async () => {
  await withEmbeddingEnv(async () => {
    const { db, calls, storedEmbeddings } = fakeDb();
    const repo = createPatternsRepository(db, auth);
    const counter = { calls: 0 };
    const result = await repo.recomputeDNA(fakeEmbedder(counter));

    assert.equal(result.eventsLoaded, 1);
    assert.equal(result.candidates.length, 3);
    assert.ok(result.candidates.every((candidate) => candidate.status === "observation"));
    assert.equal(storedEmbeddings.size, 3);
    assert.equal(counter.calls, 3);

    const lock = calls.find((call) => call.text === DNA_QUERIES.lock);
    assert.deepEqual(lock?.values, [`decision-dna:${USER_ID}`]);
    const eligible = calls.find((call) => call.text === DNA_QUERIES.eligibleReviews);
    assert.deepEqual(eligible?.values, [USER_ID]);
    const upserts = calls.filter((call) => call.text === DNA_QUERIES.upsertPattern);
    assert.equal(upserts.length, 3);
    for (const upsert of upserts) {
      assert.equal(upsert.values[0], USER_ID);
      const stats = upsert.values[4] as Row;
      assert.equal(stats.producer, "decision-dna.v1");
      assert.equal(typeof stats.memorySourceHash, "string");
      assert.equal((upsert.values[5] as Row).narrativeBasis, "deterministic_server_policy");
    }
    const owned = calls.filter((call) => call.text === DNA_QUERIES.ownedEvidence);
    assert.equal(owned.length, 3);
    assert.ok(owned.every((call) => call.values[0] === USER_ID));
    assert.ok(calls.some((call) => call.text === DNA_QUERIES.linkEvidence));
    assert.ok(calls.some((call) => call.text === DNA_QUERIES.retirePatterns));
  });
});

test("repeated recompute dedupes embedding calls by source hash", async () => {
  await withEmbeddingEnv(async () => {
    const { db } = fakeDb();
    const repo = createPatternsRepository(db, auth);
    const counter = { calls: 0 };
    await repo.recomputeDNA(fakeEmbedder(counter));
    assert.equal(counter.calls, 3);
    await repo.recomputeDNA(fakeEmbedder(counter));
    assert.equal(counter.calls, 3);
  });
});

test("recompute creates the prior_review marker when absent and retires stale patterns", async () => {
  await withEmbeddingEnv(async () => {
    const { db, calls } = fakeDb({ markerPreexisting: false, retired: [{ id: "old-pattern" }] });
    const repo = createPatternsRepository(db, auth);
    const result = await repo.recomputeDNA(fakeEmbedder({ calls: 0 }));
    assert.ok(calls.some((call) => call.text === DNA_QUERIES.createReviewEvidence));
    assert.deepEqual(result.retiredIds, ["old-pattern"]);
  });
});

test("recompute retires even when no current history produces candidates", async () => {
  await withEmbeddingEnv(async () => {
    const { db, calls } = fakeDb({ reviews: [], retired: [{ id: "old-pattern" }] });
    const repo = createPatternsRepository(db, auth);
    const result = await repo.recomputeDNA(fakeEmbedder({ calls: 0 }));
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.retiredIds, ["old-pattern"]);
    const retire = calls.find((call) => call.text === DNA_QUERIES.retirePatterns);
    assert.deepEqual(retire?.values, [USER_ID, []]);
  });
});

test("eligible history above the bound throws instead of silently truncating", async () => {
  const { db } = fakeDb({ reviews: Array.from({ length: 501 }, (_, i) => ({ ...reviewRow(), id: `r${i}` })) });
  const repo = createPatternsRepository(db, auth);
  await assert.rejects(() => repo.recomputeDNA(fakeEmbedder({ calls: 0 })), RepositoryError);
});

test("getDNA never inserts markers or calls providers and returns owner-scoped model", async () => {
  await withEmbeddingEnv(async () => {
    const { db, calls } = fakeDb();
    const repo = createPatternsRepository(db, auth);
    await repo.recomputeDNA(fakeEmbedder({ calls: 0 }));
    const before = calls.length;
    const view = await repo.getDNA();
    const after = calls.slice(before);
    assert.equal(after.every((call) => call.text.startsWith("SELECT")), true);
    assert.equal(view.summary.status, "sparse");
    assert.equal(view.summary.independentDecisionCount, 1);
    assert.equal(view.summary.recomputationRequired, false);
    assert.equal(view.evidenceStats.aggregationStatus, "snapshot_from_last_recompute");
    assert.equal(view.observations.length, 3);
    assert.equal(view.edges.length + view.leaks.length + view.influences.length + view.executionPatterns.length + view.regimes.length, 0);
    const observation = view.observations[0];
    assert.equal(observation.confidence, null);
    assert.ok(Array.isArray(observation.evidence));
    assert.ok(observation.evidence.every((entry: Row) => typeof entry.id === "string"));
  });
});

test("getDNA fails closed when persisted stats reference evidence that is no longer linked", async () => {
  await withEmbeddingEnv(async () => {
    const { db, storedPatterns } = fakeDb();
    const repo = createPatternsRepository(db, auth);
    await repo.recomputeDNA(fakeEmbedder({ calls: 0 }));
    for (const pattern of storedPatterns.values()) {
      (pattern.observed_statistics as Row).evidenceRefs = ["missing-evidence"];
    }
    await assert.rejects(() => repo.getDNA(), RepositoryError);
  });
});

test("getDNA on empty history reports empty summary without fabricating counts", async () => {
  const { db } = fakeDb({ reviews: [] });
  const repo = createPatternsRepository(db, auth);
  const view = await repo.getDNA();
  assert.equal(view.summary.status, "empty");
  assert.equal(view.summary.independentDecisionCount, 0);
  assert.equal(view.evidenceStats.eligibleReviewCount, 0);
});

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3002/api/patterns/recompute", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("recompute route rejects anonymous, foreign-subject, and cross-origin requests", async () => {
  const anonymous = { getContext: async () => null };
  const unauthenticated = createRecomputePatternsHandler({ authProvider: anonymous, db: fakeDb().db, embedder: fakeEmbedder({ calls: 0 }) });
  const denied = await unauthenticated(postRequest({}));
  assert.equal(denied.status, 401);

  const crossOrigin = createRecomputePatternsHandler({ authProvider: { getContext: async () => auth }, db: fakeDb().db, embedder: fakeEmbedder({ calls: 0 }) });
  const forbidden = await crossOrigin(postRequest({}, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }));
  assert.equal(forbidden.status, 403);

  const clientUserId = await crossOrigin(postRequest({ userId: "someone-else" }));
  assert.equal(clientUserId.status, 400);
});

test("dna route rejects anonymous and serves the read model without providers", async () => {
  const anonymousGet = createDNAHandler({ authProvider: { getContext: async () => null }, db: fakeDb().db });
  const denied = await anonymousGet();
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "no-store");

  await withEmbeddingEnv(async () => {
    const { db } = fakeDb({ reviews: [] });
    const ok = createDNAHandler({ authProvider: { getContext: async () => auth }, db });
    const response = await ok();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.status, "empty");
    assert.deepEqual(body.observations, []);
  });
});

test("malformed persisted catalog, drift entry, or numeric fails closed", async () => {
  const badCatalog = fakeDb({
    reviewPatch: { ai_inference: { evidenceCatalog: [{ id: "not-a-uuid", text: "x" }] } },
  });
  await assert.rejects(
    () => createPatternsRepository(badCatalog.db, auth).recomputeDNA(fakeEmbedder({ calls: 0 })),
    RepositoryError,
  );

  const badDrift = fakeDb({ reviewPatch: { observed_metrics: { planDrift: [{ type: "target_drift" }] } } });
  await assert.rejects(
    () => createPatternsRepository(badDrift.db, auth).recomputeDNA(fakeEmbedder({ calls: 0 })),
    RepositoryError,
  );

  const badScore = fakeDb({
    dimensions: dimensionRows().map((row) => (row.dimension === "risk_discipline" ? { ...row, score: "abc" } : row)),
  });
  await assert.rejects(
    () => createPatternsRepository(badScore.db, auth).recomputeDNA(fakeEmbedder({ calls: 0 })),
    RepositoryError,
  );
});

test("Jina embedding failure propagates as AIError instead of a persistence wrap", async () => {
  const failing: EmbeddingProvider = {
    embedDocument: async () => {
      throw new AIError("PROVIDER");
    },
    embedQuery: async () => {
      throw new AIError("PROVIDER");
    },
    embedMany: async () => {
      throw new AIError("PROVIDER");
    },
  };
  await withEmbeddingEnv(async () => {
    const { db } = fakeDb();
    const repo = createPatternsRepository(db, auth);
    await assert.rejects(
      () => repo.recomputeDNA(failing),
      (error: unknown) => error instanceof AIError && (error as AIError).code === "PROVIDER",
    );
  });
});

test("evidence rows owned by a different user fail closed even when linked", async () => {
  const foreignEvidence = "10000000-0000-4000-8000-0000000000ff";
  const { db } = fakeDb({
    extraEvidence: [{ id: foreignEvidence, user_id: "22222222-2222-4222-8222-222222222222", kind: "user_input", decision_id: "d1", label: "foreign row" }],
    extraLinks: [{ dimension_id: "dim-rq", evidence_id: foreignEvidence }],
  });
  const repo = createPatternsRepository(db, auth);
  await assert.rejects(() => repo.recomputeDNA(fakeEmbedder({ calls: 0 })), RepositoryError);
});

test("existing prior_review marker joins the evidence list without duplication", async () => {
  await withEmbeddingEnv(async () => {
    const { db } = fakeDb({ evidenceHasMarker: false });
    const repo = createPatternsRepository(db, auth);
    const result = await repo.recomputeDNA(fakeEmbedder({ calls: 0 }));
    assert.ok(result.candidates.length > 0);
    for (const candidate of result.candidates) {
      assert.ok(candidate.evidenceRefs.includes(MARKER));
    }
  });
});

test("getDNA with nonzero history and no computed stats reports not_computed and requires recomputation", async () => {
  const { db } = fakeDb({ reviewPatch: { asset_class: null } });
  const repo = createPatternsRepository(db, auth);
  const view = await repo.getDNA();
  assert.equal(view.summary.status, "sparse");
  assert.equal(view.summary.independentDecisionCount, 1);
  assert.equal(view.summary.recomputationRequired, true);
  assert.equal(view.evidenceStats.aggregationStatus, "not_computed");
  assert.equal(view.evidenceStats.averageDecisionQuality, null);
  assert.equal(view.evidenceStats.knownOutcomes, null);
  assert.equal(view.evidenceStats.dimensions, null);
});
