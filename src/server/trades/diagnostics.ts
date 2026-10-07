const ERROR_TYPES = new Set(["ConfigError", "AuthenticationError", "RateLimitError", "ValidationError", "BitgetApiError", "NetworkError", "InternalError"]);

export interface BitgetDiagnosticError {
  type?: unknown;
  code?: unknown;
  message?: unknown;
  category?: unknown;
}

export function normalizeBitgetReadFailure(
  error: BitgetDiagnosticError,
  response: { status?: number; code?: string } | null,
  secrets: readonly string[] = [],
) {
  const rawCode = response?.code;
  const providerCode = typeof rawCode === "string" && /^\d{1,8}$/.test(rawCode) ? rawCode : null;
  const sdkCode = typeof error.code === "string" && /^\d{1,8}$/.test(error.code) ? error.code : null;
  const errorType = typeof error.type === "string" && ERROR_TYPES.has(error.type) ? error.type : "InternalError";
  let message = typeof error.message === "string" ? error.message : "Bitget read failed";
  for (const secret of secrets) {
    if (secret.length > 0) message = message.split(secret).join("[REDACTED]");
  }
  message = message.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  message = message.replace(/(?:ACCESS-KEY|ACCESS-SIGN|ACCESS-PASSPHRASE|api[_-]?key|secret|passphrase)\s*[:=]\s*["']?[^\s,"';}]+/gi, "[REDACTED]");
  message = message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);
  const classicMode = providerCode === "2524";
  const incompatibleClassicEndpoint = providerCode === "40085";
  const environmentMismatch = providerCode === "40099";
  return {
    errorType,
    httpStatus: response?.status ?? null,
    providerCode,
    sdkCode,
    safeMessage: message,
    credentialsAuthenticated: false,
    accountCompatibility: classicMode ? "not_unified_mode" : incompatibleClassicEndpoint ? "classic_endpoint_rejected_in_unified_mode" : "unproven",
    exchangeEnvironment: environmentMismatch ? "mismatch" : "unproven",
    needsUserAction: environmentMismatch || classicMode || incompatibleClassicEndpoint || errorType === "AuthenticationError" || errorType === "ConfigError",
  };
}
