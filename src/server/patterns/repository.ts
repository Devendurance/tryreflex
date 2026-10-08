import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession, Queryable } from "../db/client";
import { createRepositories, mapPersistenceError, RepositoryError } from "../db/repositories";
import { createMemoryStore } from "../ai/memory-store";
import { AIError } from "../ai/errors";
import type { EmbeddingProvider } from "../ai/types";
import { DNA_QUERIES } from "../decision-dna-queries";
import {
  buildDNAMemory,
  computeDecisionDNA,
  DNA_POLICY_VERSION,
  type DNAEvent,
  type DNAPatternCandidate,
} from "../decision-dna-policy";
import { REVIEW_DIMENSIONS, type ReviewDimension } from "../review-policy";

type Row = Record<string, unknown>;

const ASSET_CLASSES = new Set(["crypto", "rtoken", "stock", "other"]);
const ORIGIN_BASES = new Set(["inference", "user_confirmed"]);
const KNOWN_OUTCOMES = new Set(["positive", "negative", "break_even"]);
const PRIOR_REVIEW_DESCRIPTOR = "Owned completed decision autopsy";
const MAX_ELIGIBLE_REVIEWS = 500;

const dimensionNameSchema = z.enum(REVIEW_DIMENSIONS);

const evidenceCatalogSchema = z.array(
  z.looseObject({ id: z.string().uuid(), text: z.string() }),
);

const observedFactSchema = z.strictObject({
  evidenceId: z.string().uuid(),
  quote: z.string().min(1),
});

const inferenceDimensionsSchema = z.array(
  z.looseObject({
    dimension: dimensionNameSchema,
    observedFacts: z.array(observedFactSchema).optional(),
  }),
);

const planDriftEntrySchema = z.looseObject({
  type: z.string(),
  status: z.string(),
  evidenceBasis: z.string(),
  evidenceRefs: z.array(z.string().uuid()).min(1),
  ordering: z.looseObject({ evidenceId: z.string().uuid(), quote: z.string().min(1) }),
  observedFacts: z.array(observedFactSchema).min(1),
});

const tradeMetricsOutcomeSchema = z.looseObject({ outcome: z.string().optional() });

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new RepositoryError("review timestamp is unusable", "INVALID_INPUT");
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new RepositoryError("persisted numeric value is not finite", "INVALID_INPUT");
  }
  if (typeof value === "string" && /^(?:\d+)(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new RepositoryError("persisted numeric value is malformed", "INVALID_INPUT");
}

function emptyEvidenceStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const zeroStats = {
    decisionCount: 0,
    qualityAssessedCount: 0,
    qualityUnassessedCount: 0,
    finalCount: 0,
    provisionalCount: 0,
    averageDecisionQuality: null,
    medianDecisionQuality: null,
    averageFinalDecisionQuality: null,
    averageProvisionalDecisionQuality: null,
    averageEvidenceCoveragePct: null,
    dimensions: Object.fromEntries(
      REVIEW_DIMENSIONS.map((name) => [name, { assessedCount: 0, unassessedCount: 0, average: null, median: null }]),
    ),
    knownOutcomes: { positive: 0, negative: 0, breakEven: 0, unknown: 0 },
    statisticsMeaning: "Descriptive record aggregates, not causal effects, realized-return estimates, or statistical certainty",
    decimalRounding: "12 decimal places, half away from zero",
  };
  return {
    ...zeroStats,
    policyVersion: DNA_POLICY_VERSION,
    independentDecisionCount: 0,
    eligibleReviewCount: 0,
    supersededOrSameDecisionReviewsExcluded: 0,
    observationCount: 0,
    emergingCount: 0,
    establishedCount: 0,
    ...overrides,
  };
}

