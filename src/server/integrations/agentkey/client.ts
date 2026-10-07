import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

export const AGENTKEY_MCP_URL = "https://api.agentkey.app/v1/mcp";
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 90000;
const CLOSE_TIMEOUT_MS = 5000;
const MAX_TOOL_RESULT_CHARS = 200000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type AgentKeyErrorCode =
  | "CONFIGURATION"
  | "AUTH"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "CAPABILITY_NOT_VERIFIED"
  | "INVALID_PROVIDER_RESPONSE";

export class AgentKeyError extends Error {
  readonly code: AgentKeyErrorCode;

  constructor(code: AgentKeyErrorCode, message: string) {
    super(message);
    this.name = "AgentKeyError";
    this.code = code;
  }
}

export interface AgentKeyToolSpec {
  name: string;
  inputSchema: Record<string, unknown> | null;
}

export interface AgentKeyRankedTool {
  name: string;
  summary: string | null;
  cost: Record<string, unknown> | string | number | null;
}

export interface AgentKeyToolDescriptor {
  name: string;
  params: Record<string, unknown>;
  cost: Record<string, unknown> | null;
  executeAs: { name: string };
}

export interface VerifiedContextPlan {
  name: string;
  purpose: "public_market_context";
  readOnly: true;
  params: Record<string, unknown>;
  paramsSchema: z.ZodType<Record<string, unknown>>;
  outputSchema: z.ZodType<unknown>;
}

export interface AgentKeyClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface Session {
  client: Client;
  signal: AbortSignal;
  remainingMs: () => number;
  isAuthFailed: () => boolean;
  isTimedOut: () => boolean;
  isOversized: () => boolean;
  close: () => Promise<void>;
}

function timeoutMsOption(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const descriptorSchema = z.looseObject({
  name: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  cost: z.record(z.string(), z.unknown()).optional(),
  execute_as: z.looseObject({ name: z.string().min(1) }),
});

function requestOptions(session: Session, signal?: AbortSignal) {
  const remaining = session.remainingMs();
  return {
    timeout: remaining,
    resetTimeoutOnProgress: false,
    maxTotalTimeout: remaining,
    signal: signal === undefined ? session.signal : AbortSignal.any([session.signal, signal]),
  };
}

async function openSession(apiKey: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Session> {
  const url = new URL(AGENTKEY_MCP_URL);
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let authFailed = false;
  let oversized = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    fetch: async (input, init) => {
      const response = await fetchImpl(input, {
        ...init,
        signal: AbortSignal.any([
          controller.signal,
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
      if (response.status === 401 || response.status === 403) authFailed = true;
      const length = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
        oversized = true;
        controller.abort();
        return response;
      }
      if (response.body === null) return response;
      const reader = response.body.getReader();
      let seen = 0;
      const limited = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              ctrl.close();
              return;
            }
            seen += value.byteLength;
            if (seen > MAX_RESPONSE_BYTES) {
              oversized = true;
              controller.abort();
              reader.cancel().catch(() => {});
              ctrl.error(new Error("response body exceeds limit"));
              return;
            }
            ctrl.enqueue(value);
          } catch (error) {
            ctrl.error(error);
          }
        },
        cancel() {
          reader.cancel().catch(() => {});
        },
      });
      return new Response(limited, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  const client = new Client({ name: "reflex-secondary-context", version: "0.1.0" });
  const close = async () => {
    clearTimeout(timer);
    controller.abort();
    let timer2: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.close(),
        new Promise<void>((resolve) => {
          timer2 = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        }),
      ]).catch(() => {});
    } finally {
      if (timer2 !== undefined) clearTimeout(timer2);
    }
  };
  const session: Session = {
    client,
    signal: controller.signal,
    remainingMs: () => Math.max(1, timeoutMs - (Date.now() - startedAt)),
    isAuthFailed: () => authFailed,
    isTimedOut: () => timedOut,
    isOversized: () => oversized,
    close,
  };
  try {
    await Promise.race([
      client.connect(transport, { timeout: timeoutMs }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new AgentKeyError("TIMEOUT", "agentkey connection timed out")),
        );
      }),
    ]);
  } catch (error) {
    await close();
    throw sessionError(error, session);
  }
  return session;
}

