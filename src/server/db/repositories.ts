import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession, Queryable } from "./client";
import { getEmbeddingConfig } from "./config";
import {
  appendMarketSnapshotSchema,
  appendOriginSchema,
  appendReviewDimensionSchema,
  appendReviewSchema,
  appendRevisionSchema,
  appendSourceSchema,
  appendTradeEventSchema,
  assertNonSecretConfig,
  computeSourceHash,
  decisionSnapshotSchema,
  draftDecisionSchema,
  linkDimensionEvidenceSchema,
  linkPatternEvidenceSchema,
  linkRuleEvidenceSchema,
  recordAiRunSchema,
  recordEvidenceSchema,
  recordPatternSchema,
  recordProviderConnectionSchema,
  recordTradeSchema,
  ruleContentSchema,
  ruleDecisionSchema,
  storeEmbeddingSchema,
  validateEmbedding,
} from "./validation";

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "CONFIGURATION",
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

type Row = Record<string, unknown>;

function toValidationError(error: unknown): never {
  if (error instanceof Error) {
    throw new RepositoryError(error.message, "INVALID_INPUT");
  }
  throw error;
}

async function getOwned<T extends Row>(q: Queryable, table: string, userId: string, id: string): Promise<T | null> {
  const result = await q.query<T>(`SELECT * FROM public.${table} WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, id]);
  return result.rows[0] ?? null;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

async function listOwned<T extends Row>(
  q: Queryable,
  table: string,
  userId: string,
  limit: number,
): Promise<T[]> {
  const result = await q.query<T>(
    `SELECT * FROM public.${table} WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, clampLimit(limit)],
  );
  return result.rows;
}

function insertSql(table: string, columns: readonly string[]): string {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
  return `INSERT INTO public.${table} (${columns.join(",")}) VALUES(${placeholders}) RETURNING *`;
}

const ENTITY_FK_COLUMNS = {
  decision: "decision_id",
  review: "review_id",
  pattern: "pattern_id",
  rule: "rule_id",
} as const;

type EmbeddingEntityType = keyof typeof ENTITY_FK_COLUMNS;

