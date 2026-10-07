import { z } from "zod";
import { createMcpCaller, McpCallError, type McpToolCaller } from "./mcp";
import { fail, isRecord, isTimeoutError, type AdapterResult } from "./errors";

export const STOCK_MCP_URL = "https://agent.bitget.com/mcp";
export const QUOTE_ENTRY_ID = "equity_price_quote";
export const HISTORY_ENTRY_ID = "equity_price_historical";

const dataEnvelopeSchema = z.looseObject({
  success: z.boolean(),
  status_code: z.number().int(),
  data: z.unknown(),
  error: z.string().nullable().optional(),
});

function mapThrownError(err: unknown): AdapterResult {
  if (err instanceof McpCallError) return fail(err.code);
  if (isTimeoutError(err)) return fail("TIMEOUT");
  return fail("UPSTREAM_UNAVAILABLE");
}

function extractTextContent(result: Record<string, unknown>): unknown {
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  const part = content.find((p) => isRecord(p) && p.type === "text" && typeof p.text === "string");
  return isRecord(part) ? part.text : undefined;
}

function extractDataEnvelope(result: unknown): AdapterResult {
  if (!isRecord(result)) return fail("INVALID_PROVIDER_RESPONSE");
  if (result.isError === true) return fail("UPSTREAM_UNAVAILABLE");

  let envelope: unknown = result.structuredContent;
  if (envelope === undefined) {
    const text = extractTextContent(result);
    if (typeof text !== "string" || text.trim() === "") return fail("INVALID_PROVIDER_RESPONSE");
    try {
      envelope = JSON.parse(text);
    } catch {
      return fail("INVALID_PROVIDER_RESPONSE");
    }
  }

  const parsed = dataEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) return fail("INVALID_PROVIDER_RESPONSE");
  const { success, status_code: statusCode, data } = parsed.data;
  if (!success || statusCode < 200 || statusCode > 299) {
    return fail("UPSTREAM_UNAVAILABLE");
  }
  return { ok: true, payload: data };
}

export async function getStockQuote(
  symbol: string,
  call: McpToolCaller = createMcpCaller(STOCK_MCP_URL),
): Promise<AdapterResult> {
  let result: unknown;
  try {
    result = await call("do_query", { entry_id: QUOTE_ENTRY_ID, params: { symbol } });
  } catch (err) {
    return mapThrownError(err);
  }
  return extractDataEnvelope(result);
}

export async function getStockHistory(
  symbol: string,
  startTime?: number,
  endTime?: number,
  call: McpToolCaller = createMcpCaller(STOCK_MCP_URL),
): Promise<AdapterResult> {
  const params: Record<string, unknown> = { symbol };
  if (startTime !== undefined) params.start_time = startTime;
  if (endTime !== undefined) params.end_time = endTime;
  let result: unknown;
  try {
    result = await call("do_query", { entry_id: HISTORY_ENTRY_ID, params });
  } catch (err) {
    return mapThrownError(err);
  }
  return extractDataEnvelope(result);
}
