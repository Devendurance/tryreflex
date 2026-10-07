import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isTimeoutError } from "./errors";

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 90000;

export function mcpTimeoutMs(): number {
  const raw = process.env.MCP_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

export class McpCallError extends Error {
  readonly code: "UPSTREAM_UNAVAILABLE" | "TIMEOUT";

  constructor(code: "UPSTREAM_UNAVAILABLE" | "TIMEOUT", message: string) {
    super(message);
    this.name = "McpCallError";
    this.code = code;
  }
}

export type McpToolCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

const CLOSE_TIMEOUT_MS = 5000;

async function closeBounded(client: Client): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
      }),
    ]).catch(() => {});
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createMcpCaller(serverUrl: string, fetchImpl: typeof fetch = globalThis.fetch): McpToolCaller {
  const url = new URL(serverUrl);
  return async (tool, args) => {
    const timeoutMs = mcpTimeoutMs();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const transport = new StreamableHTTPClientTransport(url, {
      fetch: async (input, init) =>
        fetchImpl(input, {
          ...init,
          signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]),
        }),
    });
    const client = new Client({ name: "reflex-market-context", version: "0.1.0" });
    try {
      await client.connect(transport);
      return await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: timeoutMs,
        resetTimeoutOnProgress: false,
        maxTotalTimeout: timeoutMs,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut || isTimeoutError(err)) {
        throw new McpCallError("TIMEOUT", "mcp operation timed out");
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (timedOut) controller.abort();
      await closeBounded(client);
    }
  };
}
