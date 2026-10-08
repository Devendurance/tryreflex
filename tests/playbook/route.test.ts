import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { EmbeddingProvider } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { computeSourceHash } from "../../src/server/db/validation";
import { PLAYBOOK_QUERIES } from "../../src/server/playbook-queries";
import { PLAYBOOK_TEMPLATES, buildRationale, ruleEquivalentKey, type PlaybookRuleProvenance } from "../../src/server/playbook-policy";
import { createPlaybookDecisionHandler, createPlaybookHandler, createProposePlaybookHandler } from "../../src/server/playbook/http";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };
const RULE_ID = "88888888-8888-4888-8888-000000000001";
const MARKER_ID = "99999999-9999-4999-8999-000000000001";
const E1 = "55555555-5555-4555-8555-000000000001";
const P1 = "77777777-7777-4777-8777-000000000001";

type Row = Record<string, unknown>;
type EnvSnapshot = Record<string, string | undefined>;

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prior: EnvSnapshot = {
    JINA_EMBEDDING_MODEL: process.env.JINA_EMBEDDING_MODEL,
    JINA_EMBEDDING_DIMENSIONS: process.env.JINA_EMBEDDING_DIMENSIONS,
    JINA_API_KEY: process.env.JINA_API_KEY,
  };
  process.env.JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
  process.env.JINA_EMBEDDING_DIMENSIONS = "1024";
  delete process.env.JINA_API_KEY;
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const provenance: PlaybookRuleProvenance = {
  producer: "playbook.v1",
  templateId: "target_revision",
  equivalentKey: ruleEquivalentKey("target_revision", "f".repeat(64)),
  patternFingerprint: "f".repeat(64),
  sourcePatternId: P1,
  maturity: "experimental",
  sourceStatus: "observation",
  supportingDecisionCount: 1,
  highQualityCount: 0,
  establishedEligible: false,
  supportingDecisionIds: [P1],
  supportingReviewIds: [P1],
  evidenceRefs: [E1],
  observedBehavior: "Target drift observed once.",
  supportingFacts: [{ decisionId: P1, reviewId: P1, basis: "retrospective_user_report", observedFacts: [{ evidenceId: E1, quote: "moved to $2M" }] }],
  relevantMetrics: { decisionCount: 1, finalCount: 1, provisionalCount: 0, qualityUnassessedCount: 0 },
  evidenceStrength: "limited",
  scope: "single-decision observation, not recurrence",
  effectiveness: "unproven",
  financialBenefit: "unknown",
  confidence: null,
};

function proposedRule(): Row {
  return {
    id: RULE_ID,
    user_id: USER_ID,
    version: 1,
    previous_rule_id: null,
    source_pattern_id: P1,
    status: "proposed",
    title: PLAYBOOK_TEMPLATES[0].title,
    trigger: PLAYBOOK_TEMPLATES[0].trigger,
    rule_text: PLAYBOOK_TEMPLATES[0].ruleText,
    rationale: buildRationale(provenance.observedBehavior, provenance.scope),
    user_decision: null,
    decided_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

function fakeDb(options: { rules?: Row[] } = {}) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const rules: Row[] = [...(options.rules ?? [])];
  const links = new Map<string, Set<string>>();
  const embeddings = new Map<string, Row>();
  if (rules.length) {
    links.set(RULE_ID, new Set([MARKER_ID, E1]));
  }
  let seq = rules.length;
  const markers: Row[] = [{ id: MARKER_ID, user_id: USER_ID, kind: "playbook_rule", rule_id: RULE_ID, label: JSON.stringify(provenance) }];

  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    calls.push({ text, values });
    if (text === PLAYBOOK_QUERIES.lockOwner) return { rows: [{ id: USER_ID }] };
    if (text === PLAYBOOK_QUERIES.list) return { rows: [...rules].sort((a, b) => Number(a.version) - Number(b.version)) };
    if (text === PLAYBOOK_QUERIES.get) return { rows: rules.filter((row) => row.id === values[1] && row.user_id === USER_ID) };
    if (text === PLAYBOOK_QUERIES.patterns) return { rows: [] };
    if (text === PLAYBOOK_QUERIES.ruleEvidence) {
      const rows: Row[] = [];
      for (const ruleId of values[1] as string[]) {
        for (const evidenceId of links.get(ruleId) ?? new Set<string>()) {
          const marker = markers.find((row) => row.id === evidenceId);
          if (marker) rows.push({ ...marker });
          else rows.push({ id: evidenceId, user_id: USER_ID, kind: "user_input", rule_id: null });
        }
      }
      return { rows };
    }
    if (text === PLAYBOOK_QUERIES.patternEvidence) return { rows: [] };
    if (text === PLAYBOOK_QUERIES.insert) {
      seq += 1;
      const version = Math.max(0, ...rules.map((row) => Number(row.version))) + 1;
      const row: Row = {
        id: `88888888-8888-4888-8888-${String(seq + 100).padStart(12, "0")}`,
        user_id: USER_ID,
        version,
        previous_rule_id: values[1],
        source_pattern_id: values[2],
        status: values[3],
        title: values[4],
        trigger: values[5],
        rule_text: values[6],
        rationale: values[7],
        user_decision: values[8],
        decided_at: values[8] === null ? null : "2026-11-01T00:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
      };
      rules.push(row);
      return { rows: [row] };
    }
    if (text === PLAYBOOK_QUERIES.provenance) {
      const marker: Row = { id: `99999999-9999-4999-8999-${String(seq + 100).padStart(12, "0")}`, user_id: USER_ID, kind: "playbook_rule", rule_id: values[1], label: values[2] };
      markers.push(marker);
      return { rows: [marker] };
    }
    if (text === PLAYBOOK_QUERIES.linkEvidence) {
      const set = links.get(String(values[1])) ?? new Set<string>();
      for (const id of values[2] as string[]) set.add(id);
      links.set(String(values[1]), set);
      return { rows: [] };
    }
    if (text === `SELECT * FROM public.playbook_rules WHERE user_id=$1 AND id=$2 LIMIT 1`) {
      return { rows: rules.filter((row) => row.id === values[1] && row.user_id === USER_ID) };
    }
    if (text.includes("FROM public.memory_embeddings") && text.startsWith("SELECT")) {
      const existing = embeddings.get(`${values[2]}:${values[5]}`);
      return { rows: existing ? [existing] : [] };
    }
    if (text.startsWith("INSERT INTO public.memory_embeddings")) {
      const row: Row = { id: "mem-1", user_id: values[0], entity_id: values[2], rule_id: values[6], source_hash: values[11] };
      embeddings.set(`${values[2]}:${values[11]}`, row);
      return { rows: [row] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  }

  const asQueryable = <T>(text: string, values?: readonly unknown[]) => dispatch(text, values) as Promise<{ rows: T[] }>;
  const queryable: Queryable = { query: asQueryable };
  const db: DbSession = { query: asQueryable, transaction: (fn) => fn(queryable) };
  return { db, calls, rules, links, embeddings };
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
    embedQuery: async (text: string) => single(text),
    embedMany: async (texts: readonly string[]) => Promise.all(texts.map(single)),
  };
}

const request = (body: unknown) =>
  new Request("http://localhost/api/playbook", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    body: JSON.stringify(body),
  });

