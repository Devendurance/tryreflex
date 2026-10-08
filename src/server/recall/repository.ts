import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession } from "../db/client";
import { getEmbeddingConfig } from "../db/config";
import { validateEmbedding } from "../db/validation";
import { mapPersistenceError, RepositoryError } from "../db/repositories";
import { AIError } from "../ai/errors";
import type { EmbeddingProvider } from "../ai/types";
import { RECALL_QUERIES } from "../recall-queries";
import { patternLifecycle } from "../decision-dna-policy";
import {
  RECALL_DECISION_LIMIT,
  RECALL_MIN_SIMILARITY,
  RECALL_SEARCH_LIMIT,
  type RecallData,
  type RecallHistory,
  type RecallInput,
  type RecallMatch,
  type RecallPattern,
  type RecallRule,
} from "../recall-policy";
import { createReviewRepository } from "../reviews/repository";
import { getReview } from "../reviews/service";
import type { TargetDriftFinding } from "../reviews/plan-drift";

type Row = Record<string, unknown>;

const ENTITY_TYPES = new Set(["decision", "review", "pattern", "rule"]);
const ORIGIN_LABELS = new Set(["original_research", "borrowed_conviction", "social_confirmation", "pure_impulse"]);
const ORIGIN_BASES = new Set(["inference", "user_confirmed"]);
const KNOWN_OUTCOMES = new Set(["positive", "negative", "break_even"]);
const PATTERN_STATUSES = new Set(["observation", "emerging", "established"]);

const matchRowSchema = z.looseObject({
  id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  source_hash: z.string().min(1),
  similarity: z.number().finite().min(-1).max(1),
});

const uuidArraySchema = z.array(z.string().uuid());
const decimalSchema = z
  .string()
  .regex(/^(?:\d{1,18})(?:\.\d{1,12})?$/)
  .refine((value) => Number(value) > 0);
const uuidRef = z.looseObject({ evidenceId: z.string().uuid(), quote: z.string().min(1) });
const driftFindingSchema = z.looseObject({
  type: z.literal("target_drift"),
  status: z.literal("observed"),
  evidenceBasis: z.literal("retrospective_user_report"),
  evidenceRefs: z.array(z.string().uuid()).min(1),
  originalPlan: z.looseObject({ metric: z.literal("market_cap"), currency: z.literal("USD"), value: decimalSchema }),
  revisedPlan: z.looseObject({ metric: z.literal("market_cap"), currency: z.literal("USD"), value: decimalSchema }),
  metrics: z.record(z.string(), z.string().nullable()),
  ordering: uuidRef,
  observedFacts: z.array(uuidRef).min(1),
  userSelfAssessment: z.array(z.looseObject({ text: z.string(), evidenceRefs: z.array(z.string().uuid()) })),
});

function dbError(error: unknown): never {
  if (error instanceof AIError) throw error;
  return mapPersistenceError(error);
}

function malformed(message: string): never {
  throw new RepositoryError(message, "INVALID_INPUT");
}

function requireOwned(row: Row, userId: string): void {
  if (row.user_id !== undefined && row.user_id !== null && String(row.user_id) !== userId) {
    malformed("retrieved row is not owned by the authenticated user");
  }
}

function emptyRecallData(): RecallData {
  return { history: [], patterns: [], rules: [], sources: [], truncated: false };
}

