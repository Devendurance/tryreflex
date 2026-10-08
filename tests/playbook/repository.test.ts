import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { EmbeddingProvider } from "../../src/server/ai/types";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { computeSourceHash } from "../../src/server/db/validation";
import { RepositoryError } from "../../src/server/db/repositories";
import { AIError } from "../../src/server/ai/errors";
import { DNA_QUERIES } from "../../src/server/decision-dna-queries";
import { PLAYBOOK_QUERIES } from "../../src/server/playbook-queries";
import { createPatternsRepository } from "../../src/server/patterns/repository";
import { buildDNAMemory, computeDecisionDNA, type DNAPatternCandidate } from "../../src/server/decision-dna-policy";
import { decodePlaybookMarkerLabel, playbookProvenanceSchema, ruleEquivalentKey, PLAYBOOK_TEMPLATES } from "../../src/server/playbook-policy";
import { createPlaybookRepository, type RuleView } from "../../src/server/playbook/repository";

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

function fakeEmbedder(counter: { calls: number }, failing = false): EmbeddingProvider {
  const single = async (text: string) => ({
    vector: new Array(1024).fill(0.01),
    model: "jina-embeddings-v5-text-small",
    dimensions: 1024,
    sourceText: text,
    sourceHash: computeSourceHash(text),
    metadata: {},
  });
  return {
    embedDocument: async (text: string) => {
      counter.calls += 1;
      if (failing) throw new AIError("PROVIDER");
      return single(text);
    },
    embedQuery: async (text: string) => single(text),
    embedMany: async (texts: readonly string[]) => Promise.all(texts.map(single)),
  };
}

const QUOTE = "bought because it was trending, original target was $1M then moved to $2M and did not sell";
const uuid = (prefix: string, index: number) => `${prefix}-${String(index).padStart(12, "0")}`;
const did = (i: number) => uuid("22222222-2222-4222-8222", i);
const rid = (i: number) => uuid("33333333-3333-4333-8333", i);
const tid = (i: number) => uuid("44444444-4444-4444-8444", i);
const eid = (i: number) => uuid("55555555-5555-4555-8555", i);
const mid = (i: number) => uuid("66666666-6666-4666-8666", i);
const pid = (i: number) => uuid("77777777-7777-4777-8777", i);
const ruleUuid = (i: number) => uuid("88888888-8888-4888-8888", i);
const evUuid = (i: number) => uuid("99999999-9999-4999-8999", i);

function reviewRow(i: number, fullyScoredFacts: boolean): Row {
  return {
    id: rid(i),
    user_id: USER_ID,
    decision_id: did(i),
    trade_id: tid(i),
    is_current: true,
    created_at: `2026-10-0${i}T00:00:00.000Z`,
    asset_class: "crypto",
    asset_symbol: `ASSET${i}`,
    raw_input: QUOTE,
    confirmed_snapshot: {},
    structured_inference: {},
    opened_at: null,
    closed_at: `2026-10-0${i}T12:00:00.000Z`,
    ai_inference: {
      evidenceCatalog: [
        { id: eid(i), text: QUOTE, kind: "user_input", sourceEntityId: did(i), knowledgeBasis: "original", timing: "decision_time", normalizedFact: "user entered because the asset was trending" },
      ],
      dimensions: [
        { dimension: "research_quality", observedFacts: [{ evidenceId: eid(i), quote: "bought because it was trending" }] },
        { dimension: "risk_discipline", observedFacts: [{ evidenceId: eid(i), quote: "original target was $1M" }] },
        { dimension: "execution_quality", observedFacts: [{ evidenceId: eid(i), quote: "moved to $2M" }] },
        { dimension: "behavioral_control", observedFacts: [{ evidenceId: eid(i), quote: "did not sell" }] },
        ...(fullyScoredFacts ? [{ dimension: "context_awareness", observedFacts: [{ evidenceId: eid(i), quote: "original target was $1M" }] }] : []),
      ],
    },
    observed_metrics: {
      tradeMetrics: { outcome: "unknown" },
      planDrift: [
        {
          type: "target_drift",
          status: "observed",
          evidenceBasis: "retrospective_user_report",
          evidenceRefs: [eid(i)],
          ordering: { evidenceId: eid(i), quote: "then moved to $2M and did not sell", basis: "explicit_user_statement" },
          observedFacts: [
            { evidenceId: eid(i), quote: "original target was $1M" },
            { evidenceId: eid(i), quote: "moved to $2M" },
          ],
        },
      ],
    },
  };
}