test("GET /api/playbook returns the deterministic read model", async () => {
  const { db } = fakeDb({ rules: [proposedRule()] });
  const handler = createPlaybookHandler({ db, authProvider: { getContext: async () => auth } });
  const response = await handler();
  assert.equal(response.status, 200);
  const body = (await response.json()) as { policyVersion: string; generationMode: string; pendingProposals: { id: string }[] };
  assert.equal(body.policyVersion, "playbook.v1");
  assert.equal(body.generationMode, "deterministic");
  assert.equal(body.pendingProposals.length, 1);
});

test("GET /api/playbook requires authentication", async () => {
  const { db } = fakeDb();
  const handler = createPlaybookHandler({ db, authProvider: { getContext: async () => null } });
  const response = await handler();
  assert.equal(response.status, 401);
});

test("POST /api/playbook/propose enforces a strict empty body", async () => {
  const { db } = fakeDb();
  const handler = createProposePlaybookHandler({ db, authProvider: { getContext: async () => auth } });
  const bad = await handler(request({ extra: true }));
  assert.equal(bad.status, 400);
  const good = await handler(request({}));
  assert.equal(good.status, 200);
  const body = (await good.json()) as { policyVersion: string; proposals: unknown[]; createdCount: number; unsupportedEvidenceCount: number };
  assert.equal(body.policyVersion, "playbook.v1");
  assert.deepEqual(body.proposals, []);
  assert.equal(body.createdCount, 0);
});

test("POST /api/playbook/[id]/decision validates the action enum", async () => {
  const { db } = fakeDb({ rules: [proposedRule()] });
  const handler = createPlaybookDecisionHandler({ db, authProvider: { getContext: async () => auth } });
  const bad = await handler(request({ action: "maybe" }), { id: RULE_ID });
  assert.equal(bad.status, 400);
});

test("POST decision accept indexes memory once and returns the active view", async () => {
  await withEnv(async () => {
    const { db, embeddings } = fakeDb({ rules: [proposedRule()] });
    const counter = { calls: 0 };
    const handler = createPlaybookDecisionHandler({ db, authProvider: { getContext: async () => auth }, embedder: fakeEmbedder(counter) });
    const response = await handler(request({ action: "accept" }), { id: RULE_ID });
    assert.equal(response.status, 200);
    const view = (await response.json()) as { status: string; userDecision: string; provenance: { templateId: string; effectiveness: string } };
    assert.equal(view.status, "active");
    assert.equal(view.userDecision, "accepted");
    assert.equal(view.provenance.templateId, "target_revision");
    assert.equal(view.provenance.effectiveness, "unproven");
    assert.equal(counter.calls, 1);
    assert.equal(embeddings.size, 1);
  });
});

test("POST decision reject does not construct or call an embedding provider", async () => {
  await withEnv(async () => {
    const { db } = fakeDb({ rules: [proposedRule()] });
    const handler = createPlaybookDecisionHandler({ db, authProvider: { getContext: async () => auth } });
    const response = await handler(request({ action: "reject" }), { id: RULE_ID });
    assert.equal(response.status, 200);
    const view = (await response.json()) as { status: string };
    assert.equal(view.status, "rejected");
  });
});

test("POST decision returns 404 for an unknown rule", async () => {
  const { db } = fakeDb();
  const handler = createPlaybookDecisionHandler({ db, authProvider: { getContext: async () => auth } });
  const response = await handler(request({ action: "accept" }), { id: "88888888-8888-4888-8888-999999999999" });
  assert.equal(response.status, 404);
});
