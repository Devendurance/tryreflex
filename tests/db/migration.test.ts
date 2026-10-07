import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationsDir = join(process.cwd(), "drizzle");
const migrationFile = readdirSync(migrationsDir).find((f) => f.endsWith(".sql"));
const sqlText = readFileSync(join(migrationsDir, migrationFile as string), "utf8");

const OWNED_TABLES = [
  "decisions",
  "decision_revisions",
  "decision_origins",
  "decision_sources",
  "market_context_snapshots",
  "trades",
  "trade_events",
  "reviews",
  "review_dimensions",
  "patterns",
  "pattern_evidence",
  "playbook_rules",
  "playbook_rule_evidence",
  "memory_embeddings",
  "provider_connections",
  "ai_runs",
  "evidence_records",
  "review_dimension_evidence",
];

const APPEND_ONLY = [
  "decision_revisions",
  "decision_origins",
  "decision_sources",
  "market_context_snapshots",
  "trade_events",
  "playbook_rules",
  "evidence_records",
  "pattern_evidence",
  "playbook_rule_evidence",
  "review_dimension_evidence",
];

test("migration enables vector before any table or index", () => {
  assert.match(sqlText.trimStart(), /^CREATE EXTENSION IF NOT EXISTS "vector";/);
  assert.ok(sqlText.indexOf('CREATE EXTENSION IF NOT EXISTS "vector"') < sqlText.indexOf('CREATE TABLE "memory_embeddings"'));
});

test("every owned table gets an identity trigger", () => {
  for (const table of OWNED_TABLES) {
    assert.match(
      sqlText,
      new RegExp(`CREATE TRIGGER ${table}_identity BEFORE UPDATE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION reflex_preserve_identity\\(\\)`),
    );
  }
});

test("users gets the dedicated identity trigger", () => {
  assert.match(sqlText, /CREATE OR REPLACE FUNCTION reflex_preserve_user_identity\(\)/);
  assert.match(sqlText, /CREATE TRIGGER users_identity BEFORE UPDATE ON public\.users FOR EACH ROW EXECUTE FUNCTION reflex_preserve_user_identity\(\)/);
});

test("append-only tables get UPDATE OR DELETE guards", () => {
  for (const table of APPEND_ONLY) {
    assert.match(
      sqlText,
      new RegExp(`CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION reflex_append_only\\(\\)`),
    );
  }
  assert.match(sqlText, /CREATE TRIGGER decisions_snapshot BEFORE UPDATE OR DELETE ON public\.decisions/);
});

test("embedding entity check guards every branch against NULL", () => {
  const checkBlock = sqlText.match(/memory_embeddings_entity_check[^;]+/)?.[0] ?? "";
  assert.match(checkBlock, /decision_id IS NOT NULL AND decision_id = entity_id/);
  assert.match(checkBlock, /review_id IS NOT NULL AND review_id = entity_id/);
  assert.match(checkBlock, /pattern_id IS NOT NULL AND pattern_id = entity_id/);
  assert.match(checkBlock, /rule_id IS NOT NULL AND rule_id = entity_id/);
});

test("playbook decision branches require non-null user_decision", () => {
  const checkBlock = sqlText.match(/playbook_rules_status_decision_check[^;]+/)?.[0] ?? "";
  for (const decision of ["accepted", "rejected", "deferred"]) {
    assert.match(checkBlock, new RegExp(`user_decision IS NOT NULL AND user_decision = '${decision}'`));
  }
  assert.match(checkBlock, /status = 'proposed' AND user_decision IS NULL AND decided_at IS NULL/);
});

test("embedding column enforces norm, locked model, dimensions, and hash shape", () => {
  assert.match(sqlText, /memory_embeddings_nonzero_norm" CHECK \(vector_norm\(embedding\) > 0\)/);
  assert.match(sqlText, /memory_embeddings_model_check" CHECK \(model = 'jina-embeddings-v5-text-small'\)/);
  assert.match(sqlText, /memory_embeddings_dimensions_check" CHECK \(dimensions = 1024\)/);
  assert.match(sqlText, /memory_embeddings_source_hash_hex" CHECK \(source_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sqlText, /"embedding" vector\(1024\) NOT NULL/);
  assert.match(sqlText, /USING hnsw \("embedding" vector_cosine_ops\)/);
});

test("reviews tie decision to trade via three-column FK", () => {
  assert.match(
    sqlText,
    /FOREIGN KEY \("user_id","decision_id","trade_id"\) REFERENCES "public"\."trades"\("user_id","decision_id","id"\)/,
  );
});
