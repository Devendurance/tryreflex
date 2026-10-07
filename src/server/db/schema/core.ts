import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const assetClassEnum = pgEnum("asset_class", ["crypto", "rtoken", "stock", "other"]);
export const decisionSideEnum = pgEnum("decision_side", ["long", "short", "watch"]);
export const decisionStatusEnum = pgEnum("decision_status", ["draft", "confirmed", "closed"]);
export const originLabelEnum = pgEnum("origin_label", [
  "original_research",
  "borrowed_conviction",
  "social_confirmation",
  "pure_impulse",
]);
export const originBasisEnum = pgEnum("origin_basis", ["inference", "user_confirmed"]);
export const sourceTypeEnum = pgEnum("source_type", [
  "news",
  "x",
  "telegram",
  "discord",
  "analyst",
  "friend",
  "research",
  "other",
]);
export const marketStateEnum = pgEnum("native_market_state", ["open", "closed", "unknown"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authProvider: text("auth_provider").notNull(),
    authSubject: text("auth_subject").notNull(),
    displayName: text("display_name"),
    baseCurrency: text("base_currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("users_auth_identity_unique").on(t.authProvider, t.authSubject)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    rawInput: text("raw_input").notNull(),
    structuredInference: jsonb("structured_inference"),
    confirmedSnapshot: jsonb("confirmed_snapshot"),
    assetSymbol: text("asset_symbol"),
    assetClass: assetClassEnum("asset_class"),
    side: decisionSideEnum("side"),
    status: decisionStatusEnum("status").notNull().default("draft"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decisions_user_id_id_unique").on(t.userId, t.id),
    check("decisions_raw_input_nonempty", sql`btrim(raw_input) <> ''`),
    check(
      "decisions_status_snapshot_check",
      sql`(status = 'draft' AND confirmed_snapshot IS NULL AND confirmed_at IS NULL) OR (status IN ('confirmed','closed') AND confirmed_snapshot IS NOT NULL AND confirmed_at IS NOT NULL)`,
    ),
    check(
      "decisions_confirmed_snapshot_object",
      sql`confirmed_snapshot IS NULL OR jsonb_typeof(confirmed_snapshot) = 'object'`,
    ),
    check(
      "decisions_structured_inference_object",
      sql`structured_inference IS NULL OR jsonb_typeof(structured_inference) = 'object'`,
    ),
  ],
);

export const decisionRevisions = pgTable(
  "decision_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decision_revisions_user_id_id_unique").on(t.userId, t.id),
    unique("decision_revisions_version_unique").on(t.userId, t.decisionId, t.version),
    foreignKey({
      name: "decision_revisions_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    check("decision_revisions_version_positive", sql`version > 0`),
    check("decision_revisions_snapshot_object", sql`jsonb_typeof(snapshot) = 'object'`),
  ],
);

export const decisionOrigins = pgTable(
  "decision_origins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    label: originLabelEnum("label").notNull(),
    explanation: text("explanation").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    basis: originBasisEnum("basis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decision_origins_user_id_id_unique").on(t.userId, t.id),
    unique("decision_origins_label_basis_unique").on(t.userId, t.decisionId, t.label, t.basis),
    foreignKey({
      name: "decision_origins_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    check("decision_origins_confidence_range", sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 1)`),
  ],
);

export const decisionSources = pgTable(
  "decision_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    label: text("label").notNull(),
    url: text("url"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decision_sources_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "decision_sources_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
  ],
);

export const marketContextSnapshots = pgTable(
  "market_context_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    provider: text("provider").notNull(),
    observedFacts: jsonb("observed_facts").notNull(),
    aiInference: jsonb("ai_inference"),
    provenance: jsonb("provenance").notNull(),
    nativeMarketState: marketStateEnum("native_market_state"),
    regime: text("regime"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("market_context_snapshots_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "market_context_snapshots_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    check("mcs_observed_facts_object", sql`jsonb_typeof(observed_facts) = 'object'`),
    check("mcs_ai_inference_object", sql`ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object'`),
    check("mcs_provenance_object", sql`jsonb_typeof(provenance) = 'object'`),
  ],
);
