export type TradeErrorCode =
  | "CONFIGURATION"
  | "PROVIDER"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "PRIVATE_ACCOUNT_NOT_BOUND"
  | "PRIVATE_ACCOUNT_FORBIDDEN";

const SAFE_MESSAGES: Record<TradeErrorCode, string> = {
  CONFIGURATION: "the trade provider is not configured",
  PROVIDER: "the trade provider returned an unusable response",
  TIMEOUT: "the trade provider request timed out",
  UNSUPPORTED: "the trade record cannot be represented",
  NOT_FOUND: "the requested record was not found",
  CONFLICT: "the record conflicts with existing state",
  INVALID_INPUT: "the request failed validation",
  PRIVATE_ACCOUNT_NOT_BOUND: "the private account is not bound",
  PRIVATE_ACCOUNT_FORBIDDEN: "the private account does not belong to this subject",
};

export class TradeError extends Error {
  constructor(
    readonly code: TradeErrorCode,
    readonly providerCode?: string,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "TradeError";
  }
}

export function sanitizeProviderCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : undefined;
}
