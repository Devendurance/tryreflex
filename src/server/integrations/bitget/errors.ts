export type FailureCode = "UPSTREAM_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE" | "TIMEOUT";

export type AdapterResult =
  | { ok: true; payload: unknown }
  | { ok: false; code: FailureCode; message: string };

export const SAFE_MESSAGES: Record<FailureCode, string> = {
  UPSTREAM_UNAVAILABLE: "Market data provider is temporarily unavailable",
  INVALID_PROVIDER_RESPONSE: "Market data provider returned an unexpected response",
  TIMEOUT: "Market data provider request timed out",
};

export function fail(code: FailureCode): AdapterResult {
  return { ok: false, code, message: SAFE_MESSAGES[code] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MCP_REQUEST_TIMEOUT_CODE = -32001;

export function isTimeoutError(err: unknown): boolean {
  if (isRecord(err) && "code" in err && err.code === MCP_REQUEST_TIMEOUT_CODE) return true;
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
