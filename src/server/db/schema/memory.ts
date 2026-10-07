import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { users, decisions } from "./core";
import { reviews } from "./trading";
import { patterns, playbookRules } from "./learning";

export const embeddingEntityEnum = pgEnum("embedding_entity_type", ["decision", "review", "pattern", "rule"]);
export const providerConnectionEnum = pgEnum("provider_connection_provider", [
  "bitget",
  "groq",
  "jina",
  "agentkey",
]);
export const providerConnectionStatusEnum = pgEnum("provider_connection_status", [
  "configured",
  "connected",
  "unavailable",
  "revoked",
]);
export const aiRunStatusEnum = pgEnum("ai_run_status", ["pending", "success", "failed"]);

export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    entityType: embeddingEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    decisionId: uuid("decision_id"),
    reviewId: uuid("review_id"),
    patternId: uuid("pattern_id"),
    ruleId: uuid("rule_id"),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    sourceText: text("source_text").notNull(),
    sourceHash: char("source_hash", { length: 64 }).notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memory_embeddings_user_id_id_unique").on(t.userId, t.id),
    unique("memory_embeddings_dedupe_unique").on(
      t.userId,
      t.entityType,
      t.entityId,
      t.model,
      t.dimensions,
      t.sourceHash,
    ),
    index("memory_embeddings_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    foreignKey({
      name: "memory_embeddings_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "memory_embeddings_review_fk",
      columns: [t.userId, t.reviewId],
      foreignColumns: [reviews.userId, reviews.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "memory_embeddings_pattern_fk",
      columns: [t.userId, t.patternId],
      foreignColumns: [patterns.userId, patterns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "memory_embeddings_rule_fk",
      columns: [t.userId, t.ruleId],
      foreignColumns: [playbookRules.userId, playbookRules.id],
    }).onDelete("restrict"),
    check(
      "memory_embeddings_entity_check",
      sql`(
        (entity_type = 'decision' AND decision_id IS NOT NULL AND decision_id = entity_id AND review_id IS NULL AND pattern_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'review' AND review_id IS NOT NULL AND review_id = entity_id AND decision_id IS NULL AND pattern_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'pattern' AND pattern_id IS NOT NULL AND pattern_id = entity_id AND decision_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'rule' AND rule_id IS NOT NULL AND rule_id = entity_id AND decision_id IS NULL AND review_id IS NULL AND pattern_id IS NULL)
      )`,
    ),
    check("memory_embeddings_nonzero_norm", sql`vector_norm(embedding) > 0`),
    check("memory_embeddings_model_check", sql`model = 'jina-embeddings-v5-text-small'`),
    check("memory_embeddings_dimensions_check", sql`dimensions = 1024`),
    check("memory_embeddings_source_hash_hex", sql`source_hash ~ '^[0-9a-f]{64}$'`),
    check("memory_embeddings_metadata_object", sql`jsonb_typeof(metadata) = 'object'`),
  ],
);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: providerConnectionEnum("provider").notNull(),
    externalSubject: text("external_subject"),
    status: providerConnectionStatusEnum("status").notNull(),
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("provider_connections_user_id_id_unique").on(t.userId, t.id),
    unique("provider_connections_user_provider_unique").on(t.userId, t.provider),
    check("provider_connections_config_object", sql`jsonb_typeof(config) = 'object'`),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pipeline: text("pipeline").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputEntityIds: uuid("input_entity_ids").array(),
    status: aiRunStatusEnum("status").notNull(),
    latencyMs: integer("latency_ms"),
    tokenUsage: jsonb("token_usage"),
    validationErrors: jsonb("validation_errors"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_runs_user_id_id_unique").on(t.userId, t.id),
    check("ai_runs_latency_nonnegative", sql`latency_ms IS NULL OR latency_ms >= 0`),
    check("ai_runs_token_usage_object", sql`token_usage IS NULL OR jsonb_typeof(token_usage) = 'object'`),
  ],
);
