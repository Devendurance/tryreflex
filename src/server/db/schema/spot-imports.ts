import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./core";

export const spotCsvImports = pgTable(
  "spot_csv_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    accountScope: text("account_scope").notNull(),
    sourceHash: text("source_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    sourceFilename: varchar("source_filename", { length: 255 }),
    orderCount: integer("order_count").notNull(),
    executionCount: integer("execution_count").notNull(),
    warnings: jsonb("warnings").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("spot_csv_imports_user_id_id_unique").on(t.userId, t.id),
    unique("spot_csv_imports_user_scope_hash_unique").on(t.userId, t.accountScope, t.sourceHash),
    check("spot_csv_imports_scope_check", sql`account_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check("spot_csv_imports_source_hash_check", sql`source_hash ~ '^[0-9a-f]{64}$'`),
    check("spot_csv_imports_parser_version_check", sql`parser_version = 'bitget_classic_spot_order_history.v1'`),
    check("spot_csv_imports_counts_check", sql`order_count BETWEEN 1 AND 1000 AND execution_count BETWEEN 0 AND 10000`),
    check("spot_csv_imports_warnings_check", sql`jsonb_typeof(warnings) = 'array'`),
  ],
);

export const spotActivities = pgTable(
  "spot_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    accountScope: text("account_scope").notNull(),
    exchange: text("exchange").notNull(),
    sourceKind: text("source_kind").notNull(),
    orderId: text("order_id").notNull(),
    identityHash: text("identity_hash").notNull(),
    baseAsset: text("base_asset").notNull(),
    quoteAsset: text("quote_asset").notNull(),
    tradingPair: text("trading_pair").notNull(),
    direction: text("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("spot_activities_user_id_id_unique").on(t.userId, t.id),
    unique("spot_activities_user_scope_order_unique").on(t.userId, t.accountScope, t.orderId),
    check("spot_activities_source_check", sql`exchange = 'bitget' AND source_kind = 'classic_spot_csv'`),
    check("spot_activities_scope_check", sql`account_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check("spot_activities_order_id_check", sql`order_id ~ '^[0-9]{1,80}$'`),
    check("spot_activities_direction_check", sql`direction IN ('buy','sell')`),
    check("spot_activities_identity_hash_check", sql`identity_hash ~ '^[0-9a-f]{64}$'`),
    check(
      "spot_activities_pair_check",
      sql`base_asset ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' AND quote_asset ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' AND base_asset <> quote_asset AND trading_pair = base_asset || '/' || quote_asset`,
    ),
  ],
);

export const spotExecutions = pgTable(
  "spot_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    activityId: uuid("activity_id").notNull(),
    executionKey: text("execution_key").notNull(),
    signature: text("signature").notNull(),
    occurrence: integer("occurrence").notNull(),
    timestampText: text("timestamp_text").notNull(),
    timezoneStatus: text("timezone_status").notNull(),
    price: numeric("price", { precision: 30, scale: 12 }).notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 12 }).notNull(),
    grossVolume: numeric("gross_volume", { precision: 30, scale: 12 }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 30, scale: 12 }).notNull(),
    feeCurrency: text("fee_currency").notNull(),
    reported: jsonb("reported").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("spot_executions_user_id_id_unique").on(t.userId, t.id),
    unique("spot_executions_user_activity_key_unique").on(t.userId, t.activityId, t.executionKey),
    unique("spot_executions_user_activity_sig_occ_unique").on(t.userId, t.activityId, t.signature, t.occurrence),
    foreignKey({
      name: "spot_executions_activity_fk",
      columns: [t.userId, t.activityId],
      foreignColumns: [spotActivities.userId, spotActivities.id],
    }).onDelete("restrict"),
    check("spot_executions_occurrence_check", sql`occurrence >= 1`),
    check("spot_executions_timezone_check", sql`timezone_status = 'unknown'`),
    check("spot_executions_amounts_check", sql`price > 0 AND quantity > 0 AND gross_volume > 0 AND fee_amount >= 0`),
    check("spot_executions_hash_check", sql`execution_key ~ '^[0-9a-f]{64}$' AND signature ~ '^[0-9a-f]{64}$'`),
    check("spot_executions_reported_check", sql`jsonb_typeof(reported) = 'array'`),
  ],
);

export const spotActivityEvents = pgTable(
  "spot_activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    activityId: uuid("activity_id").notNull(),
    importId: uuid("import_id"),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version"),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("spot_activity_events_user_id_id_unique").on(t.userId, t.id),
    unique("spot_activity_events_user_activity_type_version_unique").on(t.userId, t.activityId, t.eventType, t.eventVersion),
    unique("spot_activity_events_user_activity_import_type_unique").on(t.userId, t.activityId, t.importId, t.eventType),
    foreignKey({
      name: "spot_activity_events_activity_fk",
      columns: [t.userId, t.activityId],
      foreignColumns: [spotActivities.userId, spotActivities.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "spot_activity_events_import_fk",
      columns: [t.userId, t.importId],
      foreignColumns: [spotCsvImports.userId, spotCsvImports.id],
    }).onDelete("restrict"),
    check("spot_activity_events_type_check", sql`event_type IN ('source_snapshot','purpose_change')`),
    check(
      "spot_activity_events_shape_check",
      sql`(
        (event_type = 'source_snapshot' AND import_id IS NOT NULL AND event_version IS NULL) OR
        (event_type = 'purpose_change' AND import_id IS NULL AND event_version IS NOT NULL AND event_version >= 1)
      )`,
    ),
    check("spot_activity_events_data_check", sql`jsonb_typeof(data) = 'object'`),
    check(
      "spot_activity_events_snapshot_data_check",
      sql`event_type <> 'source_snapshot' OR COALESCE(data->>'parserVersion' = 'bitget_classic_spot_order_history.v1' AND data->>'sourceHash' ~ '^[0-9a-f]{64}$' AND jsonb_typeof(data->'order') = 'object' AND jsonb_typeof(data->'executionKeys') = 'array', false)`,
    ),
    check(
      "spot_activity_events_purpose_data_check",
      sql`event_type <> 'purpose_change' OR COALESCE(data->>'purpose' IN ('speculative_trade','payment_conversion','other_nontrading','unknown') AND data->>'basis' = 'user_declared' AND (data ? 'reason'), false)`,
    ),
  ],
);
