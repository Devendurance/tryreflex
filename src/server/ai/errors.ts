export type AIErrorCode =
  | "CONFIGURATION"
  | "PROVIDER"
  | "TRANSPORT"
  | "TIMEOUT"
  | "SCHEMA"
  | "GROUNDING"
  | "PERSISTENCE";

const SAFE_MESSAGES: Record<AIErrorCode, string> = {
  CONFIGURATION: "AI provider is not configured",
  PROVIDER: "the AI provider returned an unusable response",
  TRANSPORT: "the AI provider could not be reached",
  TIMEOUT: "the AI provider request timed out",
  SCHEMA: "the AI provider response did not match the required schema",
  GROUNDING: "the AI provider response was not grounded in the supplied evidence",
  PERSISTENCE: "the AI run could not be recorded",
};

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    readonly status?: number,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "AIError";
  }
}