export function createPatternsRepository(db: DbSession, authContext: AuthContext) {
  const auth = validateAuthContext(authContext);
  const userId = auth.userId;

  async function loadEvents(q: Queryable, options: { createReviewMarkers: boolean }): Promise<DNAEvent[]> {
    const reviewRows = await q
      .query<Row>(DNA_QUERIES.eligibleReviews, [userId])
      .catch(mapPersistenceError);
    if (reviewRows.rows.length > MAX_ELIGIBLE_REVIEWS) {
      throw new RepositoryError("eligible review history exceeds the bounded recomputation limit", "INVALID_INPUT");
    }
    const events: DNAEvent[] = [];
    for (const review of reviewRows.rows) {
      const reviewId = String(review.id);
      const decisionId = String(review.decision_id);
      const tradeId = String(review.trade_id);
      const [dimensions, links, origins, sources] = await Promise.all([
        q.query<Row>(DNA_QUERIES.dimensions, [userId, reviewId]),
        q.query<Row>(DNA_QUERIES.dimensionLinks, [userId, reviewId]),
        q.query<Row>(DNA_QUERIES.origins, [userId, decisionId]),
        q.query<Row>(DNA_QUERIES.sources, [userId, decisionId]),
      ]).catch(mapPersistenceError);
      const openedAt = review.opened_at;
      const contextRows =
        openedAt === null || openedAt === undefined
          ? { rows: [] as Row[] }
          : await q
              .query<Row>(DNA_QUERIES.contexts, [userId, decisionId, isoTimestamp(openedAt)])
              .catch(mapPersistenceError);
      const sourceIds = sources.rows.map((row) => String(row.id));
      const contextIds = contextRows.rows.map((row) => String(row.id));
      const evidenceRows = await q
        .query<Row>(DNA_QUERIES.evidence, [userId, decisionId, tradeId, reviewId, sourceIds, contextIds])
        .catch(mapPersistenceError);
      let marker = (
        await q.query<Row>(DNA_QUERIES.reviewEvidence, [userId, reviewId]).catch(mapPersistenceError)
      ).rows[0];
      if (!marker && options.createReviewMarkers) {
        marker = (
          await q
            .query<Row>(DNA_QUERIES.createReviewEvidence, [userId, reviewId, isoTimestamp(review.created_at)])
            .catch(mapPersistenceError)
        ).rows[0];
      }
      if (!marker) {
        throw new RepositoryError("review support evidence is missing", "NOT_FOUND");
      }
      if (!evidenceRows.rows.some((row) => String(row.id) === String(marker.id))) {
        evidenceRows.rows.push(marker);
      }

      const inference = typeof review.ai_inference === "object" && review.ai_inference !== null ? (review.ai_inference as Row) : {};
      const catalog = new Map<string, string>();
      if (inference.evidenceCatalog !== undefined && inference.evidenceCatalog !== null) {
        const catalogParsed = evidenceCatalogSchema.safeParse(inference.evidenceCatalog);
        if (!catalogParsed.success) {
          throw new RepositoryError("persisted review evidence catalog is malformed", "INVALID_INPUT");
        }
        for (const entry of catalogParsed.data) {
          catalog.set(entry.id, entry.text);
        }
      }
      const inferenceDimensions = inferenceDimensionsSchema.safeParse(inference.dimensions).success
        ? (inference.dimensions as { dimension: ReviewDimension; observedFacts?: { evidenceId: string; quote: string }[] }[])
        : [];
      const linksByDimension = new Map<string, string[]>();
      for (const link of links.rows) {
        const key = String(link.dimension_id);
        linksByDimension.set(key, [...(linksByDimension.get(key) ?? []), String(link.evidence_id)]);
      }

      const metrics = typeof review.observed_metrics === "object" && review.observed_metrics !== null ? (review.observed_metrics as Row) : {};
      const outcomeParsed = tradeMetricsOutcomeSchema.safeParse(metrics.tradeMetrics);
      const outcomeValue = outcomeParsed.success && typeof outcomeParsed.data.outcome === "string" ? outcomeParsed.data.outcome : "unknown";
      const rawDrift = Array.isArray(metrics.planDrift) ? metrics.planDrift : [];

      const event: DNAEvent = {
        userId,
        decisionId,
        reviewId,
        tradeId,
        reviewedAt: isoTimestamp(review.created_at),
        reviewEvidenceId: String(marker.id),
        assetClass: ASSET_CLASSES.has(String(review.asset_class)) ? (review.asset_class as DNAEvent["assetClass"]) : null,
        assetSymbol: typeof review.asset_symbol === "string" && review.asset_symbol.length > 0 ? review.asset_symbol : null,
        origins: origins.rows.map((row) => ({
          label: String(row.label),
          basis: (ORIGIN_BASES.has(String(row.basis)) ? row.basis : "inference") as DNAEvent["origins"][number]["basis"],
          confidence: numericOrNull(row.confidence),
        })),
        dimensions: dimensions.rows.map((row) => {
          const dimension = dimensionNameSchema.safeParse(row.dimension);
          if (!dimension.success) throw new RepositoryError("review dimension failed validation", "INVALID_INPUT");
          const inferenceDimension = inferenceDimensions.find((entry) => entry.dimension === dimension.data);
          return {
            dimension: dimension.data,
            score: numericOrNull(row.score),
            confidence: numericOrNull(row.confidence) ?? 0,
            evidenceRefs: linksByDimension.get(String(row.id)) ?? [],
            observedFacts: inferenceDimension?.observedFacts ?? [],
          };
        }),
        evidence: evidenceRows.rows.map((row) => {
          const id = String(row.id);
          const text =
            catalog.get(id) ??
            (row.kind === "prior_review" ? PRIOR_REVIEW_DESCRIPTOR : typeof row.label === "string" ? row.label : "");
          return {
            id,
            userId: String(row.user_id),
            kind: String(row.kind),
            text,
            decisionId: row.decision_id === null || row.decision_id === undefined ? null : String(row.decision_id),
            tradeId: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id),
            sourceId: row.source_id === null || row.source_id === undefined ? null : String(row.source_id),
            contextSnapshotId:
              row.context_snapshot_id === null || row.context_snapshot_id === undefined ? null : String(row.context_snapshot_id),
            reviewId: row.review_id === null || row.review_id === undefined ? null : String(row.review_id),
          };
        }),
        planDrift: rawDrift.map((entry) => {
          const parsed = planDriftEntrySchema.safeParse(entry);
          if (!parsed.success) {
            throw new RepositoryError("persisted plan drift entry is malformed", "INVALID_INPUT");
          }
          return {
            type: parsed.data.type,
            status: parsed.data.status,
            evidenceBasis: parsed.data.evidenceBasis,
            evidenceRefs: parsed.data.evidenceRefs,
            observedFacts: parsed.data.observedFacts,
            ordering: { evidenceId: parsed.data.ordering.evidenceId, quote: parsed.data.ordering.quote },
          };
        }),
        sources: sources.rows.map((row) => ({
          id: String(row.id),
          sourceType: String(row.source_type),
          url: typeof row.url === "string" ? row.url : null,
        })),
        contexts: contextRows.rows.map((row) => {
          const nativeState = row.native_market_state === "open" || row.native_market_state === "closed" ? row.native_market_state : null;
          const observedFacts = typeof row.observed_facts === "object" && row.observed_facts !== null ? (row.observed_facts as Row) : null;
          const observedRegime = observedFacts && typeof observedFacts.regime === "string" ? observedFacts.regime : null;
          const regime =
            observedRegime !== null && observedRegime === row.regime && observedRegime.trim().length > 0 && observedRegime !== "unknown"
              ? observedRegime
              : null;
          return { id: String(row.id), verifiedDecisionTime: true, nativeMarketState: nativeState, regime };
        }),
        outcome: KNOWN_OUTCOMES.has(outcomeValue) ? (outcomeValue as DNAEvent["outcome"]) : "unknown",
      };
      events.push(event);
    }
    return events;
  }

  async function recomputeDNA(embedder: EmbeddingProvider) {
    return db
      .transaction(async (q) => {
        await q.query(DNA_QUERIES.lock, [`decision-dna:${userId}`]);
        const events = await loadEvents(q, { createReviewMarkers: true });
        const { candidates, evidenceStats } = computeDecisionDNA(userId, events);
        const txSession: DbSession = {
          query: (text, values) => q.query(text, values),
          transaction: (fn) => fn(q),
        };
        const repos = createRepositories(txSession, auth);
        const memory = createMemoryStore(repos, embedder);
        const saved: { pattern: Row; candidate: DNAPatternCandidate }[] = [];
        for (const candidate of candidates) {
          const memoryDocument = buildDNAMemory(candidate);
          const observedStatistics = {
            ...candidate.observedStatistics,
            memorySourceHash: memoryDocument.sourceHash,
            evidenceStats,
          };
          const upserted = await q.query<Row>(DNA_QUERIES.upsertPattern, [
            userId,
            candidate.category,
            candidate.status,
            candidate.description,
            observedStatistics,
            { narrativeBasis: "deterministic_server_policy" },
            candidate.evidenceCount,
          ]);
          const pattern = upserted.rows[0];
          if (!pattern) throw new RepositoryError("pattern could not be persisted", "CONFLICT");
          const refs = [...new Set(candidate.evidenceRefs)];
          const owned = await q.query<Row>(DNA_QUERIES.ownedEvidence, [userId, refs]);
          if (owned.rows.length !== refs.length) {
            throw new RepositoryError("pattern evidence is not owned by the authenticated user", "INVALID_INPUT");
          }
          await q.query(DNA_QUERIES.linkEvidence, [userId, String(pattern.id), refs]);
          await memory.storeDocument({
            entityType: "pattern",
            entityId: String(pattern.id),
            sourceText: memoryDocument.text,
            metadata: { textVersion: memoryDocument.version, dnaPolicyVersion: DNA_POLICY_VERSION, status: candidate.status },
          });
          saved.push({ pattern, candidate });
        }
        const retired = await q.query<Row>(DNA_QUERIES.retirePatterns, [userId, candidates.map((candidate) => candidate.fingerprint)]);
        return {
          eventsLoaded: events.length,
          candidates,
          evidenceStats,
          saved: saved.map((entry) => entry.pattern),
          retiredIds: retired.rows.map((row) => String(row.id)),
        };
      })
      .catch((error) => {
        if (error instanceof AIError) throw error;
        return mapPersistenceError(error);
      });
  }

  function patternView(row: Row, evidenceByPattern: Map<string, Row[]>) {
    const stats = (typeof row.observed_statistics === "object" && row.observed_statistics !== null ? row.observed_statistics : {}) as Row;
    const refs = Array.isArray(stats.evidenceRefs) ? stats.evidenceRefs.map(String) : [];
    const linked = evidenceByPattern.get(String(row.id)) ?? [];
    const linkedIds = new Set(linked.map((entry) => String(entry.id)));
    for (const ref of refs) {
      if (!linkedIds.has(ref)) {
        throw new RepositoryError("pattern supporting evidence is missing from current links", "INVALID_INPUT");
      }
    }
    return {
      id: String(row.id),
      category: String(row.kind),
      status: String(row.status),
      count: typeof stats.occurrenceCount === "number" ? stats.occurrenceCount : row.evidence_count,
      confidence: null,
      evidenceStrength: stats.evidenceStrength ?? null,
      supportingDecisionIds: stats.supportingDecisionIds ?? [],
      supportingReviewIds: stats.supportingReviewIds ?? [],
      firstObserved: stats.firstObserved ?? null,
      lastObserved: stats.lastObserved ?? null,
      description: row.description,
      comparability: stats.comparability ?? {},
      stats,
      evidenceRefs: refs,
      evidence: linked.map((entry) => ({
        id: String(entry.id),
        label: entry.label ?? null,
        kind: entry.kind,
        decisionId: entry.decision_id ?? null,
        tradeId: entry.trade_id ?? null,
        sourceId: entry.source_id ?? null,
        contextSnapshotId: entry.context_snapshot_id ?? null,
        reviewId: entry.review_id ?? null,
      })),
      supportingFacts: stats.supportingFacts ?? [],
    };
  }

  async function getDNA() {
    const [active, evidence, all] = await Promise.all([
      db.query<Row>(DNA_QUERIES.activePatterns, [userId]),
      db.query<Row>(DNA_QUERIES.currentEvidence, [userId]),
      db.query<Row>(DNA_QUERIES.listPatterns, [userId]),
    ]).catch(mapPersistenceError);
    const evidenceByPattern = new Map<string, Row[]>();
    for (const row of evidence.rows) {
      const key = String(row.pattern_id);
      evidenceByPattern.set(key, [...(evidenceByPattern.get(key) ?? []), row]);
    }
    const patterns = active.rows.map((row) => patternView(row, evidenceByPattern));
    let evidenceStats: Record<string, unknown> | null = null;
    for (const row of active.rows) {
      const stats = row.observed_statistics as Row | null;
      const globalStats = stats?.evidenceStats;
      if (typeof globalStats === "object" && globalStats !== null) {
        evidenceStats = { ...(globalStats as Record<string, unknown>), aggregationStatus: "snapshot_from_last_recompute" };
        break;
      }
    }
    let recomputationRequired = false;
    if (evidenceStats === null) {
      const eligible = await db.query<Row>(DNA_QUERIES.eligibleReviews, [userId]).catch(mapPersistenceError);
      if (eligible.rows.length > MAX_ELIGIBLE_REVIEWS) {
        throw new RepositoryError("eligible review history exceeds the bounded recomputation limit", "INVALID_INPUT");
      }
      const decisionIds = new Set(eligible.rows.map((row) => String(row.decision_id)));
      if (eligible.rows.length === 0) {
        evidenceStats = emptyEvidenceStats();
      } else {
        recomputationRequired = true;
        evidenceStats = {
          policyVersion: DNA_POLICY_VERSION,
          independentDecisionCount: decisionIds.size,
          eligibleReviewCount: eligible.rows.length,
          supersededOrSameDecisionReviewsExcluded: eligible.rows.length - decisionIds.size,
          aggregationStatus: "not_computed",
          qualityAssessedCount: null,
          qualityUnassessedCount: null,
          knownOutcomes: null,
          dimensions: null,
          averageDecisionQuality: null,
          averageEvidenceCoveragePct: null,
        };
      }
    }
    const independent = typeof evidenceStats.independentDecisionCount === "number" ? evidenceStats.independentDecisionCount : 0;
    const byCategory = (kind: string) => patterns.filter((pattern) => pattern.category === kind && pattern.status !== "observation");
    const observations = patterns.filter((pattern) => pattern.status === "observation");
    return {
      summary: {
        status: independent === 0 ? "empty" : independent < 4 ? "sparse" : "longitudinal",
        independentDecisionCount: independent,
        policyVersion: DNA_POLICY_VERSION,
        observationCount: observations.length,
        emergingCount: patterns.filter((pattern) => pattern.status === "emerging").length,
        establishedCount: patterns.filter((pattern) => pattern.status === "established").length,
        retiredCount: all.rows.length - active.rows.length,
        recomputationRequired,
      },
      edges: byCategory("edge"),
      leaks: byCategory("leak"),
      influences: byCategory("influence"),
      executionPatterns: byCategory("execution"),
      regimes: byCategory("regime"),
      observations,
      evidenceStats,
    };
  }

  return { loadEvents, recomputeDNA, getDNA };
}
