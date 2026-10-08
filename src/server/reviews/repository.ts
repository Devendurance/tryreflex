import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession } from "../db/client";
import { mapPersistenceError, RepositoryError } from "../db/repositories";
import { jsonObjectSchema } from "../db/validation";
import { REVIEW_DIMENSIONS } from "../review-policy";

type Row = Record<string, unknown>;

const uuidSchema = z.string().uuid();

const planDriftRefsSchema = z.array(
  z.looseObject({ evidenceRefs: z.array(z.string().uuid()).min(1).max(10) }),
).max(5);

function planDriftRefs(planDrift: unknown): string[] {
  const parsed = planDriftRefsSchema.safeParse(planDrift ?? []);
  if (!parsed.success) throw new RepositoryError("plan drift findings failed validation", "INVALID_INPUT");
  return [...new Set(parsed.data.flatMap((finding) => finding.evidenceRefs))];
}

export interface ReviewDimensionPersist {
  dimension: string;
  score: number | null;
  explanation: string;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface PersistReviewInput {
  tradeId: string;
  decisionId: string;
  processClassification: string | null;
  observedMetrics: Record<string, unknown>;
  aiInference: Record<string, unknown>;
  dimensions: readonly ReviewDimensionPersist[];
}

export interface ReviewBundle {
  trade: Row | null;
  decision: Row | null;
  origins: Row[];
  sources: Row[];
  contexts: Row[];
  events: Row[];
  evidence: Row[];
}

const persistDimensionSchema = z.strictObject({
  dimension: z.enum(REVIEW_DIMENSIONS),
  score: z.number().int().min(0).max(100).nullable(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().uuid()),
});

export function createReviewRepository(db: DbSession, authContext: AuthContext) {
  const auth = validateAuthContext(authContext);
  const userId = auth.userId;

  async function loadBundle(tradeId: string, decisionId?: string): Promise<ReviewBundle> {
    const tradeResult = await db.query<Row>(
      `SELECT * FROM public.trades WHERE user_id=$1 AND id=$2 LIMIT 1`,
      [userId, tradeId],
    ).catch(mapPersistenceError);
    const trade = tradeResult.rows[0] ?? null;
    if (!trade) return { trade: null, decision: null, origins: [], sources: [], contexts: [], events: [], evidence: [] };
    const resolvedDecisionId = decisionId ?? String(trade.decision_id);
    const [decision, origins, sources, contexts, events] = await Promise.all([
      db.query<Row>(`SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, resolvedDecisionId]),
      db.query<Row>(`SELECT * FROM public.decision_origins WHERE user_id=$1 AND decision_id=$2 ORDER BY created_at,id`, [userId, resolvedDecisionId]),
      db.query<Row>(`SELECT * FROM public.decision_sources WHERE user_id=$1 AND decision_id=$2 ORDER BY created_at,id`, [userId, resolvedDecisionId]),
      db.query<Row>(
        `SELECT * FROM public.market_context_snapshots WHERE user_id=$1 AND decision_id=$2 AND captured_at<=$3 ORDER BY captured_at,id`,
        [userId, resolvedDecisionId, trade.opened_at],
      ),
      db.query<Row>(`SELECT * FROM public.trade_events WHERE user_id=$1 AND trade_id=$2 ORDER BY occurred_at,id`, [userId, tradeId]),
    ]);
    const contextIds = contexts.rows.map((row) => String(row.id));
    const sourceIds = sources.rows.map((row) => String(row.id));
    const evidence = await db.query<Row>(
      `SELECT * FROM public.evidence_records WHERE user_id=$1 AND (decision_id=$2 OR trade_id=$3 OR context_snapshot_id=ANY($4::uuid[]) OR source_id=ANY($5::uuid[])) ORDER BY created_at,id`,
      [userId, resolvedDecisionId, tradeId, contextIds, sourceIds],
    ).catch(mapPersistenceError);
    return {
      trade,
      decision: decision.rows[0] ?? null,
      origins: origins.rows,
      sources: sources.rows,
      contexts: contexts.rows,
      events: events.rows,
      evidence: evidence.rows,
    };
  }

  async function ensureEvidence(input: {
    kind: "user_input" | "market_data" | "trade_data" | "source";
    decisionId?: string;
    contextSnapshotId?: string;
    tradeId?: string;
    sourceId?: string;
    label: string;
    observedAt?: string;
  }): Promise<Row> {
    const fkColumn =
      input.kind === "user_input"
        ? "decision_id"
        : input.kind === "market_data"
          ? "context_snapshot_id"
          : input.kind === "trade_data"
            ? "trade_id"
            : "source_id";
    const fkValue =
      input.kind === "user_input"
        ? input.decisionId
        : input.kind === "market_data"
          ? input.contextSnapshotId
          : input.kind === "trade_data"
            ? input.tradeId
            : input.sourceId;
    if (typeof fkValue !== "string") throw new RepositoryError("evidence link missing", "INVALID_INPUT");
    const existing = await db.query<Row>(
      `SELECT * FROM public.evidence_records WHERE user_id=$1 AND kind=$2 AND ${fkColumn}=$3 AND label=$4 LIMIT 1`,
      [userId, input.kind, fkValue, input.label],
    ).catch(mapPersistenceError);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await db.query<Row>(
      `INSERT INTO public.evidence_records (user_id,kind,${fkColumn},label,observed_at) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [userId, input.kind, fkValue, input.label, input.observedAt ?? null],
    ).catch(mapPersistenceError);
    const row = inserted.rows[0];
    if (!row) throw new RepositoryError("evidence could not be created", "CONFLICT");
    return row;
  }

  async function persistReview(input: PersistReviewInput): Promise<{ review: Row; dimensions: Row[] }> {
    const dimensionsParsed = z.array(persistDimensionSchema).length(5).safeParse(input.dimensions);
    if (!dimensionsParsed.success) {
      throw new RepositoryError("review dimensions failed validation", "INVALID_INPUT");
    }
    const dimensionKeys = new Set(dimensionsParsed.data.map((d) => d.dimension));
    if (dimensionKeys.size !== 5 || !REVIEW_DIMENSIONS.every((d) => dimensionKeys.has(d))) {
      throw new RepositoryError("review dimensions failed validation", "INVALID_INPUT");
    }
    if (
      !jsonObjectSchema.safeParse(input.observedMetrics).success ||
      !jsonObjectSchema.safeParse(input.aiInference).success
    ) {
      throw new RepositoryError("review payload failed validation", "INVALID_INPUT");
    }
    const planRefs = planDriftRefs(input.observedMetrics.planDrift);
    return db.transaction(async (q) => {
      const locked = await q.query<Row>(
        `SELECT * FROM public.trades WHERE user_id=$1 AND id=$2 FOR UPDATE`,
        [userId, input.tradeId],
      );
      const trade = locked.rows[0];
      if (!trade) throw new RepositoryError("trade not found", "NOT_FOUND");
      if (String(trade.decision_id) !== input.decisionId) {
        throw new RepositoryError("trade decision mismatch", "CONFLICT");
      }
      const decisionResult = await q.query<Row>(
        `SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 LIMIT 1`,
        [userId, input.decisionId],
      );
      const decision = decisionResult.rows[0];
      if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
      if (decision.status !== "confirmed" && decision.status !== "closed") {
        throw new RepositoryError("decision is not reviewable", "CONFLICT");
      }
      if (planRefs.length > 0) {
        const planEvidence = await q.query<Row>(
          `SELECT id FROM public.evidence_records WHERE user_id=$1 AND id=ANY($2::uuid[]) AND (decision_id=$3 OR trade_id=$4)`,
          [userId, planRefs, input.decisionId, input.tradeId],
        );
        if (planEvidence.rows.length !== planRefs.length) {
          throw new RepositoryError("plan drift evidence not found", "NOT_FOUND");
        }
      }
      const versionResult = await q.query<{ version: number }>(
        `SELECT COALESCE(MAX(version),0)+1 AS version FROM public.reviews WHERE user_id=$1 AND trade_id=$2`,
        [userId, input.tradeId],
      );
      const version = versionResult.rows[0]?.version;
      if (typeof version !== "number" || !Number.isInteger(version)) {
        throw new RepositoryError("review version could not be computed", "CONFLICT");
      }
      await q.query(
        `UPDATE public.reviews SET is_current=false WHERE user_id=$1 AND trade_id=$2 AND is_current=true`,
        [userId, input.tradeId],
      );
      const inserted = await q.query<Row>(
        `INSERT INTO public.reviews (user_id,decision_id,trade_id,version,is_current,process_classification,observed_metrics,ai_inference) VALUES($1,$2,$3,$4,true,$5,$6,$7) RETURNING *`,
        [
          userId,
          input.decisionId,
          input.tradeId,
          version,
          input.processClassification,
          input.observedMetrics,
          input.aiInference,
        ],
      );
      const review = inserted.rows[0];
      if (!review) throw new RepositoryError("review could not be created", "CONFLICT");
      const dimensions: Row[] = [];
      for (const dimension of input.dimensions) {
        const dimInserted = await q.query<Row>(
          `INSERT INTO public.review_dimensions (user_id,review_id,dimension,score,explanation,confidence) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [userId, review.id, dimension.dimension, dimension.score, dimension.explanation, dimension.confidence],
        );
        const dim = dimInserted.rows[0];
        if (!dim) throw new RepositoryError("review dimension could not be created", "CONFLICT");
        dimensions.push(dim);
        const refs = [...new Set(dimension.evidenceRefs)];
        for (const evidenceId of refs) {
          if (!uuidSchema.safeParse(evidenceId).success) {
            throw new RepositoryError("review evidence reference is invalid", "INVALID_INPUT");
          }
          await q.query(
            `INSERT INTO public.review_dimension_evidence (user_id,dimension_id,evidence_id) VALUES($1,$2,$3)`,
            [userId, dim.id, evidenceId],
          );
        }
      }
      return { review, dimensions };
    }).catch(mapPersistenceError);
  }

  async function getReviewView(id: string): Promise<{
    review: Row | null;
    trade: Row | null;
    decision: Row | null;
    dimensions: Row[];
    evidenceLinks: Row[];
    planDriftEvidence?: Row[];
  }> {
    const reviewResult = await db.query<Row>(
      `SELECT * FROM public.reviews WHERE user_id=$1 AND id=$2 LIMIT 1`,
      [userId, id],
    ).catch(mapPersistenceError);
    const review = reviewResult.rows[0] ?? null;
    if (!review) return { review: null, trade: null, decision: null, dimensions: [], evidenceLinks: [], planDriftEvidence: [] };
    const metrics = jsonObjectSchema.safeParse(review.observed_metrics).success ? (review.observed_metrics as Row) : {};
    const refs = planDriftRefs(metrics.planDrift);
    const [trade, decision, dimensions] = await Promise.all([
      db.query<Row>(`SELECT * FROM public.trades WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, review.trade_id]),
      db.query<Row>(`SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, review.decision_id]),
      db.query<Row>(`SELECT * FROM public.review_dimensions WHERE user_id=$1 AND review_id=$2 ORDER BY dimension`, [userId, id]),
    ]).catch(mapPersistenceError);
    const dimensionIds = dimensions.rows.map((row) => String(row.id));
    const links =
      dimensionIds.length === 0
        ? { rows: [] as Row[] }
        : await db.query<Row>(
            `SELECT l.dimension_id,e.* FROM public.review_dimension_evidence l JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.dimension_id=ANY($2::uuid[]) ORDER BY l.dimension_id,e.id`,
            [userId, dimensionIds],
          ).catch(mapPersistenceError);
    let planDriftEvidence: Row[] = [];
    if (refs.length > 0) {
      const planEvidence = await db.query<Row>(
        `SELECT * FROM public.evidence_records WHERE user_id=$1 AND id=ANY($2::uuid[]) AND (decision_id=$3 OR trade_id=$4) ORDER BY id`,
        [userId, refs, review.decision_id, review.trade_id],
      ).catch(mapPersistenceError);
      if (planEvidence.rows.length !== refs.length) {
        throw new RepositoryError("plan drift evidence not found", "NOT_FOUND");
      }
      planDriftEvidence = planEvidence.rows;
    }
    return {
      review,
      trade: trade.rows[0] ?? null,
      decision: decision.rows[0] ?? null,
      dimensions: dimensions.rows,
      evidenceLinks: links.rows,
      planDriftEvidence,
    };
  }

  return { loadBundle, ensureEvidence, persistReview, getReviewView };
}