function dimensionRows(i: number, fullyScored: boolean): Row[] {
  const score = (value: number | null) => (fullyScored ? value ?? 60 : value);
  return [
    { id: `dim-rq-${i}`, review_id: rid(i), dimension: "research_quality", score: String(score(15)), confidence: "0.9" },
    { id: `dim-ca-${i}`, review_id: rid(i), dimension: "context_awareness", score: fullyScored ? "60" : null, confidence: fullyScored ? "0.9" : null },
    { id: `dim-rd-${i}`, review_id: rid(i), dimension: "risk_discipline", score: String(score(55)), confidence: "0.9" },
    { id: `dim-eq-${i}`, review_id: rid(i), dimension: "execution_quality", score: String(score(45)), confidence: "0.9" },
    { id: `dim-bc-${i}`, review_id: rid(i), dimension: "behavioral_control", score: String(score(40)), confidence: "0.9" },
  ];
}

interface FakeOptions {
  reviewCount?: number;
  fullyScored?: boolean;
  patternRows?: Row[] | null;
  patternLinks?: Row[];
  extraPatternLinks?: Row[];
  rules?: Row[];
  evidence?: Map<string, Row>;
}

interface FakeState {
  rules: Row[];
  markers: Row[];
  links: Map<string, Set<string>>;
  embeddings: Map<string, Row>;
  evidence: Map<string, Row>;
  patterns: Row[];
  patternLinks: Row[];
}

