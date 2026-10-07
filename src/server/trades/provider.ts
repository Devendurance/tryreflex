import { z } from "zod";
import type {
  BitgetConfig,
  BitgetRestClient,
  SafeResult,
  ToolSpec,
} from "@bitget-ai/bitget-agent-sdk";
import { decimalUnits, sumSignedDecimals } from "../review-policy";
import { TradeError, sanitizeProviderCode } from "./errors";

const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const DECIMAL_POSITIVE = /^\d{1,18}(\.\d{1,12})?$/;
const DECIMAL_SIGNED = /^-?\d{1,18}(\.\d{1,12})?$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,30}$/;
const MARGIN_BY_CATEGORY = { "USDT-FUTURES": "USDT", "USDC-FUTURES": "USDC" } as const;

export const tradeHistoryQuerySchema = z
  .strictObject({
    category: z.enum(["USDT-FUTURES", "USDC-FUTURES"]),
    symbol: z.string().regex(SYMBOL_PATTERN),
    startTime: z.number().int().safe().nonnegative(),
    endTime: z.number().int().safe().nonnegative(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.startTime > query.endTime) ctx.addIssue({ code: "custom" });
    if (query.endTime > Date.now()) ctx.addIssue({ code: "custom" });
    if (query.endTime - query.startTime > MAX_RANGE_MS) ctx.addIssue({ code: "custom" });
    if (query.startTime < Date.now() - MAX_LOOKBACK_MS) ctx.addIssue({ code: "custom" });
  });

export type TradeHistoryQuery = z.infer<typeof tradeHistoryQuerySchema>;

export interface NormalizedTrade {
  externalId: string;
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  fees: string;
  realizedPnl: string;
  openedAt: string;
  closedAt: string;
  metadata: Record<string, unknown>;
}

export interface RejectedTradeRecord {
  externalId: string | null;
  code: "NOT_FULLY_CLOSED" | string;
}

export interface TradeListResult {
  trades: NormalizedTrade[];
  rejected: RejectedTradeRecord[];
  nextCursor: string | null;
  provider: "bitget";
  retrievedAt: string;
}

export interface TradeProvider {
  listTrades(query: TradeHistoryQuery): Promise<TradeListResult>;
}

export type InvokeFn = (
  spec: ToolSpec,
  args: Record<string, unknown>,
  context: { config: BitgetConfig; client: BitgetRestClient },
) => Promise<SafeResult>;

interface SdkRuntime {
  BitgetRestClient: new (config: BitgetConfig) => BitgetRestClient;
  buildTools: (config: BitgetConfig) => ToolSpec[];
  getOperation: (operationId: string) => { isWrite: boolean; auth: string } | undefined;
  loadConfig: (cli?: Record<string, unknown>) => BitgetConfig;
  riskLevelOf: (operation: unknown) => string;
  safeInvoke: InvokeFn;
}

interface ProviderRuntime {
  spec: ToolSpec;
  context: { config: BitgetConfig; client: BitgetRestClient };
}

const listItemSchema = z.looseObject({
  positionId: z.string(),
  category: z.string(),
  symbol: z.string(),
  marginCoin: z.string(),
  posSide: z.string(),
  openPriceAvg: z.string(),
  closePriceAvg: z.string(),
  openTotalPos: z.string(),
  closeTotalPos: z.string(),
  netProfit: z.string(),
  openFeeTotal: z.string(),
  closeFeeTotal: z.string(),
  createdTime: z.string(),
  updatedTime: z.string(),
});

const listEnvelopeSchema = z.looseObject({
  list: z.array(z.unknown()),
  cursor: z.union([z.string(), z.null()]).optional(),
});

async function loadSdk(): Promise<SdkRuntime> {
  try {
    return (await import("@bitget-ai/bitget-agent-sdk")) as unknown as SdkRuntime;
  } catch {
    throw new TradeError("CONFIGURATION");
  }
}

function fail(): never {
  throw new TradeError("PROVIDER");
}

function requireDecimal(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) fail();
  return value;
}

function requirePositiveDecimal(value: string): string {
  requireDecimal(value, DECIMAL_POSITIVE);
  if (decimalUnits(value) <= BigInt(0)) fail();
  return value;
}

const MAX_TIMESTAMP_MS = 8.64e15;

function requireTimestampMs(value: string): number {
  if (!/^\d{1,17}$/.test(value)) fail();
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS || ms > Date.now()) fail();
  return ms;
}

