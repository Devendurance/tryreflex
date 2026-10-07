import { getCryptoSentiment } from "../src/server/integrations/bitget/signal";
import { getStockHistory, getStockQuote } from "../src/server/integrations/bitget/stock";
import {
  normalizeHistoryPayload,
  normalizeQuotePayload,
  normalizeSentimentPayload,
} from "../src/server/market/normalize";

const SYMBOL = "AAPL";

async function main() {
  const [quote, history, sentiment] = await Promise.all([
    getStockQuote(SYMBOL),
    getStockHistory(SYMBOL),
    getCryptoSentiment(),
  ]);

  const report: Record<string, unknown> = { symbol: SYMBOL, fetchedAt: new Date().toISOString() };

  if (quote.ok) {
    const data = normalizeQuotePayload(quote.payload, SYMBOL);
    report.quote = data === null ? { status: "invalid-provider-response" } : { status: "available", data };
  } else {
    report.quote = { status: "unavailable", code: quote.code };
  }

  if (history.ok) {
    const data = normalizeHistoryPayload(history.payload, SYMBOL);
    report.history =
      data === null
        ? { status: "invalid-provider-response" }
        : { status: "available", candleCount: data.length, first: data[0], last: data[data.length - 1] };
  } else {
    report.history = { status: "unavailable", code: history.code };
  }

  if (sentiment.ok) {
    const data = normalizeSentimentPayload(sentiment.payload);
    report.sentiment = data === null ? { status: "invalid-provider-response" } : { status: "available", data };
  } else {
    report.sentiment = { status: "unavailable", code: sentiment.code };
  }

  console.log(JSON.stringify(report, null, 2));

  const failed = [report.quote, report.history, report.sentiment].some(
    (c) => (c as { status?: string }).status !== "available",
  );
  if (failed) {
    console.error("verify-market: one or more live upstream calls did not return usable data");
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("verify-market: one or more live upstream calls did not return usable data");
  process.exitCode = 1;
});