function fakeDb(options: FakeOptions = {}) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const reviewCount = options.reviewCount ?? 1;
  const fullyScored = options.fullyScored ?? false;
  const reviews: Row[] = [];
  const dims: Row[] = [];
  const links: Row[] = [];
  const evidence = new Map<string, Row>(options.evidence ?? []);
  for (let i = 1; i <= reviewCount; i += 1) {
    reviews.push(reviewRow(i, fullyScored));
    dims.push(...dimensionRows(i, fullyScored));
    for (const key of fullyScored ? ["dim-rq", "dim-rd", "dim-eq", "dim-bc", "dim-ca"] : ["dim-rq", "dim-rd", "dim-eq", "dim-bc"]) {
      links.push({ dimension_id: `${key}-${i}`, evidence_id: eid(i) });
    }
    evidence.set(eid(i), { id: eid(i), user_id: USER_ID, kind: "user_input", decision_id: did(i), label: QUOTE });
    evidence.set(mid(i), { id: mid(i), user_id: USER_ID, kind: "prior_review", review_id: rid(i), label: "Decision DNA supporting review" });
  }
  const state: FakeState = {
    rules: [...(options.rules ?? [])],
    markers: [],
    links: new Map(),
    embeddings: new Map(),
    evidence,
    patterns: options.patternRows ?? [],
    patternLinks: [...(options.patternLinks ?? []), ...(options.extraPatternLinks ?? [])],
  };
  let ruleSeq = 0;
  let markerSeq = 0;

  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    calls.push({ text, values });
    if (text === DNA_QUERIES.lock) return { rows: [] };
    if (text === DNA_QUERIES.eligibleReviews) return { rows: [...reviews].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
    if (text === DNA_QUERIES.dimensions) return { rows: dims.filter((row) => row.review_id === values[1]) };
    if (text === DNA_QUERIES.dimensionLinks) {
      const reviewDims = new Set(dims.filter((row) => row.review_id === values[1]).map((row) => row.id));
      return { rows: links.filter((row) => reviewDims.has(row.dimension_id)) };
    }
    if (text === DNA_QUERIES.origins) return { rows: [{ label: "pure_impulse", basis: "inference", confidence: "0.9" }] };
    if (text === DNA_QUERIES.sources) return { rows: [] };
    if (text === DNA_QUERIES.contexts) return { rows: [] };
    if (text === DNA_QUERIES.evidence) {
      const reviewIndex = reviews.findIndex((row) => row.id === values[3]);
      return { rows: reviewIndex >= 0 ? [evidence.get(eid(reviewIndex + 1))!] : [] };
    }
    if (text === DNA_QUERIES.reviewEvidence) {
      const index = reviews.findIndex((row) => row.id === values[1]);
      return { rows: index >= 0 ? [evidence.get(mid(index + 1))!] : [] };
    }
    if (text === DNA_QUERIES.createReviewEvidence) throw new Error("playbook must never create review markers");
    if (text === PLAYBOOK_QUERIES.lockOwner) return { rows: [{ id: USER_ID }] };
    if (text === PLAYBOOK_QUERIES.list) {
      return { rows: [...state.rules].sort((a, b) => Number(a.version) - Number(b.version) || String(a.id).localeCompare(String(b.id))) };
    }
    if (text === PLAYBOOK_QUERIES.get) {
      return { rows: state.rules.filter((row) => row.id === values[1] && row.user_id === USER_ID) };
    }
    if (text === PLAYBOOK_QUERIES.patterns) {
      return { rows: state.patterns.filter((row) => (row.observed_statistics as Row).producer === "decision-dna.v1" && (row.observed_statistics as Row).active === true) };
    }
    if (text === PLAYBOOK_QUERIES.patternEvidence) {
      const ids = values[1] as string[];
      return {
        rows: state.patternLinks.filter((row) => {
          if (!ids.includes(String(row.pattern_id))) return false;
          const pattern = state.patterns.find((entry) => String(entry.id) === String(row.pattern_id));
          if (!pattern) return false;
          const refs = ((pattern.observed_statistics as Row).evidenceRefs as string[]) ?? [];
          return refs.includes(String(row.id));
        }),
      };
    }
    if (text === PLAYBOOK_QUERIES.ruleEvidence) {
      const ids = values[1] as string[];
      const rows: Row[] = [];
      for (const ruleId of ids) {
        for (const evidenceId of state.links.get(ruleId) ?? new Set<string>()) {
          const row = evidence.get(evidenceId) ?? state.markers.find((marker) => marker.id === evidenceId);
          if (row) rows.push({ ...row, rule_id: row.kind === "playbook_rule" ? row.rule_id : null });
        }
      }
      return { rows };
    }
    if (text === PLAYBOOK_QUERIES.ownedEvidence) return { rows: [] };
    if (text === PLAYBOOK_QUERIES.insert) {
      ruleSeq += 1;
      const version = Math.max(0, ...state.rules.map((row) => Number(row.version))) + 1;
      const row: Row = {
        id: ruleUuid(ruleSeq),
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
      state.rules.push(row);
      return { rows: [row] };
    }
    if (text === PLAYBOOK_QUERIES.provenance) {
      markerSeq += 1;
      const marker: Row = { id: evUuid(markerSeq), user_id: USER_ID, kind: "playbook_rule", rule_id: values[1], label: values[2] };
      state.markers.push(marker);
      return { rows: [marker] };
    }
    if (text === PLAYBOOK_QUERIES.linkEvidence) {
      const ruleId = String(values[1]);
      const set = state.links.get(ruleId) ?? new Set<string>();
      for (const id of values[2] as string[]) set.add(id);
      state.links.set(ruleId, set);
      return { rows: [] };
    }
    if (text === `SELECT * FROM public.playbook_rules WHERE user_id=$1 AND id=$2 LIMIT 1`) {
      return { rows: state.rules.filter((row) => row.id === values[1] && row.user_id === USER_ID) };
    }
    if (text.includes("FROM public.memory_embeddings") && text.startsWith("SELECT")) {
      const key = `${values[2]}:${values[5]}`;
      const existing = state.embeddings.get(key);
      return { rows: existing ? [existing] : [] };
    }
    if (text.startsWith("INSERT INTO public.memory_embeddings")) {
      const key = `${values[2]}:${values[11]}`;
      if (state.embeddings.has(key)) return { rows: [] };
      const row: Row = { id: `mem-${state.embeddings.size + 1}`, user_id: values[0], entity_type: values[1], entity_id: values[2], rule_id: values[6], source_text: values[10], source_hash: values[11], metadata: values[12] };
      state.embeddings.set(key, row);
      return { rows: [row] };
    }
    throw new Error(`unexpected query in fake db: ${text.slice(0, 140)}`);
  }

  const asQueryable = <T>(text: string, values?: readonly unknown[]) => dispatch(text, values) as Promise<{ rows: T[] }>;
  const queryable: Queryable = { query: asQueryable };
  let queue = Promise.resolve();
  const snapshot = () => ({
    rules: [...state.rules],
    markers: [...state.markers],
    links: new Map([...state.links.entries()].map(([key, value]) => [key, new Set(value)])),
    embeddings: new Map(state.embeddings),
  });
  const restore = (saved: ReturnType<typeof snapshot>) => {
    state.rules = saved.rules;
    state.markers = saved.markers;
    state.links = saved.links;
    state.embeddings = saved.embeddings;
  };
  const db: DbSession = {
    query: asQueryable,
    transaction: (fn) => {
      const run = queue.then(async () => {
        const saved = snapshot();
        try {
          return await fn(queryable);
        } catch (error) {
          restore(saved);
          throw error;
        }
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return { db, queryable, calls, state, reviews };
}

function patternRowFor(candidate: DNAPatternCandidate, index: number): Row {
  return {
    id: pid(index),
    user_id: USER_ID,
    kind: candidate.category,
    status: candidate.status,
    description: candidate.description,
    observed_statistics: { ...candidate.observedStatistics, memorySourceHash: buildDNAMemory(candidate).sourceHash, evidenceStats: {} },
    evidence_count: candidate.evidenceCount,
    confidence: null,
  };
}

async function computeFixture(db: DbSession, queryable: Queryable): Promise<DNAPatternCandidate[]> {
  const events = await createPatternsRepository(db, auth).loadEvents(queryable, { createReviewMarkers: false });
  return computeDecisionDNA(USER_ID, events).candidates;
}

async function provisioned(options: FakeOptions = {}) {
  const fake = fakeDb(options);
  const candidates = await computeFixture(fake.db, fake.queryable);
  fake.state.patterns = candidates.map((candidate, index) => patternRowFor(candidate, index + 1));
  const links: Row[] = [];
  for (const [index, candidate] of candidates.entries()) {
    for (const ref of candidate.evidenceRefs) {
      links.push({ pattern_id: fake.state.patterns[index].id, id: ref, user_id: USER_ID, kind: "user_input" });
    }
  }
  for (const candidate of candidates) {
    for (const ref of candidate.evidenceRefs) {
      if (!fake.state.evidence.has(ref)) fake.state.evidence.set(ref, { id: ref, user_id: USER_ID, kind: "user_input" });
    }
  }
  fake.state.patternLinks.push(...links);
  return { ...fake, candidates, links };
}

test("empty persisted DNA returns honest empty proposals with no inserts", async () => {
  const { db, calls, state } = fakeDb({ patternRows: [] });
  const repo = createPlaybookRepository(db, auth);
  const result = (await repo.propose()) as { proposals: unknown[]; createdCount: number; existingCount: number; unsupportedEvidenceCount: number; recomputationRequired?: boolean };
  assert.deepEqual(result.proposals, []);
  assert.equal(result.createdCount, 0);
  assert.equal(result.existingCount, 0);
  assert.equal(result.unsupportedEvidenceCount, 0);
  assert.equal(result.recomputationRequired, true);
  assert.equal(state.rules.length, 0);
  assert.equal(state.markers.length, 0);
  assert.ok(!calls.some((call) => call.text === DNA_QUERIES.eligibleReviews));
});

test("propose creates deterministic proposals for both supported templates", async () => {
  const { db, state, calls } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const result = (await repo.propose()) as { proposals: RuleView[]; createdCount: number; existingCount: number; unsupportedEvidenceCount: number; policyVersion: string; generationMode: string };
  assert.equal(result.policyVersion, "playbook.v1");
  assert.equal(result.generationMode, "deterministic");
  assert.equal(result.createdCount, 2);
  assert.equal(result.unsupportedEvidenceCount, 1);
  const target = result.proposals.find((proposal) => proposal.provenance?.templateId === "target_revision")!;
  const research = result.proposals.find((proposal) => proposal.provenance?.templateId === "research_check")!;
  const targetTemplate = PLAYBOOK_TEMPLATES[0];
  const researchTemplate = PLAYBOOK_TEMPLATES[1];
  assert.equal(target.ruleText, targetTemplate.ruleText);
  assert.equal(target.title, targetTemplate.title);
  assert.equal(target.trigger, targetTemplate.trigger);
  assert.equal(research.ruleText, researchTemplate.ruleText);
  assert.equal(target.status, "proposed");
  assert.equal(target.previousRuleId, null);
  assert.equal(target.provenance?.maturity, "experimental");
  assert.equal(target.provenance?.sourceStatus, "observation");
  assert.equal(target.provenance?.effectiveness, "unproven");
  assert.equal(target.provenance?.financialBenefit, "unknown");
  assert.equal(target.provenance?.confidence, null);
  assert.match(target.provenance!.equivalentKey, /^[0-9a-f]{64}$/);
  assert.match(target.rationale, /single-decision observation, not recurrence/);
  assert.match(target.rationale, /not a trade signal/);
  assert.ok(target.evidenceRefs.length > 0);
  assert.ok(target.provenance!.supportingDecisionIds.length === 1);
  assert.equal(state.rules.length, 2);
  assert.equal(state.markers.length, 2);
  const marker = state.markers.find((row) => row.rule_id === target.id)!;
  const decoded = decodePlaybookMarkerLabel(marker.label);
  assert.deepEqual(decoded, target.provenance);
  const links = state.links.get(target.id)!;
  assert.ok(links.has(String(marker.id)));
  for (const ref of target.provenance!.evidenceRefs) assert.ok(links.has(ref));
  assert.ok(calls.some((call) => call.text === PLAYBOOK_QUERIES.lockOwner));
  assert.ok(!calls.some((call) => call.text === DNA_QUERIES.createReviewEvidence));
});

test("repeated propose dedupes on equivalent key without inserting", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const first = (await repo.propose()) as { proposals: RuleView[] };
  const second = (await repo.propose()) as { proposals: RuleView[]; createdCount: number; existingCount: number };
  assert.equal(second.createdCount, 0);
  assert.equal(second.existingCount, 2);
  assert.deepEqual(
    second.proposals.map((rule) => rule.id).sort(),
    first.proposals.map((rule) => rule.id).sort(),
  );
  assert.equal(state.rules.length, 2);
  assert.equal(state.markers.length, 2);
});

test("inactive patterns are excluded and malformed lifecycle stats fail closed", async () => {
  const { db, state, candidates } = await provisioned();
  const bad = { ...state.patterns[0], observed_statistics: { ...(state.patterns[0].observed_statistics as Row), active: true, occurrenceCount: 1, highQualityCount: 0, evidenceRefs: (state.patterns[0].observed_statistics as Row).evidenceRefs, supportingDecisionIds: (state.patterns[0].observed_statistics as Row).supportingDecisionIds, supportingReviewIds: (state.patterns[0].observed_statistics as Row).supportingReviewIds, memorySourceHash: buildDNAMemory(candidates[0]).sourceHash }, status: "established" };
  state.patterns = [bad];
  const repo = createPlaybookRepository(db, auth);
  await assert.rejects(() => repo.propose(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("stale persisted patterns that no longer match recomputation are skipped", async () => {
  const { db, state, candidates } = await provisioned();
  const stale = { ...state.patterns[0], observed_statistics: { ...(state.patterns[0].observed_statistics as Row), memorySourceHash: "0".repeat(64) } };
  state.patterns = [stale];
  const repo = createPlaybookRepository(db, auth);
  const result = (await repo.propose()) as { proposals: RuleView[]; createdCount: number };
  assert.equal(result.createdCount, 0);
  assert.equal(state.rules.length, 0);
});

test("established candidates produce pattern_backed maturity; emerging stays experimental", async () => {
  const established = await provisioned({ reviewCount: 4, fullyScored: true });
  const repo = createPlaybookRepository(established.db, auth);
  const result = (await repo.propose()) as { proposals: RuleView[] };
  assert.ok(result.proposals.length >= 1);
  const establishedRule = result.proposals.find((proposal) => proposal.provenance?.sourceStatus === "established");
  assert.ok(establishedRule);
  assert.equal(establishedRule.provenance?.maturity, "pattern_backed");
  assert.equal(establishedRule.provenance?.effectiveness, "unproven");
  assert.match(establishedRule.rationale, /established grounded recurrence/);

  const emerging = await provisioned({ reviewCount: 2, fullyScored: true });
  const emergingRepo = createPlaybookRepository(emerging.db, auth);
  const emergingResult = (await emergingRepo.propose()) as { proposals: RuleView[] };
  assert.ok(emergingResult.proposals.length >= 1);
  const emergingRule = emergingResult.proposals.find((proposal) => proposal.provenance?.sourceStatus === "emerging");
  assert.ok(emergingRule);
  assert.equal(emergingRule.provenance?.maturity, "experimental");
  assert.match(emergingRule.rationale, /emerging comparable evidence/);
});

test("defer creates a deferred version and stale ancestor actions conflict", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const counter = { calls: 0 };
    const embedder = fakeEmbedder(counter);
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    const root = proposals[0];
    const deferred = await repo.decide(root.id, "defer", embedder);
    assert.equal(deferred.status, "deferred");
    assert.equal(deferred.previousRuleId, root.id);
    assert.ok(deferred.version > root.version);
    assert.equal(counter.calls, 0);
    const retry = await repo.decide(root.id, "defer", embedder);
    assert.equal(retry.id, deferred.id);
    assert.equal(state.rules.length, 3);
    await assert.rejects(() => repo.decide(root.id, "reject", embedder), (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT");
    const accepted = await repo.decide(deferred.id, "accept", embedder);
    assert.equal(accepted.status, "active");
    assert.equal(accepted.previousRuleId, deferred.id);
    assert.equal(counter.calls, 1);
    assert.equal(state.markers.length, 4);
    assert.deepEqual(decodePlaybookMarkerLabel(state.markers[3].label), accepted.provenance);
    const acceptRetry = await repo.decide(root.id, "accept", embedder);
    assert.equal(acceptRetry.id, accepted.id);
    assert.equal(counter.calls, 1);
    assert.equal(state.rules.length, 4);
    await assert.rejects(() => repo.decide(deferred.id, "reject", embedder), (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT");
  });
});

test("reject is terminal and retried reject returns the same version", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const counter = { calls: 0 };
  const embedder = fakeEmbedder(counter);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const root = proposals[0];
  const rejected = await repo.decide(root.id, "reject", embedder);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.userDecision, "rejected");
  assert.equal(counter.calls, 0);
  const retry = await repo.decide(root.id, "reject", embedder);
  assert.equal(retry.id, rejected.id);
  assert.equal(state.rules.length, 3);
  await assert.rejects(() => repo.decide(root.id, "accept", embedder), (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT");
});

test("two concurrent accepts serialize to one active version and one embedding", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const counter = { calls: 0 };
    const embedder = fakeEmbedder(counter);
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    const [first, second] = await Promise.all([repo.decide(proposals[0].id, "accept", embedder), repo.decide(proposals[0].id, "accept", embedder)]);
    assert.equal(first.id, second.id);
    assert.equal(first.status, "active");
    assert.equal(state.rules.filter((row) => row.status === "active").length, 1);
    assert.equal(counter.calls, 1);
  });
});

test("embedding failure rolls back the acceptance version", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    await assert.rejects(() => repo.decide(proposals[0].id, "accept", fakeEmbedder({ calls: 0 }, true)), AIError);
    assert.equal(state.rules.length, 2);
    assert.equal(state.markers.length, 2);
    assert.equal(state.embeddings.size, 0);
  });
});

test("acceptance retry dedupes the embedding by source hash", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const counter = { calls: 0 };
    const embedder = fakeEmbedder(counter);
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    const accepted = await repo.decide(proposals[0].id, "accept", embedder);
    const retry = await repo.decide(accepted.id, "accept", embedder);
    assert.equal(retry.id, accepted.id);
    assert.equal(counter.calls, 1);
    assert.equal(state.embeddings.size, 1);
  });
});

