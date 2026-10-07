import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { normalizeBitgetReadFailure } from "../src/server/trades/diagnostics";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { BitgetRestClient, buildTools, getOperation, riskLevelOf, loadConfig, safeInvoke } = await import("@bitget-ai/bitget-agent-sdk");
  const secretNames = ["BITGET_API_KEY", "BITGET_SECRET_KEY", "BITGET_PASSPHRASE"] as const;
  if (secretNames.some((name) => !process.env[name])) {
    console.log(JSON.stringify({ status: "blocked", category: "MISSING_BITGET_CREDENTIALS" }));
    process.exitCode = 1;
    return;
  }
  const secrets = secretNames.map((name) => process.env[name]!).filter(Boolean);
  const responses: { status: number; code?: string }[] = [];
  const config = loadConfig({ modules: "account,trade", readOnly: true, paperTrading: false, surface: "intent", baseUrl: "https://api.bitget.com", timeoutMs: 15000, retry: { maxRetries: 0 }, hooks: { onResponse: ({ status, code }) => { responses.push({ status, ...(typeof code === "string" ? { code } : {}) }); } } });
  const operation = getOperation("getAccountInfo");
  const tools = buildTools(config);
  const raw = tools.find((tool) => tool.name === "raw");
  const position = tools.find((tool) => tool.name === "position");
  if (!raw || !position || !config.readOnly || config.paperTrading || !operation || operation.isWrite || riskLevelOf(operation) !== "read" || operation.path !== "/api/v3/account/settings") throw new Error("read-only surface unavailable");
  const context = { config, client: new BitgetRestClient(config) };
  const accountParams = { operationId: "getAccountInfo", args: {} };
  const account = await safeInvoke(raw, accountParams, context);
  const report: Record<string, unknown> = { sdk: "3.3.1", readOnly: true, accountRequest: { operation: "getAccountInfo", method: "GET", path: operation.path, params: {} } };
  if (!account.ok) {
    report.status = "failed";
    report.account = normalizeBitgetReadFailure(account.error, responses.at(-1) ?? null, secrets);
    report.history = { status: "not_attempted", reason: "account_authentication_or_compatibility_unproven" };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const accountShape = z.looseObject({ accountMode: z.string().optional(), accountLevel: z.string().optional() }).safeParse(account.data);
  if (!accountShape.success) throw new Error("account response unusable");
  report.account = { status: "verified", credentialsAuthenticated: true, accountMode: accountShape.data.accountMode ?? null, accountLevel: accountShape.data.accountLevel ?? null, httpStatus: responses.at(-1)?.status ?? null };
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  const historyParams = { action: "history", category: "USDT-FUTURES", startTime: String(startTime), endTime: String(endTime), limit: "20", view: "full" };
  report.historyRequest = { operation: "getPositionsHistory", method: "GET", path: "/api/v3/position/history-position", params: historyParams };
  const result = await safeInvoke(position, historyParams, context);
  if (!result.ok) {
    report.status = "partial";
    report.history = normalizeBitgetReadFailure(result.error, responses.at(-1) ?? null, secrets);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const payload = z.looseObject({ list: z.array(z.unknown()), cursor: z.string().nullable().optional() }).safeParse(result.data);
  if (!payload.success) throw new Error("history response unusable");
  report.status = "verified";
  report.history = { status: "verified", tradesReturnedOnPage: payload.data.list.length, hasNextCursor: Boolean(payload.data.cursor), completeAccountHistory: false, imported: 0 };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(() => {
  console.log(JSON.stringify({ status: "failed", category: "BITGET_READ_ONLY_VERIFICATION_FAILED" }));
  process.exitCode = 1;
});
