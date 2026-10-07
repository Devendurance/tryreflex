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
import { users } from "./core";

export const patternKindEnum = pgEnum("pattern_kind", ["edge", "leak", "influence", "regime", "timing"]);
export const patternStatusEnum = pgEnum("pattern_status", ["observation", "emerging", "established"]);
export const ruleStatusEnum = pgEnum("rule_status", ["proposed", "active", "rejected", "deferred"]);
export const ruleUserDecisionEnum = pgEnum("rule_user_decision", ["accepted", "rejected", "deferred"]);

export const patterns = pgTable(
  "patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: patternKindEnum("kind").notNull(),
    status: patternStatusEnum("status").notNull(),
    description: text("description").notNull(),
    observedStatistics: jsonb("observed_statistics").notNull(),
    aiInference: jsonb("ai_inference"),
    evidenceCount: integer("evidence_count").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("patterns_user_id_id_unique").on(t.userId, t.id),
    check("patterns_evidence_count_nonnegative", sql`evidence_count >= 0`),
    check("patterns_confidence_range", sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 1)`),
    check("patterns_observed_statistics_object", sql`jsonb_typeof(observed_statistics) = 'object'`),
    check("patterns_ai_inference_object", sql`ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object'`),
  ],
);

export const playbookRules = pgTable(
  "playbook_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    previousRuleId: uuid("previous_rule_id"),
    sourcePatternId: uuid("source_pattern_id"),
    status: ruleStatusEnum("status").notNull(),
    title: text("title").notNull(),
    trigger: text("trigger").notNull(),
    ruleText: text("rule_text").notNull(),
    rationale: text("rationale").notNull(),
    userDecision: ruleUserDecisionEnum("user_decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("playbook_rules_user_id_id_unique").on(t.userId, t.id),
    unique("playbook_rules_version_unique").on(t.userId, t.version),
    foreignKey({
      name: "playbook_rules_previous_fk",
      columns: [t.userId, t.previousRuleId],
      foreignColumns: [t.userId, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "playbook_rules_pattern_fk",
      columns: [t.userId, t.sourcePatternId],
      foreignColumns: [patterns.userId, patterns.id],
    }).onDelete("restrict"),
    check("playbook_rules_version_positive", sql`version > 0`),
    check(
      "playbook_rules_status_decision_check",
      sql`(status = 'proposed' AND user_decision IS NULL AND decided_at IS NULL) OR (status = 'active' AND user_decision IS NOT NULL AND user_decision = 'accepted' AND decided_at IS NOT NULL) OR (status = 'rejected' AND user_decision IS NOT NULL AND user_decision = 'rejected' AND decided_at IS NOT NULL) OR (status = 'deferred' AND user_decision IS NOT NULL AND user_decision = 'deferred' AND decided_at IS NOT NULL)`,
    ),
  ],
);
