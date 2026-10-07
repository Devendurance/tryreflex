import { loadEnvConfig } from "@next/env";
import { z } from "zod";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { BitgetRestClient, buildTools, loadConfig, safeInvoke } = await import("@bitget-ai/bitget-agent-sdk");
  if (!process.env.BITGET_API_KEY || !process.env.BITGET_SECRET_KEY || !process.env.BITGET_PASSPHRASE) {
    console.log(JSON.stringify({ status: "blocked", category: "MISSING_BITGET_CREDENTIALS" }));
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({ modules: "trade", readOnly: true, paperTrading: false, surface: "intent", baseUrl: "https://api.bitget.com", timeoutMs: 15000, retry: { maxRetries: 0 } });
  const position = buildTools(config).find((tool) => tool.name === "position");
  if (!position || !config.readOnly || config.paperTrading) throw new Error("read-only surface unavailable");
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  const result = await safeInvoke(position, { action: "history", category: "USDT-FUTURES", startTime: String(startTime), endTime: String(endTime), limit: "20", view: "full" }, { config, client: new BitgetRestClient(config) });
  if (!result.ok) {
    const code = typeof result.error.code === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(result.error.code) ? result.error.code : null;
    console.log(JSON.stringify({ status: "failed", sdk: "3.3.1", readOnly: true, category: "USDT-FUTURES", daysRequested: 7, pageLimit: 20, errorType: result.error.type, providerCode: code }));
    process.exitCode = 1;
    return;
  }
  const payload = z.looseObject({ list: z.array(z.unknown()), cursor: z.string().nullable().optional() }).safeParse(result.data);
  if (!payload.success) {
    console.log(JSON.stringify({ status: "failed", sdk: "3.3.1", readOnly: true, category: "INVALID_PROVIDER_RESPONSE" }));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ status: "verified", sdk: "3.3.1", readOnly: true, operation: "getPositionsHistory", category: "USDT-FUTURES", daysRequested: 7, pageLimit: 20, tradesReturnedOnPage: payload.data.list.length, hasNextCursor: Boolean(payload.data.cursor), completeAccountHistory: false, imported: 0 }));
}

main().catch(() => {
  console.log(JSON.stringify({ status: "failed", category: "BITGET_READ_ONLY_VERIFICATION_FAILED" }));
  process.exitCode = 1;
});
