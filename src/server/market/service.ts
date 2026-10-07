import { randomUUID } from "node:crypto";
import type { MarketRequest } from "./schemas";
import {
  normalizeHistoryPayload,
  normalizeQuotePayload,
  normalizeSentimentPayload,
  type NormalizedCandle,
  type NormalizedQuote,
  type NormalizedSentiment,
} from "./normalize";
import { SAFE_MESSAGES, type AdapterResult, type FailureCode } from "../integrations/bitget/errors";
import {
  getStockHistory,
  getStockQuote,
  HISTORY_ENTRY_ID,
  QUOTE_ENTRY_ID,
  STOCK_MCP_URL,
} from "../integrations/bitget/stock";
import { getCryptoSentiment, SENTIMENT_TOOL, SIGNAL_MCP_URL } from "../integrations/bitget/signal";

export interface Provenance {
  evidenceId: string;
  provider: "bitget-stock-mcp" | "bitget-signal";
  tool: string;
  sourceUrl: string;
  fetchedAt: string;
}

export type ComponentResult =
  | { status: "available"; data: NormalizedQuote | NormalizedCandle[] | NormalizedSentiment; provenance: Provenance }
  | { status: "unavailable"; code: FailureCode; message: string };

export interface MarketContextResult {
  assetClass: "stock" | "crypto";
  symbol?: string;
  capturedAt: string;
  status: "available" | "partial" | "unavailable";
  components: {
    quote?: ComponentResult;
    history?: ComponentResult;
    sentiment?: ComponentResult;
  };
}

export interface MarketDeps {
  getQuote(symbol: string): Promise<AdapterResult>;
  getHistory(symbol: string, startTime?: number, endTime?: number): Promise<AdapterResult>;
  getSentiment(): Promise<AdapterResult>;
}

const liveDeps: MarketDeps = {
  getQuote: (symbol) => getStockQuote(symbol),
  getHistory: (symbol, startTime, endTime) => getStockHistory(symbol, startTime, endTime),
  getSentiment: () => getCryptoSentiment(),
};

export function overallStatus(statuses: ReadonlyArray<"available" | "unavailable">) {
  const ok = statuses.filter((s) => s === "available").length;
  if (ok === 0) return "unavailable" as const;
  if (ok === statuses.length) return "available" as const;
  return "partial" as const;
}

function toComponent<T extends NormalizedQuote | NormalizedCandle[] | NormalizedSentiment>(
  provenanceBase: Omit<Provenance, "evidenceId" | "fetchedAt">,
  adapter: AdapterResult,
  normalize: (payload: unknown) => T | null,
): ComponentResult {
  if (!adapter.ok) return { status: "unavailable", code: adapter.code, message: adapter.message };
  const data = normalize(adapter.payload);
  if (data === null) {
    return { status: "unavailable", code: "INVALID_PROVIDER_RESPONSE", message: SAFE_MESSAGES.INVALID_PROVIDER_RESPONSE };
  }
  return {
    status: "available",
    data,
    provenance: { ...provenanceBase, evidenceId: randomUUID(), fetchedAt: new Date().toISOString() },
  };
}

export async function getMarketContext(
  request: MarketRequest,
  deps: MarketDeps = liveDeps,
): Promise<MarketContextResult> {
  const capturedAt = new Date().toISOString();

  if (request.assetClass === "crypto") {
    const sentiment = toComponent(
      { provider: "bitget-signal", tool: SENTIMENT_TOOL, sourceUrl: SIGNAL_MCP_URL },
      await deps.getSentiment(),
      normalizeSentimentPayload,
    );
    return {
      assetClass: "crypto",
      capturedAt,
      status: overallStatus([sentiment.status]),
      components: { sentiment },
    };
  }

  const [quoteResult, historyResult] = await Promise.all([
    deps.getQuote(request.symbol),
    deps.getHistory(request.symbol, request.startTime, request.endTime),
  ]);
  const quote = toComponent(
    { provider: "bitget-stock-mcp", tool: QUOTE_ENTRY_ID, sourceUrl: STOCK_MCP_URL },
    quoteResult,
    (p) => normalizeQuotePayload(p, request.symbol),
  );
  const history = toComponent(
    { provider: "bitget-stock-mcp", tool: HISTORY_ENTRY_ID, sourceUrl: STOCK_MCP_URL },
    historyResult,
    (p) => normalizeHistoryPayload(p, request.symbol),
  );
  return {
    assetClass: "stock",
    symbol: request.symbol,
    capturedAt,
    status: overallStatus([quote.status, history.status]),
    components: { quote, history },
  };
}