function formatAbs(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

function isRejected(value: NormalizedTrade | RejectedTradeRecord): value is RejectedTradeRecord {
  return "code" in value;
}

function normalizeItem(
  raw: z.infer<typeof listItemSchema>,
  query: TradeHistoryQuery,
  retrievedAt: string,
): NormalizedTrade | RejectedTradeRecord {
  if (raw.positionId.trim().length === 0) fail();
  if (raw.category !== query.category) fail();
  if (raw.symbol !== query.symbol) fail();
  if (raw.marginCoin !== MARGIN_BY_CATEGORY[query.category]) fail();
  if (raw.posSide !== "long" && raw.posSide !== "short") fail();
  const entryPrice = requirePositiveDecimal(raw.openPriceAvg);
  const exitPrice = requirePositiveDecimal(raw.closePriceAvg);
  const quantity = requirePositiveDecimal(raw.openTotalPos);
  const closedQuantity = requirePositiveDecimal(raw.closeTotalPos);
  const externalId = `${query.category}:${raw.positionId}`;
  if (decimalUnits(quantity) !== decimalUnits(closedQuantity)) {
    return { externalId, code: "NOT_FULLY_CLOSED" };
  }
  const realizedPnl = requireDecimal(raw.netProfit, DECIMAL_SIGNED);
  const feeParts = [raw.openFeeTotal, raw.closeFeeTotal];
  for (const part of feeParts) requireDecimal(part, DECIMAL_SIGNED);
  const feeLedgerTotal = sumSignedDecimals(feeParts);
  const fees = decimalUnits(feeLedgerTotal) <= BigInt(0) ? formatAbs(feeLedgerTotal) : "0";
  const openedMs = requireTimestampMs(raw.createdTime);
  const closedMs = requireTimestampMs(raw.updatedTime);
  if (closedMs < openedMs) fail();
  return {
    externalId,
    symbol: raw.symbol,
    side: raw.posSide,
    quantity,
    entryPrice,
    exitPrice,
    fees,
    realizedPnl,
    openedAt: new Date(openedMs).toISOString(),
    closedAt: new Date(closedMs).toISOString(),
    metadata: {
      provider: "bitget",
      category: query.category,
      marginCoin: raw.marginCoin,
      rawPositionId: raw.positionId,
      readOnly: true,
      retrievedAt,
      timestampBasis: "position_created_updated",
      pnlBasis: "provider_net",
      feeLedgerTotal,
      calculationBasis: "provider_net_only",
      ...(decimalUnits(feeLedgerTotal) > BigInt(0) ? { feeRebates: feeLedgerTotal } : {}),
    },
  };
}

export interface BitgetTradeProviderOptions {
  invoke?: InvokeFn;
}

export class BitgetTradeProvider implements TradeProvider {
  private ready?: Promise<ProviderRuntime>;
  private readonly invoke?: InvokeFn;

  constructor(options: BitgetTradeProviderOptions = {}) {
    this.invoke = options.invoke;
  }

  private loadRuntime(): Promise<ProviderRuntime> {
    this.ready ??= this.initialize();
    return this.ready;
  }

  private async initialize(): Promise<ProviderRuntime> {
    const sdk = await loadSdk();
    let config: BitgetConfig;
    try {
      config = sdk.loadConfig({
        readOnly: true,
        paperTrading: false,
        modules: "trade",
        surface: "intent",
        baseUrl: "https://api.bitget.com",
        timeoutMs: 15000,
        retry: { maxRetries: 0 },
      });
    } catch {
      throw new TradeError("CONFIGURATION");
    }
    if (config.readOnly !== true || config.paperTrading || config.hasAuth !== true) {
      throw new TradeError("CONFIGURATION");
    }
    const operation = sdk.getOperation("getPositionsHistory");
    if (
      !operation ||
      operation.isWrite ||
      operation.auth !== "private" ||
      sdk.riskLevelOf(operation) !== "read"
    ) {
      throw new TradeError("CONFIGURATION");
    }
    const spec = sdk.buildTools(config).find((tool) => tool.name === "position");
    if (!spec) throw new TradeError("CONFIGURATION");
    return { spec, context: { config, client: new sdk.BitgetRestClient(config) } };
  }

  async listTrades(input: TradeHistoryQuery): Promise<TradeListResult> {
    const parsed = tradeHistoryQuerySchema.safeParse(input);
    if (!parsed.success) throw new TradeError("INVALID_INPUT");
    const query = parsed.data;
    const { spec, context } = await this.loadRuntime();
    const invoke = this.invoke ?? (await loadSdk()).safeInvoke;
    const retrievedAt = new Date().toISOString();
    const args: Record<string, unknown> = {
      action: "history",
      category: query.category,
      symbol: query.symbol,
      startTime: String(query.startTime),
      endTime: String(query.endTime),
      limit: "20",
      view: "full",
    };
    if (query.cursor !== undefined) args.cursor = query.cursor;
    let result: SafeResult;
    try {
      result = await invoke(spec, args, context);
    } catch (error) {
      if (error instanceof TradeError) throw error;
      throw new TradeError("PROVIDER");
    }
    if (!result.ok) {
      if (result.error.type === "NetworkError") throw new TradeError("TIMEOUT");
      throw new TradeError("PROVIDER", sanitizeProviderCode(result.error.code));
    }
    const data = (result as { data?: unknown }).data;
    const envelope = listEnvelopeSchema.safeParse(data);
    if (!envelope.success) throw new TradeError("PROVIDER");
    if (envelope.data.list.length > 20) throw new TradeError("PROVIDER");
    const trades: NormalizedTrade[] = [];
    const rejected: RejectedTradeRecord[] = [];
    const seen = new Set<string>();
    for (const raw of envelope.data.list) {
      const item = listItemSchema.safeParse(raw);
      if (!item.success) throw new TradeError("PROVIDER");
      const normalized = normalizeItem(item.data, query, retrievedAt);
      if (!isRejected(normalized) && seen.has(normalized.externalId)) throw new TradeError("PROVIDER");
      if (!isRejected(normalized)) seen.add(normalized.externalId);
      if (isRejected(normalized)) rejected.push(normalized);
      else trades.push(normalized);
    }
    const cursor = envelope.data.cursor;
    if (typeof cursor === "string" && cursor.length > 200) throw new TradeError("PROVIDER");
    return {
      trades,
      rejected,
      nextCursor: typeof cursor === "string" && cursor.length > 0 ? cursor : null,
      provider: "bitget",
      retrievedAt,
    };
  }
}
