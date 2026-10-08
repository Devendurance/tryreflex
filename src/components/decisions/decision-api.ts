export type OriginLabel = "original_research" | "borrowed_conviction" | "social_confirmation" | "pure_impulse";
export type AssetClass = "crypto" | "rtoken" | "stock" | "other";
export type Side = "long" | "short" | "watch";
export type SourceType = "news" | "x" | "telegram" | "discord" | "analyst" | "friend" | "research" | "other";
export type KnowledgeBasis = "contemporaneous_record" | "retrospective_recollection" | "unknown";

export type Inference = {
  assetSymbol: string | null;
  assetClass: AssetClass | null;
  side: Side | null;
  thesis: string | null;
  catalyst: string | null;
  evidence: { quote: string; sourceType: SourceType; label: string; url: string | null }[];
  confidence: number | null;
  intendedEntry: number | null;
  invalidation: string | null;
  intendedRiskPct: number | null;
  timeframe: string | null;
  origins: { label: OriginLabel; explanation: string; confidence: number; observedInputFacts: string[] }[];
};

export type SnapshotSource = { sourceType: SourceType; label: string; url?: string; capturedAt?: string; note?: string };

export type Snapshot = {
  assetSymbol: string;
  assetClass: AssetClass;
  side: Side;
  thesis?: string;
  catalyst?: string;
  confidence?: number;
  intendedEntry?: number;
  intendedTakeProfitMarketCap?: string;
  marketCapCurrency?: string;
  knowledgeBasis?: KnowledgeBasis;
  invalidation?: string;
  intendedRiskPct?: number;
  timeframe?: string;
  origins: OriginLabel[];
  sources: SnapshotSource[];
};

export type DecisionRecord = {
  decision: {
    id: string;
    rawInput: string;
    status: "draft" | "confirmed" | "closed";
    createdAt: string;
    confirmedAt: string | null;
    structuredView: unknown;
    confirmedSnapshot: Snapshot | null;
    currentRevision: { id: string; version: number; createdAt: string } | null;
  };
  origins: { id: string; label: OriginLabel; explanation: string; confidence: number | null; basis: "inference" | "user_confirmed"; created_at: string }[];
  revisions: { id: string; version: number; createdAt: string }[];
};

export type DecisionSummary = {
  id: string;
  status: "draft" | "confirmed" | "closed";
  assetSymbol: string | null;
  assetClass: AssetClass | null;
  side: Side | null;
  createdAt: string;
  confirmedAt: string | null;
  excerpt: string;
};

export const ORIGINS: Record<OriginLabel, { name: string; meaning: string }> = {
  original_research: { name: "Original research", meaning: "You built the thesis yourself." },
  borrowed_conviction: { name: "Borrowed conviction", meaning: "You adopted someone else's call." },
  social_confirmation: { name: "Social confirmation", meaning: "Group sentiment pushed you toward it." },
  pure_impulse: { name: "Pure impulse", meaning: "An unplanned urge to act." },
};

export const ASSET_CLASSES: Record<AssetClass, string> = {
  crypto: "Crypto",
  rtoken: "Tokenized stock (rToken)",
  stock: "Stock",
  other: "Other",
};

export const SIDES: Record<Side, string> = { long: "Long (buy)", short: "Short (sell)", watch: "Watch only" };

export const SOURCE_TYPES: Record<SourceType, string> = {
  news: "News",
  x: "X",
  telegram: "Telegram",
  discord: "Discord",
  analyst: "Analyst",
  friend: "Friend",
  research: "Own research",
  other: "Other",
};

export const KNOWLEDGE_BASIS: Record<KnowledgeBasis, string> = {
  contemporaneous_record: "Written before or while deciding",
  retrospective_recollection: "Recalled after the fact",
  unknown: "Not sure",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? "UNKNOWN");
  return body as T;
}

/** Fixed copy for API failures. Server messages are never echoed. */
export function apiErrorMessage(error: unknown, action: "parse" | "load" | "confirm" | "list"): string {
  const { status, code } = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 404) return "This decision doesn't exist, or it belongs to another account.";
  if (status === 413) return "That's longer than Reflex can read at once. Shorten it and try again.";
  if (action === "parse" && code === "UNSUPPORTED_INFERENCE")
    return "Reflex couldn't back its reading with exact quotes from your text, so it kept nothing it couldn't quote. Your words were saved as a draft under Recent decisions, where you can fill in the details yourself.";
  if (action === "parse" && code === "AI_UNAVAILABLE")
    return "The reading service is unavailable right now. Your words were saved as a draft under Recent decisions. Try again in a moment, or complete that draft by hand.";
  if (action === "confirm" && status === 409) return "This decision changed state since you opened it. Reload to see the saved version.";
  if (status === 400) return action === "confirm" ? "Some details didn't pass validation. Check the highlighted fields." : "Reflex couldn't accept that input.";
  if (status === 503) return "Reflex storage or sign-in is unavailable right now. Nothing was changed.";
  return "Something went wrong. Nothing was changed. Try again.";
}

export function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function isInference(value: unknown): value is Inference {
  return typeof value === "object" && value !== null && Array.isArray((value as Inference).origins) && Array.isArray((value as Inference).evidence);
}