function sessionError(error: unknown, session: Session): AgentKeyError {
  if (session.isAuthFailed()) return new AgentKeyError("AUTH", "agentkey authentication failed");
  if (session.isOversized()) {
    return new AgentKeyError("INVALID_PROVIDER_RESPONSE", "provider response exceeds limit");
  }
  if (error instanceof AgentKeyError) return error;
  if (session.isTimedOut() || (error instanceof Error && error.name === "AbortError")) {
    return new AgentKeyError("TIMEOUT", "agentkey operation timed out");
  }
  return new AgentKeyError("UNAVAILABLE", "agentkey operation failed");
}

async function withSession<T>(
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  run: (session: Session) => Promise<T>,
): Promise<T> {
  const session = await openSession(apiKey, fetchImpl, timeoutMs);
  try {
    if (session.signal.aborted) throw new AgentKeyError("TIMEOUT", "agentkey operation timed out");
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(new AgentKeyError("TIMEOUT", "agentkey operation timed out"));
      session.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([run(session), aborted]);
    } finally {
      if (onAbort !== undefined) session.signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    throw sessionError(error, session);
  } finally {
    await session.close();
  }
}

function toolResultPayload(result: unknown): unknown {
  const record = isRecord(result) ? result : null;
  if (record === null) return null;
  if (record.isError === true) {
    throw new AgentKeyError("UNAVAILABLE", "provider returned a tool error");
  }
  if (record.structuredContent !== undefined) {
    if (JSON.stringify(record.structuredContent).length > MAX_TOOL_RESULT_CHARS) {
      throw new AgentKeyError("INVALID_PROVIDER_RESPONSE", "provider payload exceeds limit");
    }
    return record.structuredContent;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const entry = isRecord(item) ? item : null;
    if (entry !== null && entry.type === "text" && typeof entry.text === "string") {
      if (entry.text.length > MAX_TOOL_RESULT_CHARS) {
        throw new AgentKeyError("INVALID_PROVIDER_RESPONSE", "provider payload exceeds limit");
      }
      try {
        return JSON.parse(entry.text);
      } catch {
        return null;
      }
    }
  }
  return null;
}

const rankedToolSchema = z.looseObject({
  name: z.string().min(1),
  summary: z.string().optional(),
  cost: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]).optional(),
});

async function listToolNames(session: Session): Promise<Set<string>> {
  const listed = await session.client.listTools(undefined, requestOptions(session));
  const tools = Array.isArray(listed.tools) ? listed.tools : [];
  return new Set(tools.map((tool) => String(tool.name)));
}

async function describeInSession(session: Session, name: string): Promise<AgentKeyToolDescriptor> {
  const result = await session.client.callTool(
    { name: "describe_tool", arguments: { name } },
    undefined,
    requestOptions(session),
  );
  const payload = toolResultPayload(result);
  const descriptor = descriptorSchema.safeParse(payload);
  if (
    !descriptor.success ||
    descriptor.data.name !== name ||
    descriptor.data.execute_as.name !== descriptor.data.name
  ) {
    throw new AgentKeyError("INVALID_PROVIDER_RESPONSE", "describe_tool descriptor invalid");
  }
  return {
    name: descriptor.data.name,
    params: descriptor.data.params,
    cost: descriptor.data.cost ?? null,
    executeAs: { name: descriptor.data.execute_as.name },
  };
}

export interface AgentKeyClient {
  listCapabilities(): Promise<AgentKeyToolSpec[]>;
  discover(query: string): Promise<AgentKeyRankedTool[]>;
  describe(name: string): Promise<AgentKeyToolDescriptor>;
  executeVerified(plan: VerifiedContextPlan | null): Promise<unknown>;
}

