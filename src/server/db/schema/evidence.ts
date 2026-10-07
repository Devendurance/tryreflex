import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users, decisions, decisionSources, marketContextSnapshots } from "./core";
import { trades, reviews } from "./trading";
import { playbookRules } from "./learning";

export const evidenceKindEnum = pgEnum("evidence_kind", [
  "user_input",
  "market_data",
  "trade_data",
  "source",
  "prior_decision",
  "prior_review",
  "playbook_rule",
]);

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: evidenceKindEnum("kind").notNull(),
    decisionId: uuid("decision_id"),
    contextSnapshotId: uuid("context_snapshot_id"),
    tradeId: uuid("trade_id"),
    sourceId: uuid("source_id"),
    reviewId: uuid("review_id"),
    ruleId: uuid("rule_id"),
    label: text("label"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("evidence_records_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "evidence_records_decision_fk",
      columns: [t.userId, t.decisionId],
      foreignColumns: [decisions.userId, decisions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_records_snapshot_fk",
      columns: [t.userId, t.contextSnapshotId],
      foreignColumns: [marketContextSnapshots.userId, marketContextSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_records_trade_fk",
      columns: [t.userId, t.tradeId],
      foreignColumns: [trades.userId, trades.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_records_source_fk",
      columns: [t.userId, t.sourceId],
      foreignColumns: [decisionSources.userId, decisionSources.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_records_review_fk",
      columns: [t.userId, t.reviewId],
      foreignColumns: [reviews.userId, reviews.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_records_rule_fk",
      columns: [t.userId, t.ruleId],
      foreignColumns: [playbookRules.userId, playbookRules.id],
    }).onDelete("restrict"),
    check(
      "evidence_records_kind_reference_check",
      sql`(
        (kind IN ('user_input','prior_decision') AND decision_id IS NOT NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'market_data' AND context_snapshot_id IS NOT NULL AND decision_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'trade_data' AND trade_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'source' AND source_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'prior_review' AND review_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND rule_id IS NULL) OR
        (kind = 'playbook_rule' AND rule_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL)
      )`,
    ),
  ],
);
