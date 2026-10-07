import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { getDatabaseUrls } from "../../src/server/db/config";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const client = new Client({ connectionString: getDatabaseUrls().unpooled, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  const userId = randomUUID();
  const decisionId = randomUUID();
  let inTransaction = false;
  await client.connect();
  try {
    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='trades' AND column_name=ANY($1::text[]) ORDER BY column_name",
      [["quantity", "entry_price", "opened_at"]],
    );
    assert.equal(columns.rows.length, 3);
    assert.ok(columns.rows.every((column) => column.is_nullable === "YES"));
    const constraint = await client.query<{ conname: string; definition: string }>(
      "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE conrelid='public.trades'::regclass AND conname='trades_bitget_execution_required'",
    );
    assert.equal(constraint.rows.length, 1);
    assert.ok(constraint.rows[0].definition.includes("IS NOT NULL"));
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("INSERT INTO public.users (id,auth_provider,auth_subject) VALUES($1,$2,$3)", [userId, "isolated-sparse-schema-test", userId]);
    await client.query(
      "INSERT INTO public.decisions (id,user_id,raw_input,status,confirmed_snapshot,confirmed_at,asset_symbol,asset_class,side) VALUES($1,$2,$3,'confirmed',$4,now(),'SCHEMA_TEST','crypto','long')",
      [decisionId, userId, "Isolated database constraint fixture, not a genuine trade or product seed", { assetSymbol: "SCHEMA_TEST", assetClass: "crypto", side: "long", origins: [], sources: [] }],
    );
    const manual = await client.query<{ quantity: string | null; entry_price: string | null; opened_at: Date | null; realized_pnl: string | null }>(
      "INSERT INTO public.trades (user_id,decision_id,provider,symbol,side,quantity,entry_price,opened_at,realized_pnl) VALUES($1,$2,'manual','SCHEMA_TEST','long',NULL,NULL,NULL,NULL) RETURNING quantity,entry_price,opened_at,realized_pnl",
      [userId, decisionId],
    );
    assert.deepEqual(manual.rows[0], { quantity: null, entry_price: null, opened_at: null, realized_pnl: null });
    await client.query("SAVEPOINT missing_import_execution");
    let importedRejected = false;
    try {
      await client.query(
        "INSERT INTO public.trades (user_id,decision_id,provider,symbol,side,quantity,entry_price,opened_at) VALUES($1,$2,'bitget','SCHEMA_TEST','long',NULL,NULL,NULL)",
        [userId, decisionId],
      );
    } catch (error) {
      importedRejected = typeof error === "object" && error !== null && "code" in error && error.code === "23514" && "constraint" in error && error.constraint === "trades_bitget_execution_required";
    }
    await client.query("ROLLBACK TO SAVEPOINT missing_import_execution");
    await client.query("RELEASE SAVEPOINT missing_import_execution");
    assert.equal(importedRejected, true);
    const imported = await client.query<{ quantity: string; entry_price: string; opened_at: Date }>(
      "INSERT INTO public.trades (user_id,decision_id,provider,symbol,side,quantity,entry_price,opened_at) VALUES($1,$2,'bitget','SCHEMA_TEST','long','1','1',now()) RETURNING quantity,entry_price,opened_at",
      [userId, decisionId],
    );
    assert.equal(imported.rows.length, 1);
    assert.ok(imported.rows[0].opened_at instanceof Date);
    await client.query("ROLLBACK");
    inTransaction = false;
    const remaining = await client.query<{ users: number; decisions: number; trades: number }>(
      "SELECT (SELECT count(*)::int FROM public.users WHERE id=$1) AS users,(SELECT count(*)::int FROM public.decisions WHERE user_id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE user_id=$1) AS trades",
      [userId],
    );
    assert.deepEqual(remaining.rows[0], { users: 0, decisions: 0, trades: 0 });
    console.log(JSON.stringify({ status: "verified", verificationPurpose: "isolated database constraint fixtures only, not genuine trade/autopsy proof", nullableManualColumns: columns.rows.map((column) => column.column_name), importedMissingExecutionRejected: true, importedExecutionRequirementsRetained: true, rollback: remaining.rows[0] }, null, 2));
  } finally {
    try {
      if (inTransaction) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}

main().catch(() => {
  console.log(JSON.stringify({ status: "failed", category: "SPARSE_DATABASE_INVARIANT_VERIFICATION_FAILED" }));
  process.exitCode = 1;
});
