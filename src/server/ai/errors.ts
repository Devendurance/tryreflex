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

export type GroundingReason =
  | "UNKNOWN_EVIDENCE_ID"
  | "UNKNOWN_QUOTE_SELECTOR"
  | "QUOTE_NOT_EXACT"
  | "QUOTE_NOT_FROM_ALLOWED_SOURCE"
  | "OBSERVED_FACT_UNSUPPORTED"
  | "INFERENCE_MISSING_EVIDENCE"
  | "PLAN_DRIFT_EVIDENCE_MISMATCH"
  | "DUPLICATE_OR_CONTRADICTORY_EVIDENCE"
  | "UNASSESSED_DIMENSION_HAS_EVIDENCE"
  | "DECISION_TIME_CONTEXT_UNAVAILABLE"
  | "GENERIC_LESSON"
  | "PLAN_DRIFT_LESSON_NOT_SPECIFIC"
  | "RETROSPECTIVE_ATTRIBUTION_REQUIRED"
  | "UNSUPPORTED_FINANCIAL_CLAIM"
  | "UNSUPPORTED_RISK_ADHERENCE"
  | "INTERNAL_SELECTOR_IN_NARRATIVE"
  | "UNSUPPORTED_MOTIVE_CLAIM"
  | "UNSUPPORTED_EXECUTION_CLAIM"
  | "CLINICAL_CLAIM"
  | "MISSING_DIMENSION";

export interface GroundingDiagnostic {
  reason: GroundingReason;
  path: string;
  evidenceIds?: string[];
}

export function groundingFailure(reason: GroundingReason, path: string, evidenceIds: readonly string[] = []): never {
  const safeIds = evidenceIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  throw new AIError("GROUNDING", undefined, { reason, path, ...(safeIds.length ? { evidenceIds: [...new Set(safeIds)] } : {}) });
}

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    readonly status?: number,
    readonly grounding?: GroundingDiagnostic,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "AIError";
  }
}
