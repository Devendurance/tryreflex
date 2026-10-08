import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession, Queryable } from "../db/client";
import { mapPersistenceError, RepositoryError } from "../db/repositories";
import { AIError } from "../ai/errors";
import type { EmbeddingProvider } from "../ai/types";
import { createMemoryStore } from "../ai/memory-store";
import { buildMemoryText } from "../ai/memory-text";
import { createRepositories } from "../db/repositories";
import { createPatternsRepository } from "../patterns/repository";
import { computeDecisionDNA, buildDNAMemory, patternLifecycle } from "../decision-dna-policy";
import { PLAYBOOK_QUERIES } from "../playbook-queries";
import {
  PLAYBOOK_POLICY_VERSION,
  buildRuleProposal,
  findPlaybookTemplate,
  validateFrozenRule,
  type PlaybookAction,
  type PlaybookRuleProvenance,
} from "../playbook-policy";

type Row = Record<string, unknown>;

const RULE_STATUSES = new Set(["proposed", "active", "rejected", "deferred"]);
const PATTERN_STATUSES = new Set(["observation", "emerging", "established"]);
const uuidArraySchema = z.array(z.string().uuid());
const ACTION_STATUS: Record<PlaybookAction, { status: string; decision: string }> = {
  accept: { status: "active", decision: "accepted" },
  reject: { status: "rejected", decision: "rejected" },
  defer: { status: "deferred", decision: "deferred" },
};

function dbError(error: unknown): never {
  if (error instanceof AIError) throw error;
  return mapPersistenceError(error);
}

function malformed(message: string): never {
  throw new RepositoryError(message, "INVALID_INPUT");
}

export interface RuleView {
  id: string;
  version: number;
  previousRuleId: string | null;
  status: string;
  userDecision: string | null;
  title: string;
  trigger: string;
  ruleText: string;
  rationale: string;
  sourcePatternId: string | null;
  decidedAt: unknown;
  createdAt: unknown;
  evidenceRefs: string[];
  provenance: PlaybookRuleProvenance | null;
}

interface ChainInfo {
  root: Row;
  leaf: Row;
  rows: Row[];
}

interface RuleEvidenceInfo {
  refs: string[];
  markerLabel: string | null;
  provenance: PlaybookRuleProvenance | null;
}

function viewRule(row: Row, evidenceRefs: string[], provenance: PlaybookRuleProvenance | null): RuleView {
  return {
    id: String(row.id),
    version: Number(row.version),
    previousRuleId: row.previous_rule_id === null || row.previous_rule_id === undefined ? null : String(row.previous_rule_id),
    status: String(row.status),
    userDecision: row.user_decision === null || row.user_decision === undefined ? null : String(row.user_decision),
    title: String(row.title),
    trigger: String(row.trigger),
    ruleText: String(row.rule_text),
    rationale: String(row.rationale),
    sourcePatternId: row.source_pattern_id === null || row.source_pattern_id === undefined ? null : String(row.source_pattern_id),
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at ?? null,
    evidenceRefs,
    provenance,
  };
}

