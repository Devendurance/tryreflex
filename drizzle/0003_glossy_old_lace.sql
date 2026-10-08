CREATE TABLE "spot_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_scope" text NOT NULL,
	"exchange" text NOT NULL,
	"source_kind" text NOT NULL,
	"order_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"base_asset" text NOT NULL,
	"quote_asset" text NOT NULL,
	"trading_pair" text NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_activities_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "spot_activities_user_scope_order_unique" UNIQUE("user_id","account_scope","order_id"),
	CONSTRAINT "spot_activities_source_check" CHECK (exchange = 'bitget' AND source_kind = 'classic_spot_csv'),
	CONSTRAINT "spot_activities_scope_check" CHECK (account_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "spot_activities_order_id_check" CHECK (order_id ~ '^[0-9]{1,80}$'),
	CONSTRAINT "spot_activities_direction_check" CHECK (direction IN ('buy','sell')),
	CONSTRAINT "spot_activities_identity_hash_check" CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "spot_activities_pair_check" CHECK (base_asset ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' AND quote_asset ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' AND base_asset <> quote_asset AND trading_pair = base_asset || '/' || quote_asset)
);
--> statement-breakpoint
CREATE TABLE "spot_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"import_id" uuid,
	"event_type" text NOT NULL,
	"event_version" integer,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_activity_events_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "spot_activity_events_user_activity_type_version_unique" UNIQUE("user_id","activity_id","event_type","event_version"),
	CONSTRAINT "spot_activity_events_user_activity_import_type_unique" UNIQUE("user_id","activity_id","import_id","event_type"),
	CONSTRAINT "spot_activity_events_type_check" CHECK (event_type IN ('source_snapshot','purpose_change')),
	CONSTRAINT "spot_activity_events_shape_check" CHECK ((
        (event_type = 'source_snapshot' AND import_id IS NOT NULL AND event_version IS NULL) OR
        (event_type = 'purpose_change' AND import_id IS NULL AND event_version IS NOT NULL AND event_version >= 1)
      )),
	CONSTRAINT "spot_activity_events_data_check" CHECK (jsonb_typeof(data) = 'object'),
	CONSTRAINT "spot_activity_events_snapshot_data_check" CHECK (event_type <> 'source_snapshot' OR COALESCE(data->>'parserVersion' = 'bitget_classic_spot_order_history.v1' AND data->>'sourceHash' ~ '^[0-9a-f]{64}$' AND jsonb_typeof(data->'order') = 'object' AND jsonb_typeof(data->'executionKeys') = 'array', false)),
	CONSTRAINT "spot_activity_events_purpose_data_check" CHECK (event_type <> 'purpose_change' OR COALESCE(data->>'purpose' IN ('speculative_trade','payment_conversion','other_nontrading','unknown') AND data->>'basis' = 'user_declared' AND (data ? 'reason'), false))
);
--> statement-breakpoint
CREATE TABLE "spot_csv_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_scope" text NOT NULL,
	"source_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"source_filename" varchar(255),
	"order_count" integer NOT NULL,
	"execution_count" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_csv_imports_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "spot_csv_imports_user_scope_hash_unique" UNIQUE("user_id","account_scope","source_hash"),
	CONSTRAINT "spot_csv_imports_scope_check" CHECK (account_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "spot_csv_imports_source_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "spot_csv_imports_parser_version_check" CHECK (parser_version = 'bitget_classic_spot_order_history.v1'),
	CONSTRAINT "spot_csv_imports_counts_check" CHECK (order_count BETWEEN 1 AND 1000 AND execution_count BETWEEN 0 AND 10000),
	CONSTRAINT "spot_csv_imports_warnings_check" CHECK (jsonb_typeof(warnings) = 'array')
);
--> statement-breakpoint
CREATE TABLE "spot_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"execution_key" text NOT NULL,
	"signature" text NOT NULL,
	"occurrence" integer NOT NULL,
	"timestamp_text" text NOT NULL,
	"timezone_status" text NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"gross_volume" numeric(30, 12) NOT NULL,
	"fee_amount" numeric(30, 12) NOT NULL,
	"fee_currency" text NOT NULL,
	"reported" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_executions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "spot_executions_user_activity_key_unique" UNIQUE("user_id","activity_id","execution_key"),
	CONSTRAINT "spot_executions_user_activity_sig_occ_unique" UNIQUE("user_id","activity_id","signature","occurrence"),
	CONSTRAINT "spot_executions_occurrence_check" CHECK (occurrence >= 1),
	CONSTRAINT "spot_executions_timezone_check" CHECK (timezone_status = 'unknown'),
	CONSTRAINT "spot_executions_amounts_check" CHECK (price > 0 AND quantity > 0 AND gross_volume > 0 AND fee_amount >= 0),
	CONSTRAINT "spot_executions_hash_check" CHECK (execution_key ~ '^[0-9a-f]{64}$' AND signature ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "spot_executions_reported_check" CHECK (jsonb_typeof(reported) = 'array')
);
--> statement-breakpoint
ALTER TABLE "spot_activities" ADD CONSTRAINT "spot_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_activity_events" ADD CONSTRAINT "spot_activity_events_activity_fk" FOREIGN KEY ("user_id","activity_id") REFERENCES "public"."spot_activities"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_activity_events" ADD CONSTRAINT "spot_activity_events_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "public"."spot_csv_imports"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_csv_imports" ADD CONSTRAINT "spot_csv_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_executions" ADD CONSTRAINT "spot_executions_activity_fk" FOREIGN KEY ("user_id","activity_id") REFERENCES "public"."spot_activities"("user_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER spot_csv_imports_append_only BEFORE UPDATE OR DELETE ON public.spot_csv_imports FOR EACH ROW EXECUTE FUNCTION reflex_append_only();
--> statement-breakpoint
CREATE TRIGGER spot_activities_append_only BEFORE UPDATE OR DELETE ON public.spot_activities FOR EACH ROW EXECUTE FUNCTION reflex_append_only();
--> statement-breakpoint
CREATE TRIGGER spot_executions_append_only BEFORE UPDATE OR DELETE ON public.spot_executions FOR EACH ROW EXECUTE FUNCTION reflex_append_only();
--> statement-breakpoint
CREATE TRIGGER spot_activity_events_append_only BEFORE UPDATE OR DELETE ON public.spot_activity_events FOR EACH ROW EXECUTE FUNCTION reflex_append_only();
