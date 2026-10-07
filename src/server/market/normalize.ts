import { z } from "zod";

const positiveFinite = z.number().finite().positive();
const finiteNumber = z.number().finite();

export const normalizedQuoteSchema = z.strictObject({
  symbol: z.string().min(1),
  price: positiveFinite,
  observedAt: z.string().nullable(),
  currency: z.null(),
  bid: finiteNumber.optional(),
  ask: finiteNumber.optional(),
});

export const normalizedCandleSchema = z.strictObject({
  date: z.string().min(1),
  open: positiveFinite,
  high: positiveFinite,
  low: positiveFinite,
  close: positiveFinite,
  volume: z.number().finite().nonnegative(),
});

export const normalizedHistorySchema = z.array(normalizedCandleSchema).min(1);

export const normalizedSentimentSchema = z.strictObject({
  scope: z.literal("crypto-market"),
  value: z.number().int().min(0).max(100),
  classification: z.string().min(1),
  observedAt: z.string().nullable(),
});

export type NormalizedQuote = z.infer<typeof normalizedQuoteSchema>;
export type NormalizedCandle = z.infer<typeof normalizedCandleSchema>;
export type NormalizedSentiment = z.infer<typeof normalizedSentimentSchema>;

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_EPOCH_SECONDS = 8640000000000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function realFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isValidDateOnly(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isValidRfc3339(value: string): boolean {
  const m = RFC3339.exec(value);
  if (!m) return false;
  if (!isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60) return false;
  return !Number.isNaN(Date.parse(value));
}

function normalizeCandleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (isValidDateOnly(value) || isValidRfc3339(value)) return value;
  return null;
}

export function normalizeQuotePayload(payload: unknown, requestedSymbol: string): NormalizedQuote | null {
  let item: unknown = payload;
  if (Array.isArray(payload)) {
    if (payload.length !== 1) return null;
    item = payload[0];
  }
  if (!isRecord(item)) return null;

  const symbol = item.symbol;
  if (typeof symbol !== "string" || symbol.trim().toUpperCase() !== requestedSymbol) return null;

  const price = realFiniteNumber(item.last_price);
  if (price === null || price <= 0) return null;

  let observedAt: string | null = null;
  const ts = item.last_timestamp;
  if (typeof ts === "string" && isValidRfc3339(ts)) {
    observedAt = new Date(ts).toISOString();
  }

  const candidate: Record<string, unknown> = { symbol: requestedSymbol, price, observedAt, currency: null };
  const bid = realFiniteNumber(item.bid);
  const ask = realFiniteNumber(item.ask);
  if (bid !== null) candidate.bid = bid;
  if (ask !== null) candidate.ask = ask;

  const parsed = normalizedQuoteSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function normalizeHistoryPayload(payload: unknown, requestedSymbol: string): NormalizedCandle[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const candles: NormalizedCandle[] = [];
  for (const raw of payload) {
    if (!isRecord(raw)) return null;
    const rawSymbol = raw.symbol;
    if (rawSymbol !== undefined) {
      if (typeof rawSymbol !== "string" || rawSymbol.trim().toUpperCase() !== requestedSymbol) return null;
    }
    const date = normalizeCandleDate(raw.date);
    const open = realFiniteNumber(raw.open);
    const high = realFiniteNumber(raw.high);
    const low = realFiniteNumber(raw.low);
    const close = realFiniteNumber(raw.close);
    const volume = realFiniteNumber(raw.volume);
    if (date === null || open === null || high === null || low === null || close === null || volume === null) {
      return null;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null;
    if (!(low <= Math.min(open, close) && Math.max(open, close) <= high)) return null;
    candles.push({ date, open, high, low, close, volume });
  }
  const parsed = normalizedHistorySchema.safeParse(candles);
  return parsed.success ? parsed.data : null;
}

export function normalizeSentimentPayload(payload: unknown): NormalizedSentiment | null {
  if (!isRecord(payload)) return null;
  const data = payload.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const item = data[0];
  if (!isRecord(item)) return null;

  const rawValue = item.value;
  if (typeof rawValue !== "string" || !/^\d{1,3}$/.test(rawValue)) return null;
  const value = Number(rawValue);
  if (value < 0 || value > 100) return null;

  const classification = item.value_classification;
  if (typeof classification !== "string" || classification.trim() === "") return null;

  const rawTs = item.timestamp;
  if (typeof rawTs !== "string" || !/^\d+$/.test(rawTs)) return null;
  const seconds = Number(rawTs);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_EPOCH_SECONDS) return null;
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const observedAt = d.toISOString();

  const parsed = normalizedSentimentSchema.safeParse({
    scope: "crypto-market",
    value,
    classification,
    observedAt,
  });
  return parsed.success ? parsed.data : null;
}