export function createPlaybookRepository(db: DbSession, authContext: AuthContext) {
  const auth = validateAuthContext(authContext);
  const userId = auth.userId;
  const patternsRepo = createPatternsRepository(db, auth);

  async function listRows(q: Queryable): Promise<Row[]> {
    return (await q.query<Row>(PLAYBOOK_QUERIES.list, [userId]).catch(dbError)).rows;
  }

  function deriveChains(rows: Row[]): Map<string, ChainInfo> {
    for (const row of rows) {
      if (String(row.user_id) !== userId) malformed("persisted rule is not owned by the authenticated user");
      if (!RULE_STATUSES.has(String(row.status))) malformed("persisted rule status is not a supported enum value");
      if (!Number.isInteger(row.version) || (row.version as number) < 1) malformed("persisted rule version is invalid");
      const status = String(row.status);
      const decision = row.user_decision === null || row.user_decision === undefined ? null : String(row.user_decision);
      const expected = status === "proposed" ? null : { active: "accepted", rejected: "rejected", deferred: "deferred" }[status];
      if (decision !== expected) malformed("persisted rule status and user decision are inconsistent");
      if (status === "proposed" ? row.decided_at !== null && row.decided_at !== undefined : row.decided_at === null || row.decided_at === undefined) {
        malformed("persisted rule decision timestamp is inconsistent with its status");
      }
    }
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const children = new Map<string, Row[]>();
    for (const row of rows) {
      if (row.previous_rule_id === null || row.previous_rule_id === undefined) continue;
      const parentId = String(row.previous_rule_id);
      if (!byId.has(parentId)) malformed("rule version chain references a missing parent");
      const parent = byId.get(parentId)!;
      if (Number(row.version) <= Number(parent.version)) malformed("rule version chain must increase parent to child");
      const list = children.get(parentId) ?? [];
      list.push(row);
      children.set(parentId, list);
    }
    const chains = new Map<string, ChainInfo>();
    for (const root of rows.filter((row) => row.previous_rule_id === null || row.previous_rule_id === undefined)) {
      const chainRows = [root];
      const seen = new Set([String(root.id)]);
      let leaf = root;
      for (;;) {
        const next = children.get(String(leaf.id)) ?? [];
        if (next.length > 1) malformed("rule version chain has ambiguous descendants");
        if (next.length === 0) break;
        leaf = next[0];
        if (seen.has(String(leaf.id))) malformed("rule version chain contains a cycle");
        seen.add(String(leaf.id));
        chainRows.push(leaf);
      }
      for (const row of chainRows) chains.set(String(row.id), { root, leaf, rows: chainRows });
    }
    if (chains.size !== rows.length) malformed("rule version chain is broken");
    return chains;
  }

  async function loadRuleEvidence(q: Queryable, rules: Row[]): Promise<Map<string, RuleEvidenceInfo>> {
    const result = new Map<string, RuleEvidenceInfo>();
    if (rules.length === 0) return result;
    for (const row of rules) {
      const ruleId = String(row.id);
      const evidenceRows = (await q.query<Row>(PLAYBOOK_QUERIES.ruleEvidence, [userId, [ruleId]]).catch(dbError)).rows;
      const markerRows = evidenceRows.filter(
        (evidence) =>
          evidence.kind === "playbook_rule" || (typeof evidence.label === "string" && evidence.label.includes(PLAYBOOK_POLICY_VERSION)),
      );
      const { provenance, refs } = validateFrozenRule(row, evidenceRows, userId);
      result.set(ruleId, {
        refs,
        markerLabel: markerRows.length === 1 ? String(markerRows[0].label) : null,
        provenance,
      });
    }
    return result;
  }

  function assertV1ChainIntegrity(chains: Map<string, ChainInfo>, evidence: Map<string, RuleEvidenceInfo>): void {
    const seen = new Set<string>();
    for (const chain of chains.values()) {
      if (seen.has(String(chain.root.id))) continue;
      seen.add(String(chain.root.id));
      const marked = chain.rows.filter((row) => evidence.get(String(row.id))?.provenance);
      if (marked.length === 0) continue;
      if (marked.length !== chain.rows.length) malformed("a playbook.v1 chain cannot mix marked and unmarked versions");
      const frozen = JSON.stringify(evidence.get(String(marked[0].id))!.provenance);
      for (const row of chain.rows) {
        const entry = evidence.get(String(row.id))!;
        if (JSON.stringify(entry.provenance) !== frozen) malformed("playbook provenance must be frozen and identical across every version");
        if (
          String(row.title) !== String(marked[0].title) ||
          String(row.trigger) !== String(marked[0].trigger) ||
          String(row.rule_text) !== String(marked[0].rule_text) ||
          String(row.rationale) !== String(marked[0].rationale) ||
          String(row.source_pattern_id) !== String(marked[0].source_pattern_id)
        ) {
          malformed("rule content must be identical across every version of a playbook.v1 chain");
        }
      }
      for (const row of chain.rows.slice(0, -1)) {
        if (row.status === "active" || row.status === "rejected") {
          malformed("a terminal playbook rule cannot have descendants");
        }
      }
    }
  }

  async function getPlaybook(): Promise<Record<string, unknown>> {
    return db
      .transaction(async (q) => {
        const rows = await listRows(q);
        const chains = deriveChains(rows);
        const evidence = await loadRuleEvidence(q, rows);
        assertV1ChainIntegrity(chains, evidence);
        const currentRules: RuleView[] = [];
        const pendingProposals: RuleView[] = [];
        const rejectedProposals: RuleView[] = [];
        const history: RuleView[] = [];
        const leafIds = new Set([...chains.values()].map((chain) => String(chain.leaf.id)));
        const emittedLeaves = new Set<string>();
        for (const chain of chains.values()) {
          if (emittedLeaves.has(String(chain.leaf.id))) continue;
          emittedLeaves.add(String(chain.leaf.id));
          const entry = evidence.get(String(chain.leaf.id))!;
          const view = viewRule(chain.leaf, entry.refs, entry.provenance);
          if (chain.leaf.status === "active") currentRules.push(view);
          else if (chain.leaf.status === "rejected") rejectedProposals.push(view);
          else pendingProposals.push(view);
        }
        for (const row of rows) {
          if (leafIds.has(String(row.id))) continue;
          const entry = evidence.get(String(row.id))!;
          history.push(viewRule(row, entry.refs, entry.provenance));
        }
        return {
          policyVersion: PLAYBOOK_POLICY_VERSION,
          generationMode: "deterministic",
          currentRules,
          pendingProposals,
          rejectedProposals,
          history,
        };
      })
      .catch(dbError);
  }

  function validatePatternStats(row: Row): { stats: Row } {
    const stats = (typeof row.observed_statistics === "object" && row.observed_statistics !== null ? row.observed_statistics : {}) as Row;
    const refsParsed = uuidArraySchema.safeParse(stats.evidenceRefs);
    const decisionIdsParsed = uuidArraySchema.safeParse(stats.supportingDecisionIds);
    const reviewIdsParsed = uuidArraySchema.safeParse(stats.supportingReviewIds);
    const count = stats.occurrenceCount;
    const highQualityCount = stats.highQualityCount;
    let expectedStatus: string;
    try {
      expectedStatus =
        Number.isInteger(count) &&
        Number.isInteger(highQualityCount) &&
        (highQualityCount as number) >= 0 &&
        (highQualityCount as number) <= (count as number)
          ? patternLifecycle(count as number, highQualityCount as number)
          : "invalid";
    } catch {
      expectedStatus = "invalid";
    }
    if (
      stats.producer !== "decision-dna.v1" ||
      stats.active !== true ||
      !PATTERN_STATUSES.has(String(row.status)) ||
      row.status !== expectedStatus ||
      stats.establishedEligible !== ((count as number) >= 4 && (highQualityCount as number) >= 4) ||
      !Number.isInteger(count) ||
      (count as number) < 1 ||
      count !== row.evidence_count ||
      !refsParsed.success ||
      refsParsed.data.length === 0 ||
      new Set(refsParsed.data).size !== refsParsed.data.length ||
      !decisionIdsParsed.success ||
      new Set(decisionIdsParsed.data).size !== decisionIdsParsed.data.length ||
      decisionIdsParsed.data.length !== count ||
      !reviewIdsParsed.success ||
      new Set(reviewIdsParsed.data).size !== reviewIdsParsed.data.length ||
      reviewIdsParsed.data.length !== count
    ) {
      malformed("persisted pattern statistics are malformed or inconsistent");
    }
    return { stats };
  }

  async function propose(): Promise<Record<string, unknown>> {
    return db
      .transaction(async (q) => {
        await q.query(PLAYBOOK_QUERIES.lockOwner, [userId]).catch(dbError);
        const rows = await listRows(q);
        const chains = deriveChains(rows);
        const evidence = await loadRuleEvidence(q, rows);
        assertV1ChainIntegrity(chains, evidence);
        const existingKeys = new Map<string, ChainInfo>();
        for (const chain of chains.values()) {
          const entry = evidence.get(String(chain.leaf.id)) ?? evidence.get(String(chain.root.id));
          if (entry?.provenance) existingKeys.set(entry.provenance.equivalentKey, chain);
        }
        const patternRows = (await q.query<Row>(PLAYBOOK_QUERIES.patterns, [userId]).catch(dbError)).rows;
        for (const row of patternRows) {
          if (String(row.user_id) !== userId) malformed("persisted pattern is not owned by the authenticated user");
        }
        if (patternRows.length === 0) {
          return {
            policyVersion: PLAYBOOK_POLICY_VERSION,
            generationMode: "deterministic",
            proposals: [],
            createdCount: 0,
            existingCount: 0,
            unsupportedEvidenceCount: 0,
            recomputationRequired: true,
          };
        }
        const events = await patternsRepo.loadEvents(q, { createReviewMarkers: false });
        const { candidates } = computeDecisionDNA(userId, events);
        const candidatesByFingerprint = new Map(candidates.map((candidate) => [candidate.fingerprint, candidate]));
        const patternEvidence = (
          await q
            .query<Row>(PLAYBOOK_QUERIES.patternEvidence, [userId, patternRows.map((row) => String(row.id))])
            .catch(dbError)
        ).rows;
        for (const row of patternEvidence) {
          if (String(row.user_id) !== userId) malformed("pattern evidence is not owned by the authenticated user");
        }
        const linkedByPattern = new Map<string, Set<string>>();
        for (const row of patternEvidence) {
          const key = String(row.pattern_id);
          const set = linkedByPattern.get(key) ?? new Set<string>();
          set.add(String(row.id));
          linkedByPattern.set(key, set);
        }
        const proposals: RuleView[] = [];
        let createdCount = 0;
        let existingCount = 0;
        let unsupportedCount = 0;
        for (const patternRow of patternRows) {
          const { stats } = validatePatternStats(patternRow);
          const candidate = candidatesByFingerprint.get(String(stats.fingerprint));
          if (!candidate) continue;
          const memory = buildDNAMemory(candidate);
          if (stats.memorySourceHash !== memory.sourceHash) continue;
          if (
            patternRow.status !== candidate.status ||
            patternRow.evidence_count !== candidate.evidenceCount ||
            String(patternRow.description) !== candidate.description ||
            new Set(candidate.evidenceRefs).size !== (stats.evidenceRefs as string[]).length ||
            !(stats.evidenceRefs as string[]).every((ref) => new Set(candidate.evidenceRefs).has(ref))
          ) {
            malformed("persisted pattern columns disagree with the recomputed candidate");
          }
          const refs = candidate.evidenceRefs;
          const linked = linkedByPattern.get(String(patternRow.id)) ?? new Set<string>();
          if (linked.size !== refs.length || !refs.every((ref) => linked.has(ref))) {
            malformed("pattern supporting evidence is not fully owned and linked");
          }
          const candidateStats = candidate.observedStatistics;
          const template = findPlaybookTemplate(String(candidateStats.category), String(candidateStats.feature));
          if (!template) {
            unsupportedCount += 1;
            continue;
          }
          const proposal = buildRuleProposal({
            template,
            fingerprint: candidate.fingerprint,
            sourcePatternId: String(patternRow.id),
            status: candidate.status,
            highQualityCount: Number(candidateStats.highQualityCount),
            establishedEligible: candidateStats.establishedEligible === true,
            description: candidate.description,
            supportingDecisionIds: [...(candidateStats.supportingDecisionIds as string[])],
            supportingReviewIds: [...(candidateStats.supportingReviewIds as string[])],
            evidenceRefs: [...refs],
            supportingFacts: candidateStats.supportingFacts as PlaybookRuleProvenance["supportingFacts"],
            relevantMetrics: candidateStats.supporting as Record<string, unknown>,
            evidenceStrength: String(candidateStats.evidenceStrength),
          });
          const existing = existingKeys.get(proposal.provenance.equivalentKey);
          if (existing) {
            const leafEntry = evidence.get(String(existing.leaf.id)) ?? { refs: [], markerLabel: null, provenance: proposal.provenance };
            proposals.push(viewRule(existing.leaf, leafEntry.refs, leafEntry.provenance));
            existingCount += 1;
            continue;
          }
          const inserted = (
            await q
              .query<Row>(PLAYBOOK_QUERIES.insert, [
                userId,
                null,
                String(patternRow.id),
                "proposed",
                proposal.title,
                proposal.trigger,
                proposal.ruleText,
                proposal.rationale,
                null,
              ])
              .catch(dbError)
          ).rows[0];
          if (!inserted) throw new RepositoryError("playbook proposal could not be persisted", "CONFLICT");
          const marker = (
            await q
              .query<Row>(PLAYBOOK_QUERIES.provenance, [userId, String(inserted.id), JSON.stringify(proposal.provenance)])
              .catch(dbError)
          ).rows[0];
          if (!marker) throw new RepositoryError("playbook provenance marker could not be persisted", "CONFLICT");
          await q
            .query(PLAYBOOK_QUERIES.linkEvidence, [userId, String(inserted.id), [String(marker.id), ...refs]])
            .catch(dbError);
          evidence.set(String(inserted.id), { refs: [...refs], markerLabel: String(marker.label), provenance: proposal.provenance });
          proposals.push(viewRule(inserted, refs, proposal.provenance));
          createdCount += 1;
          existingKeys.set(proposal.provenance.equivalentKey, { root: inserted, leaf: inserted, rows: [inserted] });
        }
        return {
          policyVersion: PLAYBOOK_POLICY_VERSION,
          generationMode: "deterministic",
          proposals,
          createdCount,
          existingCount,
          unsupportedEvidenceCount: unsupportedCount,
        };
      })
      .catch(dbError);
  }

  async function decide(ruleId: string, action: PlaybookAction, embedder: EmbeddingProvider): Promise<RuleView> {
    const parsedId = z.string().uuid().safeParse(ruleId);
    if (!parsedId.success) throw new RepositoryError("request failed validation", "INVALID_INPUT");
    return db
      .transaction(async (q) => {
        await q.query(PLAYBOOK_QUERIES.lockOwner, [userId]).catch(dbError);
        const target = (await q.query<Row>(PLAYBOOK_QUERIES.get, [userId, parsedId.data]).catch(dbError)).rows[0];
        if (!target) throw new RepositoryError("rule not found", "NOT_FOUND");
        if (String(target.user_id) !== userId) malformed("rule row is not owned by the authenticated user");
        const rows = await listRows(q);
        const chains = deriveChains(rows);
        const chain = chains.get(String(target.id));
        if (!chain) malformed("rule version chain is broken");
        const leaf = chain.leaf;
        const evidence = await loadRuleEvidence(q, chain.rows);
        assertV1ChainIntegrity(chains, evidence);
        const leafEntry = evidence.get(String(leaf.id))!;
        const provenance = leafEntry.provenance;
        const markerLabel = leafEntry.markerLabel;
        const sourceRefs = leafEntry.refs;
        if (String(target.id) !== String(leaf.id)) {
          const terminal: Record<string, PlaybookAction> = { active: "accept", rejected: "reject", deferred: "defer" };
          const leafAction = terminal[String(leaf.status)];
          if (leafAction === action) return viewRule(leaf, leafEntry.refs, provenance);
          throw new RepositoryError("a newer version of this rule exists", "CONFLICT");
        }
        const leafStatus = String(leaf.status);
        if (leafStatus === "active" || leafStatus === "rejected") {
          const leafAction = leafStatus === "active" ? "accept" : "reject";
          if (leafAction === action) return viewRule(leaf, leafEntry.refs, provenance);
          throw new RepositoryError("a terminal rule cannot change", "CONFLICT");
        }
        if (provenance === null || markerLabel === null) {
          malformed("a legacy rule without playbook.v1 provenance cannot change through this workflow");
        }
        if (leafStatus === "deferred" && action === "defer") {
          return viewRule(leaf, leafEntry.refs, provenance);
        }
        const mapping = ACTION_STATUS[action];
        const inserted = (
          await q
            .query<Row>(PLAYBOOK_QUERIES.insert, [
              userId,
              String(leaf.id),
              leaf.source_pattern_id ?? null,
              mapping.status,
              String(leaf.title),
              String(leaf.trigger),
              String(leaf.rule_text),
              String(leaf.rationale),
              mapping.decision,
            ])
            .catch(dbError)
        ).rows[0];
        if (!inserted) throw new RepositoryError("rule version could not be persisted", "CONFLICT");
        const newMarker = (
          await q
            .query<Row>(PLAYBOOK_QUERIES.provenance, [userId, String(inserted.id), markerLabel])
            .catch(dbError)
        ).rows[0];
        if (!newMarker) throw new RepositoryError("playbook provenance marker could not be persisted", "CONFLICT");
        await q
          .query(PLAYBOOK_QUERIES.linkEvidence, [userId, String(inserted.id), [String(newMarker.id), ...sourceRefs]])
          .catch(dbError);
        if (action === "accept") {
          const memoryText = buildMemoryText({
            kind: "rule",
            title: String(leaf.title),
            trigger: String(leaf.trigger),
            ruleText: String(leaf.rule_text),
            status: "active",
            version: Number(inserted.version),
          });
          const sourceText = `${memoryText.text}\nplaybook_policy: ${PLAYBOOK_POLICY_VERSION}\nprovenance: ${JSON.stringify(provenance)}`;
          const txSession: DbSession = {
            query: (text, values) => q.query(text, values),
            transaction: (fn) => fn(q),
          };
          const memory = createMemoryStore(createRepositories(txSession, auth), embedder);
          await memory.storeDocument({
            entityType: "rule",
            entityId: String(inserted.id),
            sourceText,
            metadata: { textVersion: memoryText.version },
          });
        }
        return viewRule(inserted, sourceRefs, provenance);
      })
      .catch(dbError);
  }

  return { getPlaybook, propose, decide };
}
