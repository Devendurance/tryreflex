import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { requireAuth } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, getDatabaseUrls, getEmbeddingConfig } from "../../src/server/db/config";
import { createRepositories } from "../../src/server/db/repositories";
import { computeSourceHash } from "../../src/server/db/validation";

const TABLES = [
  "users", "decisions", "decision_revisions", "decision_origins", "decision_sources",
  "market_context_snapshots", "trades", "trade_events", "reviews", "review_dimensions",
  "patterns", "pattern_evidence", "playbook_rules", "playbook_rule_evidence",
  "memory_embeddings", "provider_connections", "ai_runs", "evidence_records", "review_dimension_evidence",
];

async function main() {
  loadEnvConfig(process.cwd());
  getEmbeddingConfig();
  const client = new Client({ connectionString: getDatabaseUrls().unpooled, ssl: { rejectUnauthorized: true } });
  let inTransaction = false;
  let sequence = 0;
  const verified: string[] = [];
  const userA = randomUUID();
  const userB = randomUUID();
  const report: Record<string, unknown> = {};
  await client.connect();
  try {
    const extension = await client.query("SELECT extname,extversion FROM pg_catalog.pg_extension WHERE extname='vector'");
    assert.equal(extension.rows.length, 1, "vector extension missing");
    report.extension = extension.rows[0];
    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY($1::text[]) ORDER BY table_name",
      [TABLES],
    );
    assert.deepEqual(tables.rows.map((r) => r.table_name), [...TABLES].sort());
    report.tables = tables.rows.map((r) => r.table_name);
    const vectorType = await client.query<{ type: string }>(
      "SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) AS type FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.memory_embeddings'::regclass AND a.attname='embedding' AND NOT a.attisdropped",
    );
    assert.equal(vectorType.rows[0]?.type, "vector(1024)");
    report.vectorColumn = vectorType.rows[0].type;
    const indexes = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='memory_embeddings' AND indexname='memory_embeddings_embedding_hnsw'",
    );
    assert.equal(indexes.rows.length, 1);
    assert.match(indexes.rows[0].indexdef, /USING hnsw .*vector_cosine_ops/);
    report.vectorIndex = "hnsw/vector_cosine_ops";
    const triggers = await client.query<{ table_name: string; trigger_name: string }>(
      "SELECT c.relname AS table_name,t.tgname AS trigger_name FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY($1::text[]) ORDER BY c.relname,t.tgname",
      [TABLES],
    );
    for (const table of TABLES) {
      assert.ok(triggers.rows.some((r) => r.table_name === table && r.trigger_name === `${table}_identity`), `${table} identity trigger missing`);
    }
    assert.ok(triggers.rows.some((r) => r.trigger_name === "decisions_snapshot"));
    report.identityTriggers = "present for all 19 tables";
    const migrations = await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    assert.ok(migrations.rows.length > 0, "migration journal empty");
    report.appliedMigrations = migrations.rows.length;

    await client.query("BEGIN");
    inTransaction = true;
    const session: DbSession = {
      async query<T>(text: string, values?: readonly unknown[]) {
        const result = await client.query(text, values ? [...values] : undefined);
        return { rows: result.rows as T[] };
      },
      async transaction<T>(fn: (q: Queryable) => Promise<T>) {
        const savepoint = `repository_test_${++sequence}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const value = await fn(session);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          return value;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        }
      },
    };
    const authA = await requireAuth({ getContext: async () => ({ userId: userA, provider: "isolated-rollback-test", subject: userA }) });
    const authB = await requireAuth({ getContext: async () => ({ userId: userB, provider: "isolated-rollback-test", subject: userB }) });
    const reposA = createRepositories(session, authA);
    const reposB = createRepositories(session, authB);
    await reposA.users.provision();
    await reposB.users.provision();

    async function expectConstraint(name: string, sql: string, params: unknown[], code: string) {
      const savepoint = `constraint_test_${++sequence}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      let actualCode: unknown;
      try {
        await client.query(sql, params);
      } catch (error) {
        actualCode = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      assert.equal(actualCode, code, name);
      verified.push(name);
    }

    const rawInput = "  TEST ONLY, isolated decision input\n";
    const draft = await reposA.decisions.createDraft({ rawInput, structuredInference: { testOnly: true } });
    const decisionId = draft.id as string;
    await reposA.decisions.applyInference(decisionId, {
      structuredInference: { testOnly: true },
      assetSymbol: "TEST",
      assetClass: "other",
      side: "watch",
      origins: [{ label: "pure_impulse", explanation: "test-only model suggestion", confidence: 0.9, observedInputFacts: ["TEST ONLY"] }],
      evidenceQuotes: [],
      sources: [],
    });
    const snapshot = { assetSymbol: "TEST", assetClass: "other", side: "watch", origins: ["social_confirmation"], sources: [] };
    await reposA.decisions.confirm(decisionId, snapshot);
    const originRows = async () =>
      (await client.query<{ label: string; basis: string; confidence: string | null; explanation: string }>(
        "SELECT label,basis,confidence,explanation FROM public.decision_origins WHERE user_id=$1 AND decision_id=$2 ORDER BY basis,label",
        [userA, decisionId],
      )).rows;
    const afterConfirm = await originRows();
    assert.deepEqual(afterConfirm.map((r) => [r.label, r.basis]), [["pure_impulse", "inference"], ["social_confirmation", "user_confirmed"]]);
    assert.equal(afterConfirm[1].confidence, null);
    assert.equal(afterConfirm[1].explanation, "Explicitly selected by the user during confirmation.");
    assert.equal(Number(afterConfirm[0].confidence), 0.9);
    const repeat = await reposA.decisions.confirm(decisionId, snapshot);
    assert.equal(repeat.idempotent, true);
    verified.push("confirm records user_confirmed origins beside untouched inference; repeat is idempotent");
    await reposA.decisions.appendRevision(decisionId, { snapshot: { ...snapshot, origins: ["pure_impulse"], thesis: "test revision" }, reason: "isolated rollback verification" });
    assert.deepEqual(await originRows(), afterConfirm);
    verified.push("later revision leaves original origin provenance unchanged");
    const atomicDraft = await reposA.decisions.createDraft({ rawInput: "atomic origin rollback test" });
    const atomicId = atomicDraft.id as string;
    await client.query("INSERT INTO public.decision_origins (user_id,decision_id,label,explanation,confidence,basis) VALUES($1,$2,'original_research','pre-existing conflict',NULL,'user_confirmed')", [userA, atomicId]);
    await assert.rejects(() => reposA.decisions.confirm(atomicId, { ...snapshot, origins: ["original_research"] }));
    const atomic = await reposA.decisions.get(atomicId);
    assert.equal(atomic?.status, "draft");
    assert.equal(atomic?.confirmed_snapshot, null);
    assert.equal((await client.query("SELECT 1 FROM public.decision_revisions WHERE user_id=$1 AND decision_id=$2", [userA, atomicId])).rows.length, 0);
    verified.push("origin insert failure rolls back confirmation and revision");
    await assert.rejects(() => reposB.decisions.confirm(decisionId, snapshot), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
    verified.push("foreign-owner confirmation denied");
    const preserved = await reposA.decisions.get(decisionId);
    assert.equal(preserved?.raw_input, rawInput);
    assert.deepEqual(preserved?.confirmed_snapshot, snapshot);
    const revisions = await reposA.decisionRevisions.list();
    assert.deepEqual(revisions.map((r) => r.version).sort(), [1, 2]);
    verified.push("repository confirm/revision preserves original snapshot and input");
    assert.equal(await reposB.decisions.get(decisionId), null);
    assert.equal(await reposA.users.get(userB), null);
    verified.push("repository reads are owner-scoped");

    await expectConstraint("confirmed snapshot mutation rejected", "UPDATE public.decisions SET confirmed_snapshot=$3 WHERE user_id=$1 AND id=$2", [userA, decisionId, { changed: true }], "23514");
    await expectConstraint("original raw input mutation rejected", "UPDATE public.decisions SET raw_input=$3 WHERE user_id=$1 AND id=$2", [userA, decisionId, "changed"], "23514");
    await expectConstraint("revision mutation rejected", "UPDATE public.decision_revisions SET reason='changed' WHERE user_id=$1 AND decision_id=$2", [userA, decisionId], "23514");
    await expectConstraint("user identity mutation rejected", "UPDATE public.users SET auth_subject=$2 WHERE id=$1", [userA, "changed"], "23514");
    await expectConstraint("cross-owner decision reference rejected", "INSERT INTO public.decision_origins (user_id,decision_id,label,explanation,basis) VALUES($1,$2,'pure_impulse','test only','user_confirmed')", [userB, decisionId], "23503");

    const second = await reposA.decisions.createDraft({ rawInput: "second isolated test decision" });
    const secondId = second.id as string;
    const trade = await reposA.trades.record({ decisionId, provider: "manual", symbol: "TEST", side: "long", quantity: "1", entryPrice: "9007199254740993.000000000001", openedAt: "2026-01-01T00:00:00Z" });
    assert.equal(trade.entry_price, "9007199254740993.000000000001");
    verified.push("exact decimal trade persistence");
    await expectConstraint("review decision must match trade", "INSERT INTO public.reviews (user_id,decision_id,trade_id,version,observed_metrics) VALUES($1,$2,$3,1,'{}'::jsonb)", [userA, secondId, trade.id], "23503");
    const review = await reposA.reviews.append({ decisionId, tradeId: trade.id, version: 1, observedMetrics: { testOnly: true } });
    await expectConstraint("only one current review per trade", "INSERT INTO public.reviews (user_id,decision_id,trade_id,version,observed_metrics) VALUES($1,$2,$3,2,'{}'::jsonb)", [userA, decisionId, trade.id], "23505");
    assert.equal(review.trade_id, trade.id);

    const evidence = await reposA.evidenceRecords.record({ kind: "user_input", decisionId, label: "isolated test input" });
    await expectConstraint("evidence kind must match real entity", "INSERT INTO public.evidence_records (user_id,kind,decision_id) VALUES($1,'trade_data',$2)", [userA, decisionId], "23514");
    const pattern = await reposA.patterns.record({ kind: "edge", status: "observation", description: "isolated test only", observedStatistics: {}, evidenceCount: 0 });
    await reposA.patternEvidence.link({ patternId: pattern.id, evidenceId: evidence.id });
    await expectConstraint("nonexistent evidence reference rejected", "INSERT INTO public.pattern_evidence (user_id,pattern_id,evidence_id) VALUES($1,$2,$3)", [userA, pattern.id, randomUUID()], "23503");

    const ruleContent = { title: "test only", trigger: "test only", ruleText: "test only", rationale: "isolated transaction" };
    const proposal = await reposA.playbookRules.appendProposedVersion(ruleContent);
    const accepted = await reposA.playbookRules.appendUserDecision({ ...ruleContent, previousRuleId: proposal.id, userDecision: "accepted" });
    assert.equal(proposal.version, 1);
    assert.equal(accepted.version, 2);
    assert.equal(accepted.status, "active");
    assert.equal((await reposA.playbookRules.get(proposal.id as string))?.status, "proposed");
    verified.push("playbook user acceptance appends version without altering proposal");
    await expectConstraint("playbook mutation rejected", "UPDATE public.playbook_rules SET rule_text='changed' WHERE user_id=$1 AND id=$2", [userA, accepted.id], "23514");
    await expectConstraint("active rule requires explicit user decision", "INSERT INTO public.playbook_rules (user_id,version,status,title,trigger,rule_text,rationale,decided_at) VALUES($1,3,'active','test','test','test','test',now())", [userA], "23514");

    const firstVector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === 0 ? 1 : 0);
    const secondVector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === 1 ? 1 : 0);
    const vectorLiteral = `[${firstVector.join(",")}]`;
    const memoryInput = { entityType: "decision", entityId: decisionId, embedding: firstVector, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, sourceText: "isolated test vector, not a Jina result" };
    const memory = await reposA.memoryEmbeddings.storeValidatedEmbedding(memoryInput);
    const duplicate = await reposA.memoryEmbeddings.storeValidatedEmbedding(memoryInput);
    assert.equal(duplicate.id, memory.id);
    await reposA.memoryEmbeddings.storeValidatedEmbedding({ ...memoryInput, entityId: secondId, embedding: secondVector, sourceText: "second isolated test vector, not a Jina result" });
    const search = await client.query<{ entity_id: string; dimensions: number; distance: number }>(
      "SELECT entity_id,vector_dims(embedding) AS dimensions,(embedding <=> $1::vector) AS distance FROM public.memory_embeddings WHERE user_id=$2 AND model=$3 AND dimensions=$4 ORDER BY embedding <=> $1::vector,entity_id LIMIT 2",
      [vectorLiteral, userA, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS],
    );
    assert.equal(search.rows.length, 2);
    assert.equal(search.rows[0].entity_id, decisionId);
    assert.equal(search.rows[0].dimensions, EMBEDDING_DIMENSIONS);
    assert.ok(Math.abs(search.rows[0].distance) < 1e-6);
    assert.equal(search.rows[1].entity_id, secondId);
    assert.ok(Math.abs(search.rows[1].distance - 1) < 1e-6);
    verified.push("pgvector 1024-dimensional storage, dedupe and owner-filtered cosine search using test vectors");
    await expectConstraint("mixed embedding model rejected", "UPDATE public.memory_embeddings SET model='incompatible-test-model' WHERE user_id=$1 AND id=$2", [userA, memory.id], "23514");
    await expectConstraint("mixed embedding dimensions rejected", "UPDATE public.memory_embeddings SET dimensions=512 WHERE user_id=$1 AND id=$2", [userA, memory.id], "23514");
    await expectConstraint("zero-norm embedding rejected", "UPDATE public.memory_embeddings SET embedding=$3::vector WHERE user_id=$1 AND id=$2", [userA, memory.id, `[${new Array(1024).fill(0).join(",")}]`], "23514");
    await expectConstraint("embedding requires matching entity FK, not NULL", "INSERT INTO public.memory_embeddings (user_id,entity_type,entity_id,embedding,model,dimensions,source_text,source_hash,metadata) VALUES($1,'decision',$2,$3::vector,$4,1024,$5,$6,'{}'::jsonb)", [userA, decisionId, vectorLiteral, EMBEDDING_MODEL, "missing FK test", computeSourceHash("missing FK test")], "23514");

    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query("SELECT id FROM public.users WHERE id=ANY($1::uuid[])", [[userA, userB]]);
    assert.equal(remaining.rows.length, 0, "rollback left test users behind");
    report.rollbackVerified = true;
    report.invariantChecks = verified;
    report.embeddingProviderCall = "not performed; vectors were isolated test fixtures rolled back";
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (inTransaction) await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((error: unknown) => {
  const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "verification_failed";
  console.error(`Database integration verification failed (${code}). No credentials or provider payloads logged.`);
  process.exitCode = 1;
});