export function createRepositories(db: DbSession, auth: AuthContext) {
  const ctx = validateAuthContext(auth);
  const userId = ctx.userId;

  async function insertOwned<T extends Row>(q: Queryable, table: string, columns: readonly string[], values: readonly unknown[]): Promise<T> {
    const result = await q.query<T>(insertSql(table, columns), values);
    if (result.rows.length === 0) throw new RepositoryError(`insert into ${table} returned no row`, "CONFLICT");
    return result.rows[0];
  }

  const users = {
    async provision(): Promise<Row> {
      const inserted = await db.query<Row>(
        `INSERT INTO public.users (id,auth_provider,auth_subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT (auth_provider,auth_subject) DO NOTHING RETURNING *`,
        [userId, ctx.provider, ctx.subject, null],
      );
      const row =
        inserted.rows[0] ??
        (
          await db.query<Row>(
            `SELECT * FROM public.users WHERE auth_provider=$1 AND auth_subject=$2 LIMIT 1`,
            [ctx.provider, ctx.subject],
          )
        ).rows[0];
      if (!row) throw new RepositoryError("user provisioning failed", "CONFLICT");
      if (row.id !== userId) {
        throw new RepositoryError("auth identity already bound to a different user", "CONFLICT");
      }
      return row;
    },
    get: (id: string) =>
      db
        .query<Row>(`SELECT * FROM public.users WHERE id=$1 AND id=$2 LIMIT 1`, [userId, id])
        .then((r) => r.rows[0] ?? null),
  };

  const decisions = {
    get: (id: string) => getOwned<Row>(db, "decisions", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "decisions", userId, limit),
    async createDraft(input: unknown): Promise<Row> {
      const parsed = draftDecisionSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "decisions",
        ["user_id", "raw_input", "structured_inference", "asset_symbol", "asset_class", "side"],
        [userId, d.rawInput, d.structuredInference ?? null, d.assetSymbol ?? null, d.assetClass ?? null, d.side ?? null],
      );
    },
    async confirm(id: string, canonicalSnapshot: unknown): Promise<Row> {
      const parsed = decisionSnapshotSchema.safeParse(canonicalSnapshot);
      if (!parsed.success) toValidationError(parsed.error);
      const snapshot = parsed.data;
      return db.transaction(async (tx) => {
        const locked = await tx.query<Row>(
          `SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 FOR UPDATE`,
          [userId, id],
        );
        const decision = locked.rows[0];
        if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
        if (decision.status !== "draft") {
          throw new RepositoryError("only draft decisions can be confirmed", "CONFLICT");
        }
        const updated = await tx.query<Row>(
          `UPDATE public.decisions SET status='confirmed', confirmed_snapshot=$3, confirmed_at=now(), asset_symbol=$4, asset_class=$5, side=$6 WHERE user_id=$1 AND id=$2 AND status='draft' RETURNING *`,
          [userId, id, snapshot, snapshot.assetSymbol, snapshot.assetClass, snapshot.side],
        );
        if (updated.rows.length === 0) {
          throw new RepositoryError("decision could not be confirmed", "CONFLICT");
        }
        await tx.query(
          `INSERT INTO public.decision_revisions (user_id,decision_id,version,snapshot,reason) VALUES($1,$2,1,$3,$4)`,
          [userId, id, snapshot, "confirmed"],
        );
        return updated.rows[0];
      });
    },
    async appendRevision(id: string, input: unknown): Promise<Row> {
      const parsed = appendRevisionSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const { snapshot, reason } = parsed.data;
      return db.transaction(async (tx) => {
        const locked = await tx.query<Row>(
          `SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 FOR UPDATE`,
          [userId, id],
        );
        const decision = locked.rows[0];
        if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
        if (decision.status !== "confirmed" && decision.status !== "closed") {
          throw new RepositoryError("revisions require a confirmed or closed decision", "CONFLICT");
        }
        const versionResult = await tx.query<{ version: number }>(
          `SELECT COALESCE(MAX(version),0)+1 AS version FROM public.decision_revisions WHERE user_id=$1 AND decision_id=$2`,
          [userId, id],
        );
        const version = versionResult.rows[0].version;
        const inserted = await tx.query<Row>(
          `INSERT INTO public.decision_revisions (user_id,decision_id,version,snapshot,reason) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [userId, id, version, snapshot, reason],
        );
        return inserted.rows[0];
      });
    },
  };

  const decisionOrigins = {
    get: (id: string) => getOwned<Row>(db, "decision_origins", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "decision_origins", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendOriginSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "decision_origins",
        ["user_id", "decision_id", "label", "explanation", "confidence", "basis"],
        [userId, d.decisionId, d.label, d.explanation, d.confidence ?? null, d.basis],
      );
    },
  };

  const decisionSources = {
    get: (id: string) => getOwned<Row>(db, "decision_sources", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "decision_sources", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendSourceSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "decision_sources",
        ["user_id", "decision_id", "source_type", "label", "url", "captured_at", "note"],
        [userId, d.decisionId, d.sourceType, d.label, d.url ?? null, d.capturedAt ?? null, d.note ?? null],
      );
    },
  };

  const marketContextSnapshots = {
    get: (id: string) => getOwned<Row>(db, "market_context_snapshots", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "market_context_snapshots", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendMarketSnapshotSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "market_context_snapshots",
        [
          "user_id",
          "decision_id",
          "captured_at",
          "provider",
          "observed_facts",
          "ai_inference",
          "provenance",
          "native_market_state",
          "regime",
        ],
        [
          userId,
          d.decisionId,
          d.capturedAt,
          d.provider,
          d.observedFacts,
          d.aiInference ?? null,
          d.provenance,
          d.nativeMarketState ?? null,
          d.regime ?? null,
        ],
      );
    },
  };

  const trades = {
    get: (id: string) => getOwned<Row>(db, "trades", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "trades", userId, limit),
    async record(input: unknown): Promise<Row> {
      const parsed = recordTradeSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "trades",
        [
          "user_id",
          "decision_id",
          "provider",
          "external_id",
          "symbol",
          "side",
          "quantity",
          "entry_price",
          "exit_price",
          "fees",
          "realized_pnl",
          "opened_at",
          "closed_at",
        ],
        [
          userId,
          d.decisionId ?? null,
          d.provider,
          d.externalId ?? null,
          d.symbol,
          d.side,
          d.quantity,
          d.entryPrice,
          d.exitPrice ?? null,
          d.fees ?? "0",
          d.realizedPnl ?? null,
          d.openedAt,
          d.closedAt ?? null,
        ],
      );
    },
  };

  const tradeEvents = {
    get: (id: string) => getOwned<Row>(db, "trade_events", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "trade_events", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendTradeEventSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "trade_events",
        ["user_id", "trade_id", "event_type", "occurred_at", "facts"],
        [userId, d.tradeId, d.eventType, d.occurredAt, d.facts],
      );
    },
  };

  const reviews = {
    get: (id: string) => getOwned<Row>(db, "reviews", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "reviews", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendReviewSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "reviews",
        [
          "user_id",
          "decision_id",
          "trade_id",
          "version",
          "is_current",
          "process_classification",
          "observed_metrics",
          "ai_inference",
        ],
        [
          userId,
          d.decisionId,
          d.tradeId,
          d.version,
          d.isCurrent ?? true,
          d.processClassification ?? null,
          d.observedMetrics,
          d.aiInference ?? null,
        ],
      );
    },
  };

  const reviewDimensions = {
    get: (id: string) => getOwned<Row>(db, "review_dimensions", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "review_dimensions", userId, limit),
    async append(input: unknown): Promise<Row> {
      const parsed = appendReviewDimensionSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "review_dimensions",
        ["user_id", "review_id", "dimension", "score", "explanation", "confidence"],
        [userId, d.reviewId, d.dimension, d.score ?? null, d.explanation ?? null, d.confidence ?? null],
      );
    },
  };

  const patterns = {
    get: (id: string) => getOwned<Row>(db, "patterns", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "patterns", userId, limit),
    async record(input: unknown): Promise<Row> {
      const parsed = recordPatternSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "patterns",
        ["user_id", "kind", "status", "description", "observed_statistics", "ai_inference", "evidence_count", "confidence"],
        [
          userId,
          d.kind,
          d.status,
          d.description,
          d.observedStatistics,
          d.aiInference ?? null,
          d.evidenceCount,
          d.confidence ?? null,
        ],
      );
    },
  };

  const playbookRules = {
    get: (id: string) => getOwned<Row>(db, "playbook_rules", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "playbook_rules", userId, limit),
    async appendProposedVersion(input: unknown): Promise<Row> {
      const parsed = ruleContentSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return db.transaction(async (tx) => {
        await tx.query(`SELECT id FROM public.users WHERE id=$1 FOR UPDATE`, [userId]);
        const versionResult = await tx.query<{ version: number }>(
          `SELECT COALESCE(MAX(version),0)+1 AS version FROM public.playbook_rules WHERE user_id=$1`,
          [userId],
        );
        const inserted = await tx.query<Row>(
          `INSERT INTO public.playbook_rules (user_id,version,previous_rule_id,source_pattern_id,status,title,trigger,rule_text,rationale,user_decision,decided_at) VALUES($1,$2,$3,$4,'proposed',$5,$6,$7,$8,NULL,NULL) RETURNING *`,
          [
            userId,
            versionResult.rows[0].version,
            d.previousRuleId ?? null,
            d.sourcePatternId ?? null,
            d.title,
            d.trigger,
            d.ruleText,
            d.rationale,
          ],
        );
        return inserted.rows[0];
      });
    },
    async appendUserDecision(input: unknown): Promise<Row> {
      const parsed = ruleDecisionSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      const status = d.userDecision === "accepted" ? "active" : d.userDecision;
      return db.transaction(async (tx) => {
        await tx.query(`SELECT id FROM public.users WHERE id=$1 FOR UPDATE`, [userId]);
        const versionResult = await tx.query<{ version: number }>(
          `SELECT COALESCE(MAX(version),0)+1 AS version FROM public.playbook_rules WHERE user_id=$1`,
          [userId],
        );
        const inserted = await tx.query<Row>(
          `INSERT INTO public.playbook_rules (user_id,version,previous_rule_id,source_pattern_id,status,title,trigger,rule_text,rationale,user_decision,decided_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
          [
            userId,
            versionResult.rows[0].version,
            d.previousRuleId ?? null,
            d.sourcePatternId ?? null,
            status,
            d.title,
            d.trigger,
            d.ruleText,
            d.rationale,
            d.userDecision,
          ],
        );
        return inserted.rows[0];
      });
    },
  };

  const evidenceRecords = {
    get: (id: string) => getOwned<Row>(db, "evidence_records", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "evidence_records", userId, limit),
    async record(input: unknown): Promise<Row> {
      const parsed = recordEvidenceSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      const fkColumnByKind: Record<string, string> = {
        user_input: "decisionId",
        prior_decision: "decisionId",
        market_data: "contextSnapshotId",
        trade_data: "tradeId",
        source: "sourceId",
        prior_review: "reviewId",
        playbook_rule: "ruleId",
      };
      const expected = fkColumnByKind[d.kind];
      const fkValues = {
        decisionId: d.decisionId,
        contextSnapshotId: d.contextSnapshotId,
        tradeId: d.tradeId,
        sourceId: d.sourceId,
        reviewId: d.reviewId,
        ruleId: d.ruleId,
      } as Record<string, string | undefined>;
      for (const [key, value] of Object.entries(fkValues)) {
        if (key === expected && value === undefined) {
          throw new RepositoryError(`evidence kind '${d.kind}' requires ${key}`, "INVALID_INPUT");
        }
        if (key !== expected && value !== undefined) {
          throw new RepositoryError(`evidence kind '${d.kind}' must not set ${key}`, "INVALID_INPUT");
        }
      }
      return insertOwned<Row>(
        db,
        "evidence_records",
        [
          "user_id",
          "kind",
          "decision_id",
          "context_snapshot_id",
          "trade_id",
          "source_id",
          "review_id",
          "rule_id",
          "label",
          "observed_at",
        ],
        [
          userId,
          d.kind,
          d.decisionId ?? null,
          d.contextSnapshotId ?? null,
          d.tradeId ?? null,
          d.sourceId ?? null,
          d.reviewId ?? null,
          d.ruleId ?? null,
          d.label ?? null,
          d.observedAt ?? null,
        ],
      );
    },
  };

  const memoryEmbeddings = {
    get: (id: string) => getOwned<Row>(db, "memory_embeddings", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "memory_embeddings", userId, limit),
    async storeValidatedEmbedding(input: unknown): Promise<Row> {
      const parsed = storeEmbeddingSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      getEmbeddingConfig();
      const check = validateEmbedding(d.embedding);
      if (!check.valid) throw new RepositoryError(check.reason, "INVALID_INPUT");
      const fkColumn = ENTITY_FK_COLUMNS[d.entityType as EmbeddingEntityType];
      const fkValues: Record<string, string | null> = {
        decision_id: d.decisionId ?? null,
        review_id: d.reviewId ?? null,
        pattern_id: d.patternId ?? null,
        rule_id: d.ruleId ?? null,
      };
      for (const [key, value] of Object.entries(fkValues)) {
        if (key === fkColumn && value !== null && value !== d.entityId) {
          throw new RepositoryError(`${key} must equal entity_id for entity_type '${d.entityType}'`, "INVALID_INPUT");
        }
        if (key !== fkColumn && value !== null) {
          throw new RepositoryError(`entity_type '${d.entityType}' must not set ${key}`, "INVALID_INPUT");
        }
      }
      fkValues[fkColumn] = d.entityId;
      const sourceHash = computeSourceHash(d.sourceText);
      const inserted = await db.query<Row>(
        `INSERT INTO public.memory_embeddings (user_id,entity_type,entity_id,decision_id,review_id,pattern_id,rule_id,embedding,model,dimensions,source_text,source_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (user_id,entity_type,entity_id,model,dimensions,source_hash) DO NOTHING RETURNING *`,
        [
          userId,
          d.entityType,
          d.entityId,
          fkValues.decision_id,
          fkValues.review_id,
          fkValues.pattern_id,
          fkValues.rule_id,
          `[${d.embedding.join(",")}]`,
          d.model,
          d.dimensions,
          d.sourceText,
          sourceHash,
          d.metadata ?? {},
        ],
      );
      if (inserted.rows[0]) return inserted.rows[0];
      const existing = await db.query<Row>(
        `SELECT * FROM public.memory_embeddings WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3 AND model=$4 AND dimensions=$5 AND source_hash=$6 LIMIT 1`,
        [userId, d.entityType, d.entityId, d.model, d.dimensions, sourceHash],
      );
      if (!existing.rows[0]) {
        throw new RepositoryError("embedding dedupe lookup failed", "CONFLICT");
      }
      return existing.rows[0];
    },
    async findBySource(input: unknown): Promise<Row | null> {
      const parsed = z
        .strictObject({
          entityType: z.enum(["decision", "review", "pattern", "rule"]),
          entityId: z.string().uuid(),
          sourceText: z.string().min(1),
        })
        .safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const cfg = getEmbeddingConfig();
      const result = await db.query<Row>(
        `SELECT * FROM public.memory_embeddings WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3 AND model=$4 AND dimensions=$5 AND source_hash=$6 LIMIT 1`,
        [
          userId,
          parsed.data.entityType,
          parsed.data.entityId,
          cfg.model,
          cfg.dimensions,
          computeSourceHash(parsed.data.sourceText),
        ],
      );
      return result.rows[0] ?? null;
    },
    async searchByVector(input: unknown): Promise<Row[]> {
      const parsed = z
        .strictObject({
          embedding: z.array(z.number().finite()),
          model: z.string(),
          dimensions: z.number().int(),
          limit: z.number().optional(),
        })
        .safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const cfg = getEmbeddingConfig();
      const d = parsed.data;
      if (d.model !== cfg.model || d.dimensions !== cfg.dimensions) {
        throw new RepositoryError("embedding profile does not match the locked configuration", "INVALID_INPUT");
      }
      const check = validateEmbedding(d.embedding);
      if (!check.valid) throw new RepositoryError(check.reason, "INVALID_INPUT");
      const limit =
        d.limit === undefined || !Number.isFinite(d.limit) ? 10 : Math.max(1, Math.min(100, Math.trunc(d.limit)));
      const result = await db.query<Row>(
        `SELECT id,entity_type,entity_id,model,dimensions,source_hash,source_text,metadata,1-(embedding <=> $2::vector) AS similarity FROM public.memory_embeddings WHERE user_id=$1 AND model=$3 AND dimensions=$4 ORDER BY embedding <=> $2::vector,id LIMIT $5`,
        [userId, `[${d.embedding.join(",")}]`, d.model, d.dimensions, limit],
      );
      return result.rows;
    },
  };

  const providerConnections = {
    get: (id: string) => getOwned<Row>(db, "provider_connections", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "provider_connections", userId, limit),
    async record(input: unknown): Promise<Row> {
      const parsed = recordProviderConnectionSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      const config = d.config ?? {};
      assertNonSecretConfig(config);
      return insertOwned<Row>(
        db,
        "provider_connections",
        ["user_id", "provider", "external_subject", "status", "config"],
        [userId, d.provider, d.externalSubject ?? null, d.status, config],
      );
    },
  };

  const aiRuns = {
    get: (id: string) => getOwned<Row>(db, "ai_runs", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "ai_runs", userId, limit),
    async record(input: unknown): Promise<Row> {
      const parsed = recordAiRunSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      const d = parsed.data;
      return insertOwned<Row>(
        db,
        "ai_runs",
        ["user_id", "pipeline", "model", "prompt_version", "input_entity_ids", "status", "latency_ms", "token_usage", "validation_errors"],
        [
          userId,
          d.pipeline,
          d.model,
          d.promptVersion,
          d.inputEntityIds ?? null,
          d.status,
          d.latencyMs ?? null,
          d.tokenUsage ?? null,
          d.validationErrors == null ? null : JSON.stringify(d.validationErrors),
        ],
      );
    },
  };

  const decisionRevisions = {
    get: (id: string) => getOwned<Row>(db, "decision_revisions", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "decision_revisions", userId, limit),
  };

  const patternEvidence = {
    get: (id: string) => getOwned<Row>(db, "pattern_evidence", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "pattern_evidence", userId, limit),
    async link(input: unknown): Promise<Row> {
      const parsed = linkPatternEvidenceSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      return insertOwned<Row>(db, "pattern_evidence", ["user_id", "pattern_id", "evidence_id"], [userId, parsed.data.patternId, parsed.data.evidenceId]);
    },
  };

  const playbookRuleEvidence = {
    get: (id: string) => getOwned<Row>(db, "playbook_rule_evidence", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "playbook_rule_evidence", userId, limit),
    async link(input: unknown): Promise<Row> {
      const parsed = linkRuleEvidenceSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      return insertOwned<Row>(db, "playbook_rule_evidence", ["user_id", "rule_id", "evidence_id"], [userId, parsed.data.ruleId, parsed.data.evidenceId]);
    },
  };

  const reviewDimensionEvidence = {
    get: (id: string) => getOwned<Row>(db, "review_dimension_evidence", userId, id),
    list: (limit = 100) => listOwned<Row>(db, "review_dimension_evidence", userId, limit),
    async link(input: unknown): Promise<Row> {
      const parsed = linkDimensionEvidenceSchema.safeParse(input);
      if (!parsed.success) toValidationError(parsed.error);
      return insertOwned<Row>(
        db,
        "review_dimension_evidence",
        ["user_id", "dimension_id", "evidence_id"],
        [userId, parsed.data.dimensionId, parsed.data.evidenceId],
      );
    },
  };

  return {
    users,
    decisions,
    decisionRevisions,
    decisionOrigins,
    decisionSources,
    marketContextSnapshots,
    trades,
    tradeEvents,
    reviews,
    reviewDimensions,
    patterns,
    playbookRules,
    evidenceRecords,
    memoryEmbeddings,
    providerConnections,
    aiRuns,
    patternEvidence,
    playbookRuleEvidence,
    reviewDimensionEvidence,
  };
}
