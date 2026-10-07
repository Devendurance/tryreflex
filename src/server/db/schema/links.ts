import {
  foreignKey,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { reviewDimensions } from "./trading";
import { patterns, playbookRules } from "./learning";
import { evidenceRecords } from "./evidence";

export const patternEvidence = pgTable(
  "pattern_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    patternId: uuid("pattern_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pattern_evidence_user_id_id_unique").on(t.userId, t.id),
    unique("pattern_evidence_pattern_evidence_unique").on(t.userId, t.patternId, t.evidenceId),
    foreignKey({
      name: "pattern_evidence_pattern_fk",
      columns: [t.userId, t.patternId],
      foreignColumns: [patterns.userId, patterns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pattern_evidence_evidence_fk",
      columns: [t.userId, t.evidenceId],
      foreignColumns: [evidenceRecords.userId, evidenceRecords.id],
    }).onDelete("restrict"),
  ],
);

export const playbookRuleEvidence = pgTable(
  "playbook_rule_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ruleId: uuid("rule_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("playbook_rule_evidence_user_id_id_unique").on(t.userId, t.id),
    unique("playbook_rule_evidence_rule_evidence_unique").on(t.userId, t.ruleId, t.evidenceId),
    foreignKey({
      name: "playbook_rule_evidence_rule_fk",
      columns: [t.userId, t.ruleId],
      foreignColumns: [playbookRules.userId, playbookRules.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "playbook_rule_evidence_evidence_fk",
      columns: [t.userId, t.evidenceId],
      foreignColumns: [evidenceRecords.userId, evidenceRecords.id],
    }).onDelete("restrict"),
  ],
);

export const reviewDimensionEvidence = pgTable(
  "review_dimension_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dimensionId: uuid("dimension_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("review_dimension_evidence_user_id_id_unique").on(t.userId, t.id),
    unique("review_dimension_evidence_dimension_evidence_unique").on(t.userId, t.dimensionId, t.evidenceId),
    foreignKey({
      name: "review_dimension_evidence_dimension_fk",
      columns: [t.userId, t.dimensionId],
      foreignColumns: [reviewDimensions.userId, reviewDimensions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "review_dimension_evidence_evidence_fk",
      columns: [t.userId, t.evidenceId],
      foreignColumns: [evidenceRecords.userId, evidenceRecords.id],
    }).onDelete("restrict"),
  ],
);
