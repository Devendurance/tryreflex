import { sql } from "drizzle-orm";
import {
  boolean,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { decisions } from "./core";

export const tradeProviderEnum = pgEnum("trade_provider", ["bitget", "manual"]);
export const tradeSideEnum = pgEnum("trade_side", ["long", "short"]);
export const tradeEventTypeEnum = pgEnum("trade_event_type", ["entry", "exit", "add", "reduce", "fee", "other"]);
export const processClassEnum = pgEnum("process_classification", [
  "earned_win",
  "good_decision_bad_outcome",
  "lucky_escape",
  "deserved_loss",
]);
export const reviewDimensionEnum = pgEnum("review_dimension", [
  "research_quality",
  "context_awareness",
  "risk_discipline",
  "execution_quality",
  "behavioral_control",
]);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id"),
    provider: tradeProviderEnum("provider").notNull(),
    externalId: text("external_id"),
    symbol: text("symbol").notNull(),
    side: tradeSideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 12 }),
    entryPrice: numeric("entry_price", { precision: 30, scale: 12 }),
    exitPrice: numeric("exit_price", { precision: 30, scale: 12 }),
    fees: numeric("fees", { precision: 30, scale: 12 }).notNull().default("0"),
    realizedPnl: numeric("realized_pnl", { precision: 30, scale: 12 }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("trades_user_id_id_unique").on(t.userId, t.id),
    unique("trades_user_decision_id_unique").on(t.userId, t.decisionId, t.id),
    uniqueIndex("trades_external_id_unique")
      .on(t.userId, t.provider, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    foreignKey({
      name: "trades_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    check("trades_quantity_positive", sql`quantity > 0`),
    check("trades_entry_price_positive", sql`entry_price > 0`),
    check("trades_exit_price_positive", sql`exit_price IS NULL OR exit_price > 0`),
    check("trades_fees_nonnegative", sql`fees >= 0`),
    check("trades_closed_after_open", sql`closed_at IS NULL OR closed_at >= opened_at`),
    check(
      "trades_bitget_execution_required",
      sql`provider <> 'bitget' OR (quantity IS NOT NULL AND entry_price IS NOT NULL AND opened_at IS NOT NULL)`,
    ),
  ],
);

export const tradeEvents = pgTable(
  "trade_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tradeId: uuid("trade_id").notNull(),
    eventType: tradeEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    facts: jsonb("facts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("trade_events_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "trade_events_trade_fk",
      columns: [t.userId, t.tradeId],
      foreignColumns: [trades.userId, trades.id],
    }).onDelete("restrict"),
    check("trade_events_facts_object", sql`jsonb_typeof(facts) = 'object'`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    tradeId: uuid("trade_id").notNull(),
    version: integer("version").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    processClassification: processClassEnum("process_classification"),
    observedMetrics: jsonb("observed_metrics").notNull(),
    aiInference: jsonb("ai_inference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("reviews_user_id_id_unique").on(t.userId, t.id),
    unique("reviews_user_trade_version_unique").on(t.userId, t.tradeId, t.version),
    uniqueIndex("reviews_current_unique").on(t.userId, t.tradeId).where(sql`is_current`),
    foreignKey({
      name: "reviews_trade_fk",
      columns: [t.userId, t.tradeId],
      foreignColumns: [trades.userId, trades.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "reviews_decision_trade_fk",
      columns: [t.userId, t.decisionId, t.tradeId],
      foreignColumns: [trades.userId, trades.decisionId, trades.id],
    }).onDelete("restrict"),
    check("reviews_version_positive", sql`version > 0`),
    check("reviews_observed_metrics_object", sql`jsonb_typeof(observed_metrics) = 'object'`),
    check("reviews_ai_inference_object", sql`ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object'`),
  ],
);

export const reviewDimensions = pgTable(
  "review_dimensions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id").notNull(),
    dimension: reviewDimensionEnum("dimension").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }),
    explanation: text("explanation"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("review_dimensions_user_id_id_unique").on(t.userId, t.id),
    unique("review_dimensions_review_dimension_unique").on(t.userId, t.reviewId, t.dimension),
    foreignKey({
      name: "review_dimensions_review_fk",
      columns: [t.userId, t.reviewId],
      foreignColumns: [reviews.userId, reviews.id],
    }).onDelete("restrict"),
    check("review_dimensions_score_range", sql`score IS NULL OR (score >= 0 AND score <= 100)`),
    check("review_dimensions_confidence_range", sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 1)`),
  ],
);
