import { createMcpCaller, McpCallError, type McpToolCaller } from "./mcp";
import { fail, isRecord, isTimeoutError, type AdapterResult } from "./errors";

export const SIGNAL_MCP_URL = "https://datahub.noxiaohao.com/mcp";
export const SENTIMENT_TOOL = "sentiment_index";

function mapThrownError(err: unknown): AdapterResult {
  if (err instanceof McpCallError) return fail(err.code);
  if (isTimeoutError(err)) return fail("TIMEOUT");
  return fail("UPSTREAM_UNAVAILABLE");
}

function extractSignalPayload(result: unknown): AdapterResult {
  if (!isRecord(result)) return fail("INVALID_PROVIDER_RESPONSE");
  if (result.isError === true) return fail("UPSTREAM_UNAVAILABLE");

  const content = result.content;
  if (!Array.isArray(content)) return fail("INVALID_PROVIDER_RESPONSE");
  const part = content.find((p) => isRecord(p) && p.type === "text" && typeof p.text === "string");
  const text = isRecord(part) && typeof part.text === "string" ? part.text : undefined;
  if (text === undefined || text.trim() === "") return fail("INVALID_PROVIDER_RESPONSE");

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail("INVALID_PROVIDER_RESPONSE");
  }
  if (!isRecord(payload)) return fail("INVALID_PROVIDER_RESPONSE");
  if (Object.keys(payload).some((k) => k.endsWith("_error"))) return fail("UPSTREAM_UNAVAILABLE");
  return { ok: true, payload };
}

export async function getCryptoSentiment(
  call: McpToolCaller = createMcpCaller(SIGNAL_MCP_URL),
): Promise<AdapterResult> {
  let result: unknown;
  try {
    result = await call(SENTIMENT_TOOL, { action: "current" });
  } catch (err) {
    return mapThrownError(err);
  }
  return extractSignalPayload(result);
}
