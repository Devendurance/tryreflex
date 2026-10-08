import { ApiError } from "@/components/decisions/decision-api";

export type Purpose = "speculative_trade" | "payment_conversion" | "other_nontrading" | "unknown";

export type ClassicExecution = {
  executionKey: string;
  occurrence: number;
  dateText: string;
  timezoneStatus: "unknown";
  price: string;
  quantity: string;
  grossVolume: string;
  feeAmount: string;
  feeCurrency: string;
  sourceRow: number;
};

export type ClassicOrder = {
  orderId: string;
  dateText: string;
  timezoneStatus: "unknown";
  type: string;
  tradingPair: string;
  baseAsset: string;
  quoteAsset: string;
  direction: "buy" | "sell";
  orderPrice: string;
  orderAmount: string;
  orderAmountUnit: "base_asset" | "quote_asset";
  executedQuantity: string;
  averagePrice: string;
  tradingVolume: string;
  status: string;
  sourceRow: number;
  executions: ClassicExecution[];
  complete: boolean;
  warnings: string[];
};

export type FinancialGroup = {
  baseAsset: string;
  quoteAsset: string;
  direction: "buy" | "sell";
  filledQuantity: string;
  grossVolume: string;
  reportedFees: { currency: string; amount: string }[];
  netProceeds: string | null;
  netProceedsCurrency: string | null;
  executionDetailsComplete: boolean;
};

export type Summary = {
  totalOrders: number;
  totalExecutionRows: number;
  uniqueTradingPairs: string[];
  buys: number;
  sells: number;
  financialGroups: FinancialGroup[];
};

export type DuplicateCandidate = {
  orderId: string;
  activityId: string;
  existingExecutionCount: number;
  conflict: "identity_mismatch" | "execution_conflict" | null;
};

export type PreviewResult = {
  policyVersion: string;
  accountScope: string;
  preview: { sourceHash: string; orders: ClassicOrder[]; summary: Summary; importEligible: boolean; warnings: string[]; missingData: string[] };
  duplicateCandidates: DuplicateCandidate[];
};

export type Activity = {
  id: string;
  accountScope: string;
  exchange: string;
  sourceKind: string;
  orderId: string;
  identityHash: string;
  tradingPair: string;
  baseAsset: string;
  quoteAsset: string;
  direction: "buy" | "sell";
  createdAt: string;
  order: ClassicOrder;
  purpose: { value: Purpose; version: number };
  purposeAudit: { version: number; purpose: Purpose; reason: string | null; eventId: string; createdAt: string }[];
  sourceSnapshots: { id: string; importId: string | null; sourceHash: string | null; createdAt: string }[];
  metrics: Summary;
};

export type ImportReceipt = {
  id: string;
  account_scope: string;
  source_hash: string;
  parser_version: string;
  source_filename: string | null;
  order_count: number;
  execution_count: number;
  warnings: string[];
  imported_at: string;
};

export type CommitResult = {
  import: ImportReceipt;
  activities: Activity[];
  insertedOrderCount: number;
  existingOrderCount: number;
  insertedExecutionCount: number;
  existingExecutionCount: number;
  repeatedFile: boolean;
};

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SCOPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const PURPOSE_ORDER: Purpose[] = ["unknown", "speculative_trade", "payment_conversion", "other_nontrading"];

export const PURPOSES: Record<Purpose, { name: string; meaning: string }> = {
  speculative_trade: { name: "Speculative trade", meaning: "A real trading or investment decision you made." },
  payment_conversion: { name: "Payment conversion", meaning: "Selling an asset you received as payment." },
  other_nontrading: { name: "Other non-trading", meaning: "Exchange activity unrelated to a trading decision." },
  unknown: { name: "Unknown", meaning: "The purpose isn't established yet." },
};

export const WARNINGS: Record<string, string> = {
  TIMEZONE_NOT_DECLARED: "The export doesn't say which timezone its timestamps use. Reflex keeps the original text and treats the timezone as unknown.",
  ACCOUNT_IDENTITY_NOT_PRESENT: "The file doesn't identify the Bitget account it came from. The account scope is your own label.",
  PURPOSE_REQUIRES_USER_CLASSIFICATION: "Exchange data can't show why you placed an order. You choose each order's purpose.",
  INCOMPLETE_EXECUTION_DETAILS: "Some fills don't add up to the order's executed quantity or volume. Incomplete orders can't be imported.",
  REPORTED_EXECUTION_PRICE_VOLUME_MISMATCH: "A fill's price times quantity doesn't match its reported volume. Incomplete orders can't be imported.",
  REPORTED_QUOTE_FEE_EXCEEDS_VOLUME: "A reported fee is larger than the fill's volume. Incomplete orders can't be imported.",
  REPORTED_AVERAGE_PRICE_DIFFERS_FROM_EXACT_VOLUME_RATIO: "Bitget's average price is rounded. Reflex keeps it as reported and uses the fills for totals.",
};

export const MISSING: Record<string, string> = {
  timezone: "Timezone",
  verified_exchange_account_identity: "Verified account identity",
  execution_ids: "Fill IDs",
  cost_basis: "Cost basis",
  realized_pnl: "Realized P&L",
  trading_rationale: "Your reasons for trading",
  buy_sell_pairing: "Which buys match which sells",
  holding_duration: "Holding time",
};

export async function upload<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? "UNKNOWN");
  return body as T;
}

/** Fixed copy for API failures. Server messages are never echoed. */
export function activityErrorMessage(error: unknown, action: "preview" | "commit" | "load" | "list" | "purpose"): string {
  const { status } = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again. Nothing was saved.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 404) return action === "list" ? "Reflex couldn't find that record." : "This record doesn't exist, or it belongs to another account.";
  if (status === 413) return "That file is over the 2 MB limit. Export a shorter date range and try again.";
  if (status === 415) return "Reflex only reads .csv files exported from Bitget Classic spot order history.";
  if (status === 409 && action === "commit")
    return "Some orders conflict with activity you already imported: the same order ID with different details. Nothing was saved.";
  if (status === 409 && action === "purpose")
    return "This purpose was changed somewhere else since you opened it. The latest version is now shown. Review it before changing again.";
  if (status === 400 && action === "preview")
    return "This isn't a Bitget Classic spot order-history export Reflex can read, or some rows are malformed. Nothing was saved.";
  if (status === 400 && action === "commit")
    return "Reflex rejected the import. The file may have changed since the preview. Nothing was saved. Preview it again.";
  if (status === 400) return "Reflex couldn't accept that request. Nothing was changed.";
  if (status === 503) return "Reflex storage or sign-in is unavailable right now. Nothing was saved.";
  return "Something went wrong. Nothing was saved. Try again.";
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
