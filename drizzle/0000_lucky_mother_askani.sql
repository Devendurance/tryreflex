CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('crypto', 'rtoken', 'stock', 'other');--> statement-breakpoint
CREATE TYPE "public"."decision_side" AS ENUM('long', 'short', 'watch');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('draft', 'confirmed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."native_market_state" AS ENUM('open', 'closed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."origin_basis" AS ENUM('inference', 'user_confirmed');--> statement-breakpoint
CREATE TYPE "public"."origin_label" AS ENUM('original_research', 'borrowed_conviction', 'social_confirmation', 'pure_impulse');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('news', 'x', 'telegram', 'discord', 'analyst', 'friend', 'research', 'other');--> statement-breakpoint
CREATE TYPE "public"."process_classification" AS ENUM('earned_win', 'good_decision_bad_outcome', 'lucky_escape', 'deserved_loss');--> statement-breakpoint
CREATE TYPE "public"."review_dimension" AS ENUM('research_quality', 'context_awareness', 'risk_discipline', 'execution_quality', 'behavioral_control');--> statement-breakpoint
CREATE TYPE "public"."trade_event_type" AS ENUM('entry', 'exit', 'add', 'reduce', 'fee', 'other');--> statement-breakpoint
CREATE TYPE "public"."trade_provider" AS ENUM('bitget', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."pattern_kind" AS ENUM('edge', 'leak', 'influence', 'regime', 'timing');--> statement-breakpoint
CREATE TYPE "public"."pattern_status" AS ENUM('observation', 'emerging', 'established');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('proposed', 'active', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."rule_user_decision" AS ENUM('accepted', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('user_input', 'market_data', 'trade_data', 'source', 'prior_decision', 'prior_review', 'playbook_rule');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."embedding_entity_type" AS ENUM('decision', 'review', 'pattern', 'rule');--> statement-breakpoint
CREATE TYPE "public"."provider_connection_provider" AS ENUM('bitget', 'groq', 'jina', 'agentkey');--> statement-breakpoint
CREATE TYPE "public"."provider_connection_status" AS ENUM('configured', 'connected', 'unavailable', 'revoked');--> statement-breakpoint
CREATE TABLE "decision_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"label" "origin_label" NOT NULL,
	"explanation" text NOT NULL,
	"confidence" numeric(5, 4),
	"basis" "origin_basis" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_origins_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "decision_origins_label_basis_unique" UNIQUE("user_id","decision_id","label","basis"),
	CONSTRAINT "decision_origins_confidence_range" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "decision_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_revisions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "decision_revisions_version_unique" UNIQUE("user_id","decision_id","version"),
	CONSTRAINT "decision_revisions_version_positive" CHECK (version > 0),
	CONSTRAINT "decision_revisions_snapshot_object" CHECK (jsonb_typeof(snapshot) = 'object')
);
--> statement-breakpoint
CREATE TABLE "decision_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"captured_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_sources_user_id_id_unique" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_input" text NOT NULL,
	"structured_inference" jsonb,
	"confirmed_snapshot" jsonb,
	"asset_symbol" text,
	"asset_class" "asset_class",
	"side" "decision_side",
	"status" "decision_status" DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "decisions_raw_input_nonempty" CHECK (btrim(raw_input) <> ''),
	CONSTRAINT "decisions_status_snapshot_check" CHECK ((status = 'draft' AND confirmed_snapshot IS NULL AND confirmed_at IS NULL) OR (status IN ('confirmed','closed') AND confirmed_snapshot IS NOT NULL AND confirmed_at IS NOT NULL)),
	CONSTRAINT "decisions_confirmed_snapshot_object" CHECK (confirmed_snapshot IS NULL OR jsonb_typeof(confirmed_snapshot) = 'object'),
	CONSTRAINT "decisions_structured_inference_object" CHECK (structured_inference IS NULL OR jsonb_typeof(structured_inference) = 'object')
);
--> statement-breakpoint
CREATE TABLE "market_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"observed_facts" jsonb NOT NULL,
	"ai_inference" jsonb,
	"provenance" jsonb NOT NULL,
	"native_market_state" "native_market_state",
	"regime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_context_snapshots_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "mcs_observed_facts_object" CHECK (jsonb_typeof(observed_facts) = 'object'),
	CONSTRAINT "mcs_ai_inference_object" CHECK (ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object'),
	CONSTRAINT "mcs_provenance_object" CHECK (jsonb_typeof(provenance) = 'object')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" text NOT NULL,
	"auth_subject" text NOT NULL,
	"display_name" text,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_identity_unique" UNIQUE("auth_provider","auth_subject")
);
--> statement-breakpoint
CREATE TABLE "review_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"dimension" "review_dimension" NOT NULL,
	"score" numeric(5, 2),
	"explanation" text,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_dimensions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "review_dimensions_review_dimension_unique" UNIQUE("user_id","review_id","dimension"),
	CONSTRAINT "review_dimensions_score_range" CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
	CONSTRAINT "review_dimensions_confidence_range" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"process_classification" "process_classification",
	"observed_metrics" jsonb NOT NULL,
	"ai_inference" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "reviews_user_trade_version_unique" UNIQUE("user_id","trade_id","version"),
	CONSTRAINT "reviews_version_positive" CHECK (version > 0),
	CONSTRAINT "reviews_observed_metrics_object" CHECK (jsonb_typeof(observed_metrics) = 'object'),
	CONSTRAINT "reviews_ai_inference_object" CHECK (ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object')
);
--> statement-breakpoint
CREATE TABLE "trade_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"event_type" "trade_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"facts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_events_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "trade_events_facts_object" CHECK (jsonb_typeof(facts) = 'object')
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid,
	"provider" "trade_provider" NOT NULL,
	"external_id" text,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"entry_price" numeric(30, 12) NOT NULL,
	"exit_price" numeric(30, 12),
	"fees" numeric(30, 12) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(30, 12),
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "trades_user_decision_id_unique" UNIQUE("user_id","decision_id","id"),
	CONSTRAINT "trades_quantity_positive" CHECK (quantity > 0),
	CONSTRAINT "trades_entry_price_positive" CHECK (entry_price > 0),
	CONSTRAINT "trades_exit_price_positive" CHECK (exit_price IS NULL OR exit_price > 0),
	CONSTRAINT "trades_fees_nonnegative" CHECK (fees >= 0),
	CONSTRAINT "trades_closed_after_open" CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "pattern_kind" NOT NULL,
	"status" "pattern_status" NOT NULL,
	"description" text NOT NULL,
	"observed_statistics" jsonb NOT NULL,
	"ai_inference" jsonb,
	"evidence_count" integer NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patterns_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "patterns_evidence_count_nonnegative" CHECK (evidence_count >= 0),
	CONSTRAINT "patterns_confidence_range" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
	CONSTRAINT "patterns_observed_statistics_object" CHECK (jsonb_typeof(observed_statistics) = 'object'),
	CONSTRAINT "patterns_ai_inference_object" CHECK (ai_inference IS NULL OR jsonb_typeof(ai_inference) = 'object')
);
--> statement-breakpoint
CREATE TABLE "playbook_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"previous_rule_id" uuid,
	"source_pattern_id" uuid,
	"status" "rule_status" NOT NULL,
	"title" text NOT NULL,
	"trigger" text NOT NULL,
	"rule_text" text NOT NULL,
	"rationale" text NOT NULL,
	"user_decision" "rule_user_decision",
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_rules_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "playbook_rules_version_unique" UNIQUE("user_id","version"),
	CONSTRAINT "playbook_rules_version_positive" CHECK (version > 0),
	CONSTRAINT "playbook_rules_status_decision_check" CHECK ((status = 'proposed' AND user_decision IS NULL AND decided_at IS NULL) OR (status = 'active' AND user_decision IS NOT NULL AND user_decision = 'accepted' AND decided_at IS NOT NULL) OR (status = 'rejected' AND user_decision IS NOT NULL AND user_decision = 'rejected' AND decided_at IS NOT NULL) OR (status = 'deferred' AND user_decision IS NOT NULL AND user_decision = 'deferred' AND decided_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"decision_id" uuid,
	"context_snapshot_id" uuid,
	"trade_id" uuid,
	"source_id" uuid,
	"review_id" uuid,
	"rule_id" uuid,
	"label" text,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_records_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "evidence_records_kind_reference_check" CHECK ((
        (kind IN ('user_input','prior_decision') AND decision_id IS NOT NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'market_data' AND context_snapshot_id IS NOT NULL AND decision_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'trade_data' AND trade_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND source_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'source' AND source_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (kind = 'prior_review' AND review_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND rule_id IS NULL) OR
        (kind = 'playbook_rule' AND rule_id IS NOT NULL AND decision_id IS NULL AND context_snapshot_id IS NULL AND trade_id IS NULL AND source_id IS NULL AND review_id IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "pattern_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pattern_evidence_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "pattern_evidence_pattern_evidence_unique" UNIQUE("user_id","pattern_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "playbook_rule_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_rule_evidence_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "playbook_rule_evidence_rule_evidence_unique" UNIQUE("user_id","rule_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "review_dimension_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_dimension_evidence_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "review_dimension_evidence_dimension_evidence_unique" UNIQUE("user_id","dimension_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pipeline" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_entity_ids" uuid[],
	"status" "ai_run_status" NOT NULL,
	"latency_ms" integer,
	"token_usage" jsonb,
	"validation_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "ai_runs_latency_nonnegative" CHECK (latency_ms IS NULL OR latency_ms >= 0),
	CONSTRAINT "ai_runs_token_usage_object" CHECK (token_usage IS NULL OR jsonb_typeof(token_usage) = 'object')
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" "embedding_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"decision_id" uuid,
	"review_id" uuid,
	"pattern_id" uuid,
	"rule_id" uuid,
	"embedding" vector(1024) NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"source_text" text NOT NULL,
	"source_hash" char(64) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_embeddings_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "memory_embeddings_dedupe_unique" UNIQUE("user_id","entity_type","entity_id","model","dimensions","source_hash"),
	CONSTRAINT "memory_embeddings_entity_check" CHECK ((
        (entity_type = 'decision' AND decision_id IS NOT NULL AND decision_id = entity_id AND review_id IS NULL AND pattern_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'review' AND review_id IS NOT NULL AND review_id = entity_id AND decision_id IS NULL AND pattern_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'pattern' AND pattern_id IS NOT NULL AND pattern_id = entity_id AND decision_id IS NULL AND review_id IS NULL AND rule_id IS NULL) OR
        (entity_type = 'rule' AND rule_id IS NOT NULL AND rule_id = entity_id AND decision_id IS NULL AND review_id IS NULL AND pattern_id IS NULL)
      )),
	CONSTRAINT "memory_embeddings_nonzero_norm" CHECK (vector_norm(embedding) > 0),
	CONSTRAINT "memory_embeddings_model_check" CHECK (model = 'jina-embeddings-v5-text-small'),
	CONSTRAINT "memory_embeddings_dimensions_check" CHECK (dimensions = 1024),
	CONSTRAINT "memory_embeddings_source_hash_hex" CHECK (source_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "memory_embeddings_metadata_object" CHECK (jsonb_typeof(metadata) = 'object')
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider_connection_provider" NOT NULL,
	"external_subject" text,
	"status" "provider_connection_status" NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connections_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "provider_connections_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "provider_connections_config_object" CHECK (jsonb_typeof(config) = 'object')
);
--> statement-breakpoint
ALTER TABLE "decision_origins" ADD CONSTRAINT "decision_origins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_origins" ADD CONSTRAINT "decision_origins_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_revisions" ADD CONSTRAINT "decision_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_revisions" ADD CONSTRAINT "decision_revisions_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_sources" ADD CONSTRAINT "decision_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_sources" ADD CONSTRAINT "decision_sources_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_context_snapshots" ADD CONSTRAINT "market_context_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_context_snapshots" ADD CONSTRAINT "market_context_snapshots_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimensions" ADD CONSTRAINT "review_dimensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimensions" ADD CONSTRAINT "review_dimensions_review_fk" FOREIGN KEY ("user_id","review_id") REFERENCES "public"."reviews"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_trade_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_decision_trade_fk" FOREIGN KEY ("user_id","decision_id","trade_id") REFERENCES "public"."trades"("user_id","decision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trade_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_previous_fk" FOREIGN KEY ("user_id","previous_rule_id") REFERENCES "public"."playbook_rules"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_pattern_fk" FOREIGN KEY ("user_id","source_pattern_id") REFERENCES "public"."patterns"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_snapshot_fk" FOREIGN KEY ("user_id","context_snapshot_id") REFERENCES "public"."market_context_snapshots"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_trade_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_source_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "public"."decision_sources"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_review_fk" FOREIGN KEY ("user_id","review_id") REFERENCES "public"."reviews"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_rule_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "public"."playbook_rules"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_evidence" ADD CONSTRAINT "pattern_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_evidence" ADD CONSTRAINT "pattern_evidence_pattern_fk" FOREIGN KEY ("user_id","pattern_id") REFERENCES "public"."patterns"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_evidence" ADD CONSTRAINT "pattern_evidence_evidence_fk" FOREIGN KEY ("user_id","evidence_id") REFERENCES "public"."evidence_records"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rule_evidence" ADD CONSTRAINT "playbook_rule_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rule_evidence" ADD CONSTRAINT "playbook_rule_evidence_rule_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "public"."playbook_rules"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_rule_evidence" ADD CONSTRAINT "playbook_rule_evidence_evidence_fk" FOREIGN KEY ("user_id","evidence_id") REFERENCES "public"."evidence_records"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimension_evidence" ADD CONSTRAINT "review_dimension_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimension_evidence" ADD CONSTRAINT "review_dimension_evidence_dimension_fk" FOREIGN KEY ("user_id","dimension_id") REFERENCES "public"."review_dimensions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimension_evidence" ADD CONSTRAINT "review_dimension_evidence_evidence_fk" FOREIGN KEY ("user_id","evidence_id") REFERENCES "public"."evidence_records"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_decision_fk" FOREIGN KEY ("user_id","decision_id") REFERENCES "public"."decisions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_review_fk" FOREIGN KEY ("user_id","review_id") REFERENCES "public"."reviews"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_pattern_fk" FOREIGN KEY ("user_id","pattern_id") REFERENCES "public"."patterns"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_rule_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "public"."playbook_rules"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_current_unique" ON "reviews" USING btree ("user_id","trade_id") WHERE is_current;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_external_id_unique" ON "trades" USING btree ("user_id","provider","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_embeddings_embedding_hnsw" ON "memory_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint

CREATE OR REPLACE FUNCTION reflex_preserve_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'immutable row identity' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reflex_preserve_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'decision records cannot be deleted' USING ERRCODE='23514'; END IF; IF NEW.raw_input IS DISTINCT FROM OLD.raw_input THEN RAISE EXCEPTION 'original decision input is immutable' USING ERRCODE='23514'; END IF; IF OLD.status IN ('confirmed','closed') AND (NEW.confirmed_snapshot IS DISTINCT FROM OLD.confirmed_snapshot OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.structured_inference IS DISTINCT FROM OLD.structured_inference OR NEW.asset_symbol IS DISTINCT FROM OLD.asset_symbol OR NEW.asset_class IS DISTINCT FROM OLD.asset_class OR NEW.side IS DISTINCT FROM OLD.side OR NEW.status='draft' OR (OLD.status='closed' AND NEW.status<>'closed')) THEN RAISE EXCEPTION 'confirmed decision requires a revision' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reflex_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'historical records are append-only' USING ERRCODE='23514'; END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reflex_preserve_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.auth_provider IS DISTINCT FROM OLD.auth_provider OR NEW.auth_subject IS DISTINCT FROM OLD.auth_subject THEN RAISE EXCEPTION 'immutable user identity' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;--> statement-breakpoint

CREATE TRIGGER users_identity BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION reflex_preserve_user_identity();--> statement-breakpoint
CREATE TRIGGER decisions_identity BEFORE UPDATE ON public.decisions FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER decision_revisions_identity BEFORE UPDATE ON public.decision_revisions FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER decision_origins_identity BEFORE UPDATE ON public.decision_origins FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER decision_sources_identity BEFORE UPDATE ON public.decision_sources FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER market_context_snapshots_identity BEFORE UPDATE ON public.market_context_snapshots FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER trades_identity BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER trade_events_identity BEFORE UPDATE ON public.trade_events FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER reviews_identity BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER review_dimensions_identity BEFORE UPDATE ON public.review_dimensions FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER patterns_identity BEFORE UPDATE ON public.patterns FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER pattern_evidence_identity BEFORE UPDATE ON public.pattern_evidence FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER playbook_rules_identity BEFORE UPDATE ON public.playbook_rules FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER playbook_rule_evidence_identity BEFORE UPDATE ON public.playbook_rule_evidence FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER memory_embeddings_identity BEFORE UPDATE ON public.memory_embeddings FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER provider_connections_identity BEFORE UPDATE ON public.provider_connections FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER ai_runs_identity BEFORE UPDATE ON public.ai_runs FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER evidence_records_identity BEFORE UPDATE ON public.evidence_records FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint
CREATE TRIGGER review_dimension_evidence_identity BEFORE UPDATE ON public.review_dimension_evidence FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity();--> statement-breakpoint

CREATE TRIGGER decisions_snapshot BEFORE UPDATE OR DELETE ON public.decisions FOR EACH ROW EXECUTE FUNCTION reflex_preserve_decision();--> statement-breakpoint

CREATE TRIGGER decision_revisions_append_only BEFORE UPDATE OR DELETE ON public.decision_revisions FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER decision_origins_append_only BEFORE UPDATE OR DELETE ON public.decision_origins FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER decision_sources_append_only BEFORE UPDATE OR DELETE ON public.decision_sources FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER market_context_snapshots_append_only BEFORE UPDATE OR DELETE ON public.market_context_snapshots FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER trade_events_append_only BEFORE UPDATE OR DELETE ON public.trade_events FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER playbook_rules_append_only BEFORE UPDATE OR DELETE ON public.playbook_rules FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER evidence_records_append_only BEFORE UPDATE OR DELETE ON public.evidence_records FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER pattern_evidence_append_only BEFORE UPDATE OR DELETE ON public.pattern_evidence FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER playbook_rule_evidence_append_only BEFORE UPDATE OR DELETE ON public.playbook_rule_evidence FOR EACH ROW EXECUTE FUNCTION reflex_append_only();--> statement-breakpoint
CREATE TRIGGER review_dimension_evidence_append_only BEFORE UPDATE OR DELETE ON public.review_dimension_evidence FOR EACH ROW EXECUTE FUNCTION reflex_append_only();