export function createAgentKeyClient(options: AgentKeyClientOptions = {}): AgentKeyClient {
  const apiKey = options.apiKey ?? process.env.AGENTKEY_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = timeoutMsOption(options.timeoutMs);
  const discovered = new Set<string>();

  const requireKey = (): string => {
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new AgentKeyError("CONFIGURATION", "agentkey credential is not configured");
    }
    return apiKey;
  };

  return {
    async listCapabilities(): Promise<AgentKeyToolSpec[]> {
      const key = requireKey();
      return withSession(key, fetchImpl, timeoutMs, async (session) => {
        const listed = await session.client.listTools(undefined, requestOptions(session));
        const tools = Array.isArray(listed.tools) ? listed.tools : [];
        return tools.map((tool) => ({
          name: String(tool.name),
          inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : null,
        }));
      });
    },

    async discover(query: string): Promise<AgentKeyRankedTool[]> {
      const key = requireKey();
      const trimmed = typeof query === "string" ? query.trim() : "";
      if (trimmed.length === 0) throw new AgentKeyError("CONFIGURATION", "query is required");
      return withSession(key, fetchImpl, timeoutMs, async (session) => {
        const names = await listToolNames(session);
        if (!names.has("find_tools")) {
          throw new AgentKeyError(
            "CAPABILITY_NOT_VERIFIED",
            "find_tools is not advertised by the provider",
          );
        }
        const result = await session.client.callTool(
          { name: "find_tools", arguments: { q: trimmed } },
          undefined,
          requestOptions(session),
        );
        const payload = toolResultPayload(result);
        const items = Array.isArray(payload)
          ? payload
          : isRecord(payload) && Array.isArray(payload.tools)
            ? payload.tools
            : null;
        if (items === null) {
          throw new AgentKeyError("INVALID_PROVIDER_RESPONSE", "find_tools payload unrecognized");
        }
        const ranked: AgentKeyRankedTool[] = [];
        for (const item of items) {
          const parsed = rankedToolSchema.safeParse(item);
          if (!parsed.success) continue;
          discovered.add(parsed.data.name);
          ranked.push({
            name: parsed.data.name,
            summary: parsed.data.summary ?? null,
            cost: parsed.data.cost === undefined ? null : parsed.data.cost,
          });
        }
        return ranked;
      });
    },

    async describe(name: string): Promise<AgentKeyToolDescriptor> {
      const key = requireKey();
      if (!discovered.has(name)) {
        throw new AgentKeyError(
          "CAPABILITY_NOT_VERIFIED",
          "tool was not discovered by this client",
        );
      }
      return withSession(key, fetchImpl, timeoutMs, async (session) => {
        const names = await listToolNames(session);
        if (!names.has("describe_tool")) {
          throw new AgentKeyError(
            "CAPABILITY_NOT_VERIFIED",
            "describe_tool is not advertised by the provider",
          );
        }
        return describeInSession(session, name);
      });
    },

    async executeVerified(plan: VerifiedContextPlan | null): Promise<unknown> {
      const key = requireKey();
      if (
        plan === null ||
        plan.purpose !== "public_market_context" ||
        plan.readOnly !== true ||
        !discovered.has(plan.name)
      ) {
        throw new AgentKeyError(
          "CAPABILITY_NOT_VERIFIED",
          "no verified context plan is configured",
        );
      }
      const params = plan.paramsSchema.safeParse(plan.params);
      if (!params.success || !isDeepStrictEqual(params.data, plan.params)) {
        throw new AgentKeyError("CONFIGURATION", "verified plan parameters failed validation");
      }
      return withSession(key, fetchImpl, timeoutMs, async (session) => {
        const names = await listToolNames(session);
        if (!names.has("describe_tool") || !names.has("execute_tool")) {
          throw new AgentKeyError(
            "CAPABILITY_NOT_VERIFIED",
            "provider does not advertise the tool gateway",
          );
        }
        const descriptor = await describeInSession(session, plan.name);
        let descriptorParams: z.ZodType<unknown>;
        try {
          descriptorParams = z.fromJSONSchema(descriptor.params);
        } catch {
          throw new AgentKeyError(
            "CAPABILITY_NOT_VERIFIED",
            "descriptor params schema is unsupported",
          );
        }
        const twice = descriptorParams.safeParse(plan.params);
        if (!twice.success || !isDeepStrictEqual(twice.data, plan.params)) {
          throw new AgentKeyError(
            "INVALID_PROVIDER_RESPONSE",
            "parameters do not satisfy the descriptor schema",
          );
        }
        const result = await session.client.callTool(
          { name: "execute_tool", arguments: { name: plan.name, params: params.data } },
          undefined,
          requestOptions(session),
        );
        const payload = toolResultPayload(result);
        const output = plan.outputSchema.safeParse(payload);
        if (!output.success) {
          throw new AgentKeyError(
            "INVALID_PROVIDER_RESPONSE",
            "verified plan output failed validation",
          );
        }
        return output.data;
      });
    },
  };
}
