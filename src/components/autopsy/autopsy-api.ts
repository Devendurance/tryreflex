import { ApiError, type Snapshot } from "@/components/decisions/decision-api";

export type Dimension = "research_quality" | "context_awareness" | "risk_discipline" | "execution_quality" | "behavioral_control";
export type QualityStatus = "final" | "provisional" | "unassessed";

export type DecisionQuality = {
  weights: Record<Dimension, number>;
  threshold: number;
  minimumCoveragePct: number;
  evidenceCoveragePct: number;
  score: number | null;
  status: QualityStatus;
};

export type DecisionTrade = {
  id: string;
  provider: "manual" | "bitget";
  symbol: string;
  side: "long" | "short";
  quantity: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  currentReview: { id: string; version: number; createdAt: string } | null;
};

export type ReviewSummary = {
  id: string;
  version: number;
  isCurrent: boolean;
  tradeId: string;
  decisionId: string;
  createdAt: string;
  classification: string | null;
  symbol: string;
  side: string;
  decisionQuality: { status: QualityStatus | null; score: number | null; evidenceCoveragePct: number | null } | null;
};

export type PlanDriftFinding = {
  type: string;
  status: string;
  evidenceBasis: string;
  originalPlan: { metric: string; currency: string; value: string };
  revisedPlan: { metric: string; currency: string; value: string };
  observations: { peakMarketCap: string | null; exitMarketCap: string | null };
  ordering: { quote: string };
  observedFacts: { evidenceId: string; quote: string }[];
  userSelfAssessment: { text: string }[];
  explanation: string;
};

export type TradeMetrics = {
  executionState?: string;
  settlementCurrency?: string | null;
  netRealizedPnl?: string | null;
  netPnlBasis?: string;
  netReturnPct?: string | null;
  captureTiming?: string;
  marketCapCurrency?: string | null;
  marketCapMovementMultiple?: string | null;
  peakMarketCapMovementMultiple?: string | null;
  exitVsTargetMarketCapMultiple?: string | null;
  outcome?: "positive" | "negative" | "break_even" | "unknown";
};

export type ReviewView = {
  reviewId: string;
  version: number;
  isCurrent: boolean;
  classification: string | null;
  createdAt: string;
  trade: (Omit<DecisionTrade, "currentReview" | "createdAt"> & { evidenceQuality: { captureBasis?: string; eventTimeBasis?: string; feesKnown?: boolean } | null }) | null;
  decision: { id: string; status: string; confirmedAt: string | null; snapshot: Snapshot | null } | null;
  metrics: { tradeMetrics?: TradeMetrics; timestampBasis?: string };
  planDrift: PlanDriftFinding[];
  decisionQuality: DecisionQuality | null;
  observationBasis: string | null;
  summary: string | null;
  lessons: { text: string; evidenceRefs: string[] }[];
  evidence: { evidenceId: string; kind: string | null; label: string | null; text: string | null }[];
  dimensions: {
    id: string;
    dimension: Dimension;
    score: number | null;
    explanation: string;
    confidence: number;
    observedFacts: { evidenceId: string; quote: string }[];
    inferredFindings: { finding: string; evidenceRefs: string[] }[];
    evidenceRefs: { evidenceId: string; kind: string; label: string | null }[];
  }[];
};

export const DIMENSIONS: Record<Dimension, { name: string; meaning: string }> = {
  research_quality: { name: "Research quality", meaning: "Your own thesis, catalyst and sources." },
  context_awareness: { name: "Context awareness", meaning: "Attention to market conditions known at decision time." },
  risk_discipline: { name: "Risk discipline", meaning: "Planned entry, invalidation and risk, and sticking to them." },
  execution_quality: { name: "Execution quality", meaning: "Whether what you did matched what you planned." },
  behavioral_control: { name: "Behavioral control", meaning: "What you said and did under pressure." },
};
export const DIMENSION_ORDER = Object.keys(DIMENSIONS) as Dimension[];

export const QUALITY_STATUS: Record<QualityStatus, { name: string; meaning: string }> = {
  final: { name: "Final", meaning: "All five dimensions had enough evidence to assess." },
  provisional: { name: "Provisional", meaning: "Scored from the dimensions that had evidence. Missing ones aren't counted as zero." },
  unassessed: { name: "Unassessed", meaning: "Less than 70% of the weighted evidence was available, so no score is given." },
};

export const QUADRANTS: Record<string, string> = {
  earned_win: "Earned win: sound process, positive outcome",
  good_decision_bad_outcome: "Good decision, bad outcome",
  lucky_escape: "Lucky escape: weak process, positive outcome",
  deserved_loss: "Deserved loss: weak process, negative outcome",
};

export function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Fixed copy for API failures. Server messages are never echoed. */
export function autopsyErrorMessage(error: unknown, action: "attach" | "generate" | "load" | "list" | "recompute"): string {
  const { status, code } = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 404) return "This record doesn't exist, or it belongs to another account.";
  if (status === 429) return "Reflex is busy with other reviews right now. Wait a moment, then try again.";
  if (action === "generate" && code === "UNSUPPORTED_INFERENCE")
    return "Reflex couldn't validate this autopsy against your evidence, so it wasn't saved. Your decision and trade evidence are unchanged. You can try again.";
  if (action === "generate" && code === "AI_UNAVAILABLE") return "The review service is unavailable right now. Nothing was saved. Try again in a moment.";
  if (action === "attach" && status === 409)
    return "This evidence doesn't fit the decision. The direction must match, and a different symbol needs a reason. The decision must be confirmed.";
  if (action === "attach" && status === 400) return "Some trade details didn't pass validation. Check the numbers, currencies and dates.";
  if (action === "generate" && status === 409) return "This trade can't be reviewed in its current state.";
  if (status === 400) return action === "recompute" ? "Your review history is too large to recompute at once." : "Reflex couldn't accept that request.";
  if (status === 503) return "Reflex storage, sign-in or a provider is unavailable right now. Nothing was changed.";
  return "Something went wrong. Nothing was changed. Try again.";
}