export function createRecallRepository(db: DbSession, authContext: AuthContext) {
  const auth = validateAuthContext(authContext);
  const userId = auth.userId;
  const reviewRepo = createReviewRepository(db, auth);

  async function loadHistory(decisionId: string, reviewIdHint: string | null): Promise<RecallHistory | null> {
    const decisionRow = (
      await db.query<Row>(RECALL_QUERIES.decision, [userId, decisionId]).catch(dbError)
    ).rows[0];
    if (!decisionRow) return null;
    requireOwned(decisionRow, userId);
    let reviewId = reviewIdHint;
    if (reviewId === null) {
      reviewId =
        ((await db.query<Row>(RECALL_QUERIES.currentReview, [userId, decisionId]).catch(dbError)).rows[0]?.id as
          | string
          | undefined) ?? null;
    }
    const origins = (
      await db.query<Row>(RECALL_QUERIES.origins, [userId, decisionId]).catch(dbError)
    ).rows.flatMap((row) => {
      requireOwned(row, userId);
      if (!ORIGIN_BASES.has(String(row.basis))) return [];
      if (!ORIGIN_LABELS.has(String(row.label))) malformed("decision origin label is not a supported enum value");
      return [{ label: String(row.label), basis: String(row.basis) as "inference" | "user_confirmed" }];
    });
    const snapshot =
      typeof decisionRow.confirmed_snapshot === "object" && decisionRow.confirmed_snapshot !== null
        ? (decisionRow.confirmed_snapshot as Row)
        : {};
    const base = {
      decisionId,
      symbol:
        typeof decisionRow.asset_symbol === "string" && decisionRow.asset_symbol.length > 0
          ? decisionRow.asset_symbol
          : null,
      assetClass:
        typeof decisionRow.asset_class === "string" && decisionRow.asset_class.length > 0
          ? decisionRow.asset_class
          : null,
      knowledgeBasis:
        snapshot.knowledgeBasis === "retrospective_recollection"
          ? "retrospective_recollection"
          : "confirmed_decision_user_report",
      rawInput: String(decisionRow.raw_input),
      origins,
    };
    if (reviewId !== null) {
      let detail: Record<string, unknown>;
      try {
        detail = await getReview(reviewRepo, reviewId);
      } catch (error) {
        if (error instanceof RepositoryError && error.code === "NOT_FOUND") return null;
        if (error instanceof AIError) throw error;
        return mapPersistenceError(error);
      }
      const detailDecision =
        typeof detail.decision === "object" && detail.decision !== null ? (detail.decision as Row) : null;
      if (String(detail.reviewId) !== reviewId || detail.isCurrent !== true || String(detailDecision?.id) !== decisionId) {
        malformed("review detail does not match the recalled decision");
      }
      const metrics = typeof detail.metrics === "object" && detail.metrics !== null ? (detail.metrics as Row) : {};
      const tradeMetrics =
        typeof metrics.tradeMetrics === "object" && metrics.tradeMetrics !== null ? (metrics.tradeMetrics as Row) : {};
      const rawOutcome = typeof tradeMetrics.outcome === "string" ? tradeMetrics.outcome : "unknown";
      const evidenceById = new Map<string, Row>();
      const evidenceRefs: string[] = [];
      for (const entry of Array.isArray(detail.evidence) ? (detail.evidence as Row[]) : []) {
        const id = typeof entry.evidenceId === "string" ? entry.evidenceId : null;
        if (id === null || !z.string().uuid().safeParse(id).success) continue;
        evidenceById.set(id, entry);
        evidenceRefs.push(id);
      }
      const planDrift: TargetDriftFinding[] = [];
      for (const raw of Array.isArray(detail.planDrift) ? detail.planDrift : []) {
        const parsed = driftFindingSchema.safeParse(raw);
        if (!parsed.success) malformed("stored plan drift finding is malformed");
        for (const ref of parsed.data.evidenceRefs) {
          if (!evidenceById.has(ref)) malformed("plan drift references unowned evidence");
        }
        for (const source of [parsed.data.ordering, ...parsed.data.observedFacts]) {
          if (!parsed.data.evidenceRefs.includes(source.evidenceId)) {
            malformed("plan drift fact source is not listed in the finding evidence refs");
          }
          const record = evidenceById.get(source.evidenceId);
          if (!record) malformed("plan drift references unowned evidence");
          if (typeof record.text !== "string" || !record.text.includes(source.quote)) {
            malformed("plan drift quote is not contained in the referenced source");
          }
        }
        for (const ref of parsed.data.evidenceRefs) evidenceRefs.push(ref);
        planDrift.push(parsed.data as unknown as TargetDriftFinding);
      }
      const uniqueRefs = [...new Set(evidenceRefs)];
      if (uniqueRefs.length === 0) return null;
      return {
        ...base,
        reviewId,
        lifecycle: {
          status: "historical_review",
          evidenceCount: 1,
          meaning: "A single recalled review is a historical record, not a recurring pattern.",
        },
        outcome: KNOWN_OUTCOMES.has(rawOutcome) ? (rawOutcome as RecallHistory["outcome"]) : "unknown",
        planDrift,
        evidenceRefs: uniqueRefs,
        matchedSources: [],
      };
    }
    const evidenceRows = (
      await db.query<Row>(RECALL_QUERIES.decisionEvidence, [userId, decisionId]).catch(dbError)
    ).rows;
    for (const row of evidenceRows) {
      requireOwned(row, userId);
      if (!z.string().uuid().safeParse(row.id).success) malformed("decision evidence row has an invalid id");
    }
    if (evidenceRows.length === 0) return null;
    return {
      ...base,
      reviewId: null,
      lifecycle: {
        status: "historical_decision",
        evidenceCount: 1,
        meaning: "A single recalled decision is a historical record, not a recurring pattern.",
      },
      outcome: "unknown",
      planDrift: [],
      evidenceRefs: evidenceRows.map((row) => String(row.id)),
      matchedSources: [],
    };
  }

  async function loadReviewHistory(reviewId: string): Promise<RecallHistory | null> {
    const view = await reviewRepo.getReviewView(reviewId).catch(dbError);
    if (!view.review || view.review.is_current !== true) return null;
    requireOwned(view.review, userId);
    return loadHistory(String(view.review.decision_id), reviewId);
  }

  async function recall(input: RecallInput, embedder: EmbeddingProvider): Promise<RecallData> {
    const { model, dimensions } = getEmbeddingConfig();
    const available = (
      await db.query<Row>(RECALL_QUERIES.available, [userId, model, dimensions]).catch(dbError)
    ).rows[0];
    if (!available || available.available !== true) return emptyRecallData();
    const embedded = await embedder.embedQuery(input.text);
    if (
      embedded.model !== model ||
      embedded.dimensions !== dimensions ||
      embedded.sourceText !== input.text ||
      !validateEmbedding(embedded.vector).valid
    ) {
      throw new AIError("PROVIDER");
    }
    const matches: RecallMatch[] = (
      await db
        .query<Row>(RECALL_QUERIES.search, [userId, `[${embedded.vector.join(",")}]`, model, dimensions, RECALL_SEARCH_LIMIT])
        .catch(dbError)
    ).rows.flatMap((row) => {
      const parsed = matchRowSchema.safeParse(row);
      if (!parsed.success || !ENTITY_TYPES.has(parsed.data.entity_type)) {
        malformed("memory search row is malformed");
      }
      if (parsed.data.similarity < RECALL_MIN_SIMILARITY) return [];
      return [
        {
          memoryId: parsed.data.id,
          entityType: parsed.data.entity_type as RecallMatch["entityType"],
          entityId: parsed.data.entity_id,
          similarity: parsed.data.similarity,
          sourceHash: parsed.data.source_hash,
        },
      ];
    });

    const historyMap = new Map<string, RecallHistory>();
    const patterns: RecallPattern[] = [];
    const rules: RecallRule[] = [];
    const sources = new Map<string, { entityType: string; entityId: string; evidenceRefs: Set<string>; knowledgeBasis: string }>();
    let truncated = false;

    const addSource = (entityType: string, entityId: string, refs: readonly string[], knowledgeBasis: string) => {
      const key = `${entityType}:${entityId}`;
      const entry = sources.get(key) ?? { entityType, entityId, evidenceRefs: new Set<string>(), knowledgeBasis };
      refs.forEach((ref) => entry.evidenceRefs.add(ref));
      sources.set(key, entry);
    };
    const addHistory = (history: RecallHistory | null, match: RecallMatch): void => {
      if (!history) return;
      const existing = historyMap.get(history.decisionId);
      if (existing) {
        if (!existing.matchedSources.some((entry) => entry.memoryId === match.memoryId)) existing.matchedSources.push(match);
        if (history.reviewId && !existing.reviewId) {
          existing.reviewId = history.reviewId;
          existing.lifecycle = history.lifecycle;
          existing.outcome = history.outcome;
          existing.planDrift = history.planDrift;
          existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...history.evidenceRefs])];
        }
        return;
      }
      if (historyMap.size >= RECALL_DECISION_LIMIT) {
        truncated = true;
        return;
      }
      history.matchedSources.push(match);
      historyMap.set(history.decisionId, history);
    };

    for (const match of matches) {
      if (match.entityType === "decision") {
        addHistory(await loadHistory(match.entityId, null), match);
      } else if (match.entityType === "review") {
        addHistory(await loadReviewHistory(match.entityId), match);
      } else if (match.entityType === "pattern") {
        const patternRow = (
          await db.query<Row>(RECALL_QUERIES.pattern, [userId, match.entityId]).catch(dbError)
        ).rows[0];
        if (!patternRow) continue;
        requireOwned(patternRow, userId);
        const stats = (
          typeof patternRow.observed_statistics === "object" && patternRow.observed_statistics !== null
            ? patternRow.observed_statistics
            : {}
        ) as Row;
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
          stats.memorySourceHash !== match.sourceHash ||
          stats.producer !== "decision-dna.v1" ||
          stats.active !== true ||
          !PATTERN_STATUSES.has(String(patternRow.status)) ||
          patternRow.status !== expectedStatus ||
          stats.establishedEligible !== ((count as number) >= 4 && (highQualityCount as number) >= 4) ||
          !Number.isInteger(count) ||
          (count as number) < 1 ||
          count !== patternRow.evidence_count ||
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
        const refs = refsParsed.data;
        const linked = (
          await db.query<Row>(RECALL_QUERIES.patternEvidence, [userId, match.entityId]).catch(dbError)
        ).rows;
        for (const row of linked) requireOwned(row, userId);
        const linkedIds = new Set(linked.map((row) => String(row.id)));
        if (linkedIds.size !== refs.length || !refs.every((ref) => linkedIds.has(ref))) {
          malformed("pattern supporting evidence is not fully owned and linked");
        }
        const pattern: RecallPattern = {
          id: String(patternRow.id),
          category: String(patternRow.kind),
          status: patternRow.status as RecallPattern["status"],
          evidenceCount: patternRow.evidence_count as number,
          feature: String(stats.feature),
          basis: String(stats.basis),
          description: String(patternRow.description),
          supportingDecisionIds: decisionIdsParsed.data,
          supportingReviewIds: reviewIdsParsed.data,
          evidenceRefs: refs,
          match,
        };
        patterns.push(pattern);
        addSource("pattern", pattern.id, refs, "deterministic_server_policy");
        const supports = [...new Set(decisionIdsParsed.data)];
        if (supports.length > RECALL_DECISION_LIMIT) truncated = true;
        for (const supportingDecisionId of supports.slice(0, RECALL_DECISION_LIMIT)) {
          addHistory(await loadHistory(supportingDecisionId, null), match);
        }
      } else {
        const ruleRow = (
          await db.query<Row>(RECALL_QUERIES.rule, [userId, match.entityId]).catch(dbError)
        ).rows[0];
        if (!ruleRow) continue;
        requireOwned(ruleRow, userId);
        if (ruleRow.status !== "active" || ruleRow.user_decision !== "accepted") continue;
        const evidenceRows = (
          await db.query<Row>(RECALL_QUERIES.ruleEvidence, [userId, match.entityId]).catch(dbError)
        ).rows;
        for (const row of evidenceRows) requireOwned(row, userId);
        if (evidenceRows.length === 0) continue;
        const refs = evidenceRows.map((row) => String(row.id));
        rules.push({
          id: String(ruleRow.id),
          title: String(ruleRow.title),
          trigger: String(ruleRow.trigger),
          ruleText: String(ruleRow.rule_text),
          status: "active",
          userDecision: "accepted",
          evidenceRefs: refs,
          match,
        });
        addSource("rule", String(ruleRow.id), refs, "accepted_playbook_rule");
      }
    }

    const history = [...historyMap.values()];
    for (const entry of history) {
      addSource("decision", entry.decisionId, entry.evidenceRefs, entry.knowledgeBasis);
      if (entry.reviewId) addSource("review", entry.reviewId, entry.evidenceRefs, entry.knowledgeBasis);
    }
    return {
      history,
      patterns,
      rules,
      sources: [...sources.values()].map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId,
        evidenceRefs: [...entry.evidenceRefs],
        knowledgeBasis: entry.knowledgeBasis,
      })),
      truncated,
    };
  }

  return { recall };
}