test("unknown and foreign rules fail closed", async () => {
  const { db } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  await assert.rejects(() => repo.decide("99999999-9999-4999-8999-000000000000", "accept", fakeEmbedder({ calls: 0 })), (error: unknown) => error instanceof RepositoryError && error.code === "NOT_FOUND");
  await assert.rejects(() => repo.decide("not-a-uuid", "accept", fakeEmbedder({ calls: 0 })), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("getPlaybook groups current, pending, rejected, and history views", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    const [target, research] = proposals;
    await repo.decide(target.id, "accept", fakeEmbedder({ calls: 0 }));
    await repo.decide(research.id, "reject", fakeEmbedder({ calls: 0 }));
    const view = (await repo.getPlaybook()) as { currentRules: RuleView[]; pendingProposals: RuleView[]; rejectedProposals: RuleView[]; history: RuleView[] };
    assert.equal(view.currentRules.length, 1);
    assert.equal(view.currentRules[0].status, "active");
    assert.equal(view.rejectedProposals.length, 1);
    assert.equal(view.history.length, 2);
    assert.ok(view.history.every((row) => row.status === "proposed"));
    assert.equal(view.currentRules[0].provenance?.equivalentKey, target.provenance?.equivalentKey);
  });
});

test("ambiguous or broken version chains fail closed", async () => {
  const parent: Row = { id: ruleUuid(1), user_id: USER_ID, version: 1, previous_rule_id: null, source_pattern_id: null, status: "proposed", title: "t", trigger: "t", rule_text: "r", rationale: "r", user_decision: null, decided_at: null, created_at: "" };
  const childA: Row = { ...parent, id: ruleUuid(2), version: 2, previous_rule_id: ruleUuid(1) };
  const childB: Row = { ...parent, id: ruleUuid(3), version: 3, previous_rule_id: ruleUuid(1) };
  const { db } = fakeDb({ rules: [parent, childA, childB], patternRows: [] });
  const repo = createPlaybookRepository(db, auth);
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("forged stored pattern columns fail closed while unverified stats never reach proposals", async () => {
  const { db, state } = await provisioned();
  const forgedColumns = { ...state.patterns[0], description: "forged narrative", status: "established" };
  state.patterns = [forgedColumns];
  const repo = createPlaybookRepository(db, auth);
  await assert.rejects(() => repo.propose(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");

  const { db: db2, state: state2, candidates: candidates2 } = await provisioned();
  const target = candidates2.find((candidate) => candidate.observedStatistics.feature === "target_drift")!;
  const targetPattern = state2.patterns.find((row) => (row.observed_statistics as Row).fingerprint === target.fingerprint)!;
  const forgedStats = {
    ...targetPattern,
    observed_statistics: {
      ...(targetPattern.observed_statistics as Row),
      supportingDecisionIds: ["99999999-9999-4999-8999-000000000099"],
      supporting: { decisionCount: 1, finalCount: 1, provisionalCount: 0, qualityUnassessedCount: 0, forged: true },
      description: "forged narrative",
    },
  };
  state2.patterns = [forgedStats];
  state2.patternLinks = state2.patternLinks.filter((link) => String(link.pattern_id) === String(targetPattern.id));
  const repo2 = createPlaybookRepository(db2, auth);
  const result = (await repo2.propose()) as { proposals: RuleView[]; createdCount: number };
  assert.equal(result.createdCount, 1);
  const view = result.proposals[0];
  assert.equal(view.provenance?.observedBehavior, target.description);
  assert.deepEqual(view.provenance?.supportingDecisionIds, target.observedStatistics.supportingDecisionIds);
  assert.equal(view.rationale.includes("forged narrative"), false);
  assert.equal("forged" in (view.provenance?.relevantMetrics ?? {}), false);
});

test("historical pattern links outside current evidence refs are excluded", async () => {
  const staleEvidenceId = "55555555-5555-4555-8555-999999999999";
  const { db, state, candidates } = await provisioned({ extraPatternLinks: [] });
  const targetIndex = candidates.findIndex((candidate) => candidate.observedStatistics.feature === "target_drift");
  const stale = { pattern_id: state.patterns[targetIndex].id, id: staleEvidenceId, user_id: USER_ID, kind: "user_input" };
  state.patternLinks.push(stale);
  state.evidence.set(staleEvidenceId, { id: staleEvidenceId, user_id: USER_ID, kind: "user_input" });
  const repo = createPlaybookRepository(db, auth);
  const result = (await repo.propose()) as { proposals: RuleView[]; createdCount: number };
  const proposed = result.proposals.find((rule) => rule.provenance?.templateId === "target_revision")!;
  assert.ok(!proposed.evidenceRefs.includes(staleEvidenceId));
  assert.equal(result.createdCount, 2);
});

test("acceptance memory source text embeds frozen provenance", async () => {
  await withEmbeddingEnv(async () => {
    const { db, state } = await provisioned();
    const repo = createPlaybookRepository(db, auth);
    const counter = { calls: 0 };
    const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
    await repo.decide(proposals[0].id, "accept", fakeEmbedder(counter));
    const row = [...state.embeddings.values()][0];
    const text = String(row.source_text);
    assert.match(text, /playbook_policy: playbook\.v1/);
    assert.match(text, /"maturity":"experimental"/);
    assert.match(text, /"effectiveness":"unproven"/);
    assert.match(text, /"financialBenefit":"unknown"/);
    assert.match(text, /provenance: \{/);
  });
});

test("version inversion and inconsistent decision columns fail closed", async () => {
  const base: Row = { id: ruleUuid(1), user_id: USER_ID, version: 2, previous_rule_id: null, source_pattern_id: null, status: "proposed", title: "t", trigger: "t", rule_text: "r", rationale: "r", user_decision: null, decided_at: null, created_at: "" };
  const child: Row = { ...base, id: ruleUuid(2), version: 1, previous_rule_id: ruleUuid(1) };
  const { db } = fakeDb({ rules: [base, child], patternRows: [] });
  await assert.rejects(() => createPlaybookRepository(db, auth).getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  const inconsistent: Row = { ...base, id: ruleUuid(3), version: 3, status: "active", user_decision: null, decided_at: "2026-01-01" };
  const bad = fakeDb({ rules: [base, { ...inconsistent, previous_rule_id: ruleUuid(1) }], patternRows: [] });
  await assert.rejects(() => createPlaybookRepository(bad.db, auth).getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("duplicate markers, wrong-version markers, and ref mismatches fail closed", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const ruleId = proposals[0].id;
  const marker = state.markers.find((row) => row.rule_id === ruleId)!;
  state.markers.push({ ...marker, id: "99999999-9999-4999-8999-000000000099" });
  state.links.get(ruleId)!.add("99999999-9999-4999-8999-000000000099");
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");

  const { db: db2, state: state2 } = await provisioned();
  const repo2 = createPlaybookRepository(db2, auth);
  const { proposals: proposals2 } = (await repo2.propose()) as { proposals: RuleView[] };
  const marker2 = state2.markers.find((row) => row.rule_id === proposals2[0].id)!;
  marker2.rule_id = proposals2[1].id;
  await assert.rejects(() => repo2.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");

  const { db: db3, state: state3 } = await provisioned();
  const repo3 = createPlaybookRepository(db3, auth);
  const { proposals: proposals3 } = (await repo3.propose()) as { proposals: RuleView[] };
  state3.links.get(proposals3[0].id)!.add("55555555-5555-4555-8555-999999999998");
  state3.evidence.set("55555555-5555-4555-8555-999999999998", { id: "55555555-5555-4555-8555-999999999998", user_id: USER_ID, kind: "user_input" });
  await assert.rejects(() => repo3.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("swapped descendant provenance and missing descendant markers fail closed", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const deferred = await repo.decide(proposals[0].id, "defer", fakeEmbedder({ calls: 0 }));
  const descendantMarker = state.markers.find((row) => row.rule_id === deferred.id)!;
  const valid = decodePlaybookMarkerLabel(descendantMarker.label)!;
  const swapped = playbookProvenanceSchema.parse({ ...valid, patternFingerprint: "e".repeat(64), equivalentKey: ruleEquivalentKey(valid.templateId, "e".repeat(64)) });
  descendantMarker.label = JSON.stringify(swapped);
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");

  const { db: db2, state: state2 } = await provisioned();
  const repo2 = createPlaybookRepository(db2, auth);
  const { proposals: proposals2 } = (await repo2.propose()) as { proposals: RuleView[] };
  const deferred2 = await repo2.decide(proposals2[0].id, "defer", fakeEmbedder({ calls: 0 }));
  const descendantMarker2 = state2.markers.find((row) => row.rule_id === deferred2.id)!;
  state2.links.get(deferred2.id)!.delete(String(descendantMarker2.id));
  await assert.rejects(() => repo2.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("a marker disguised as a non-playbook_rule evidence kind fails closed", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const marker = state.markers.find((row) => row.rule_id === proposals[0].id)!;
  const disguised = { id: "99999999-9999-4999-8999-000000000077", user_id: USER_ID, kind: "user_input", rule_id: null, label: marker.label };
  state.evidence.set(disguised.id, disguised);
  const links = state.links.get(proposals[0].id)!;
  links.delete(String(marker.id));
  links.add(disguised.id);
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("provenance schema rejects malformed maturity, counts, and duplicated facts", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const valid = decodePlaybookMarkerLabel(state.markers.find((row) => row.rule_id === proposals[0].id)!.label)!;
  const mutations: [string, (value: Record<string, unknown>) => Record<string, unknown>][] = [
    ["maturity", (value) => ({ ...value, maturity: "pattern_backed" })],
    ["highQualityCount over count", (value) => ({ ...value, highQualityCount: 2 })],
    ["highQualityCount negative", (value) => ({ ...value, highQualityCount: -1 })],
    ["count zero", (value) => ({ ...value, supportingDecisionCount: 0 })],
    ["count mismatch", (value) => ({ ...value, supportingDecisionCount: 2 })],
    ["duplicate facts", (value) => ({ ...value, supportingFacts: [...(value.supportingFacts as unknown[]), (value.supportingFacts as unknown[])[0]] })],
    ["wrong scope", (value) => ({ ...value, scope: "established grounded recurrence under the product quality gate" })],
    ["wrong strength", (value) => ({ ...value, evidenceStrength: "emerging" })],
  ];
  for (const [name, mutate] of mutations) {
    const result = playbookProvenanceSchema.safeParse(mutate(valid as unknown as Record<string, unknown>));
    assert.equal(result.success, false, name);
  }
});

test("legacy markerless proposed rules are readable but cannot mutate", async () => {
  const legacy: Row = { id: ruleUuid(1), user_id: USER_ID, version: 1, previous_rule_id: null, source_pattern_id: null, status: "proposed", title: "t", trigger: "t", rule_text: "r", rationale: "r", user_decision: null, decided_at: null, created_at: "" };
  const { db } = fakeDb({ rules: [legacy], patternRows: [] });
  const repo = createPlaybookRepository(db, auth);
  const view = (await repo.getPlaybook()) as { pendingProposals: RuleView[] };
  assert.equal(view.pendingProposals.length, 1);
  assert.equal(view.pendingProposals[0].provenance, null);
  await assert.rejects(() => repo.decide(ruleUuid(1), "accept", fakeEmbedder({ calls: 0 })), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  await assert.rejects(() => repo.decide(ruleUuid(1), "reject", fakeEmbedder({ calls: 0 })), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("truncated playbook.v1 marker labels fail closed on read and mutate", async () => {
  const { db, state } = await provisioned();
  const repo = createPlaybookRepository(db, auth);
  const { proposals } = (await repo.propose()) as { proposals: RuleView[] };
  const marker = state.markers.find((row) => row.rule_id === proposals[0].id)!;
  marker.label = String(marker.label).slice(0, 20);
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  await assert.rejects(() => repo.decide(proposals[0].id, "accept", fakeEmbedder({ calls: 0 })), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("foreign-owned rows in rule history fail closed", async () => {
  const foreign: Row = { id: ruleUuid(1), user_id: "99999999-9999-4999-8999-999999999999", version: 1, previous_rule_id: null, source_pattern_id: null, status: "proposed", title: "t", trigger: "t", rule_text: "r", rationale: "r", user_decision: null, decided_at: null, created_at: "" };
  const { db } = fakeDb({ rules: [foreign], patternRows: [] });
  const repo = createPlaybookRepository(db, auth);
  await assert.rejects(() => repo.getPlaybook(), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});
