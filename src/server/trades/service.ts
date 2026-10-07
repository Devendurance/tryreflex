import { z } from "zod";
import type { AuthContext } from "../auth/context";
import { computeSparseManualMetrics, decimalUnits } from "../review-policy";
import { TradeError } from "./errors";
import { tradeHistoryQuerySchema, type TradeProvider } from "./provider";
import type { AttachTradeInput, AttachTradeResult, createTradeRepository } from "./repository";

type TradeRepository = ReturnType<typeof createTradeRepository>;

const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,12})?$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9._-]{0,29}$/;
const CURRENCY_PATTERN = /^[A-Z][A-Z0-9]{1,11}$/;
const isoOffset = z.iso.datetime({ offset: true });

const positiveDecimal = z
  .string()
  .regex(DECIMAL_PATTERN)
  .refine(
    (v) =>
      !DECIMAL_PATTERN.test(v) || (!v.startsWith("-") && decimalUnits(v) > BigInt(0)),
  );
const nonnegativeDecimal = z.string().regex(DECIMAL_PATTERN).refine((v) => !v.startsWith("-"));
const signedDecimal = z.string().regex(DECIMAL_PATTERN);
const currencyCode = z.string().regex(CURRENCY_PATTERN);
const nonblank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length > 0);

export const manualTradeInputSchema = z
  .strictObject({
    decisionId: z.string().uuid(),
    symbol: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.string().regex(SYMBOL_PATTERN)),
    side: z.enum(["long", "short"]),
    quantity: positiveDecimal.nullish(),
    entryPrice: positiveDecimal.nullish(),
    exitPrice: positiveDecimal.nullish(),
    openedAt: isoOffset.nullish(),
    closedAt: isoOffset.nullish(),
    fees: nonnegativeDecimal.nullish(),
    realizedPnl: signedDecimal.nullish(),
    settlementCurrency: currencyCode.nullish(),
    executionState: z.enum(["open", "closed", "unknown"]).nullish(),
    amountInvested: positiveDecimal.nullish(),
    proceedsReceived: nonnegativeDecimal.nullish(),
    entryMarketCap: positiveDecimal.nullish(),
    exitMarketCap: positiveDecimal.nullish(),
    peakObservedMarketCap: positiveDecimal.nullish(),
    marketCapCurrency: currencyCode.nullish(),
    cashFlowBasis: z.enum(["gross_excluding_fees", "net_including_fees", "unknown"]).nullish(),
    captureBasis: z.enum(["contemporaneous", "retrospective", "unknown"]).nullish(),
    retrospectiveComments: nonblank(4000).nullish(),
    contractAddress: nonblank(200).nullish(),
    chain: nonblank(100).nullish(),
    symbolOverrideReason: nonblank(1000).nullish(),
  })
  .superRefine((value, ctx) => {
    const observations = [
      value.quantity,
      value.entryPrice,
      value.exitPrice,
      value.amountInvested,
      value.proceedsReceived,
      value.entryMarketCap,
      value.exitMarketCap,
      value.peakObservedMarketCap,
    ];
    if (!observations.some((v) => v != null)) {
      ctx.addIssue({ code: "custom", message: "at least one genuine observation is required" });
    }
    const state = value.executionState ?? (value.closedAt != null ? "closed" : "unknown");
    if (state !== "closed" && value.closedAt != null) {
      ctx.addIssue({ code: "custom", message: "non-closed trade cannot carry closedAt" });
    }
    if (value.openedAt != null && value.closedAt != null) {
      if (Date.parse(value.closedAt) < Date.parse(value.openedAt)) {
        ctx.addIssue({ code: "custom", message: "closedAt precedes openedAt" });
      }
    }
    for (const stamp of [value.openedAt, value.closedAt]) {
      if (stamp != null && Date.parse(stamp) > Date.now()) {
        ctx.addIssue({ code: "custom", message: "future timestamp" });
      }
    }
    const hasCash = value.amountInvested != null && value.proceedsReceived != null;
    const hasExecution =
      value.quantity != null && value.entryPrice != null && value.exitPrice != null;
    if (value.realizedPnl != null && !hasCash && !hasExecution) {
      ctx.addIssue({ code: "custom", message: "realizedPnl requires cash-flow or execution basis" });
    }
  });

const importBodySchema = z.strictObject({
  decisionId: z.string().uuid(),
  query: tradeHistoryQuerySchema,
  externalIds: z.array(z.string().min(1).max(200)).min(1).max(10),
  symbolOverrideReason: z
    .string()
    .min(1)
    .max(1000)
    .refine((v) => v.trim().length > 0)
    .optional(),
});

export function assertPrivateAccountBinding(auth: AuthContext): void {
  const bound = process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  if (!bound || bound.trim().length === 0) {
    throw new TradeError("PRIVATE_ACCOUNT_NOT_BOUND");
  }
  if (auth.provider !== "neon-auth" || auth.subject !== bound) {
    throw new TradeError("PRIVATE_ACCOUNT_FORBIDDEN");
  }
}

function buildAttachInput(
  base: {
    decisionId: string;
    provider: "manual" | "bitget";
    externalId: string | null;
    symbol: string;
    side: "long" | "short";
    quantity: string | null;
    entryPrice: string | null;
    exitPrice: string | null;
    fees: string;
    realizedPnl: string | null;
    openedAt: string | null;
    closedAt: string | null;
    occurredAt: string;
  },
  facts: Record<string, unknown>,
): AttachTradeInput {
  return { ...base, provenanceFacts: facts };
}

export async function attachManualTrade(
  repo: TradeRepository,
  input: unknown,
): Promise<AttachTradeResult> {
  const parsed = manualTradeInputSchema.safeParse(input);
  if (!parsed.success) throw new TradeError("INVALID_INPUT");
  const body = parsed.data;

  const provenanceFacts: Record<string, unknown> = {};
  if (body.symbolOverrideReason != null) {
    provenanceFacts.symbolOverride = {
      kind: "symbol_override",
      tradeSymbol: body.symbol,
      reason: body.symbolOverrideReason,
    };
  }
  const decision = await repo.assertDecisionLink({
    decisionId: body.decisionId,
    symbol: body.symbol,
    side: body.side,
    provenanceFacts,
  });
  const snapshot =
    decision.confirmed_snapshot !== null && typeof decision.confirmed_snapshot === "object"
      ? (decision.confirmed_snapshot as Record<string, unknown>)
      : {};
  const intendedTakeProfitMarketCap =
    typeof snapshot.intendedTakeProfitMarketCap === "string"
      ? snapshot.intendedTakeProfitMarketCap
      : null;
  const snapshotCapCurrency =
    typeof snapshot.marketCapCurrency === "string" ? snapshot.marketCapCurrency : null;

  const executionState =
    body.executionState ?? (body.closedAt != null ? "closed" : "unknown");
  const cashFlowBasis = body.cashFlowBasis ?? "unknown";
  const captureBasis = body.captureBasis ?? "unknown";
  const marketCapCurrency = body.marketCapCurrency ?? null;
  const comparableTargetCap =
    intendedTakeProfitMarketCap !== null &&
    snapshotCapCurrency !== null &&
    marketCapCurrency !== null &&
    snapshotCapCurrency === marketCapCurrency
      ? intendedTakeProfitMarketCap
      : null;
  const confirmedAt =
    typeof decision.confirmed_at === "string" || decision.confirmed_at instanceof Date
      ? (decision.confirmed_at as string | Date)
      : null;
  if (confirmedAt === null) throw new TradeError("CONFLICT");
  const receivedAt = new Date().toISOString();

  let metrics: ReturnType<typeof computeSparseManualMetrics>;
  try {
    metrics = computeSparseManualMetrics(
      {
        quantity: body.quantity ?? null,
        entryPrice: body.entryPrice ?? null,
        exitPrice: body.exitPrice ?? null,
        side: body.side,
        openedAt: body.openedAt ?? null,
        closedAt: body.closedAt ?? null,
        executionState,
        fees: body.fees ?? null,
        netRealizedPnl: body.realizedPnl ?? null,
        amountInvested: body.amountInvested ?? null,
        proceedsReceived: body.proceedsReceived ?? null,
        cashFlowBasis,
        settlementCurrency: body.settlementCurrency ?? null,
        entryMarketCap: body.entryMarketCap ?? null,
        exitMarketCap: body.exitMarketCap ?? null,
        peakObservedMarketCap: body.peakObservedMarketCap ?? null,
        intendedTakeProfitMarketCap: comparableTargetCap,
        marketCapCurrency,
        captureBasis,
      },
      { confirmedAt, intendedEntry: null },
    );
  } catch {
    throw new TradeError("INVALID_INPUT");
  }

  if (metrics.netRealizedPnl !== null && !DECIMAL_PATTERN.test(metrics.netRealizedPnl)) {
    throw new TradeError("INVALID_INPUT");
  }
  const realizedPnl = metrics.netRealizedPnl;
  const feesKnown = body.fees != null;

  const manualObservations: Record<string, unknown> = {
    amountInvested: body.amountInvested ?? null,
    proceedsReceived: body.proceedsReceived ?? null,
    entryMarketCap: body.entryMarketCap ?? null,
    exitMarketCap: body.exitMarketCap ?? null,
    peakObservedMarketCap: body.peakObservedMarketCap ?? null,
    marketCapCurrency: body.marketCapCurrency ?? null,
    settlementCurrency: body.settlementCurrency ?? null,
    executionState,
    cashFlowBasis,
    captureBasis,
    contractAddress: body.contractAddress ?? null,
    chain: body.chain ?? null,
    retrospectiveComments: body.retrospectiveComments ?? null,
  };

  const facts: Record<string, unknown> = {
    kind: "trade_provenance",
    source: "manual",
    feesKnown,
    settlementCurrency: body.settlementCurrency ?? null,
    calculationBasis: "manual_observations",
    netPnlBasis: metrics.netPnlBasis,
    receivedAt,
    eventTimeBasis: body.openedAt != null ? "execution_opened" : "recorded_at",
    manualObservations,
  };
  if (body.symbolOverrideReason != null) {
    facts.symbolOverride = {
      kind: "symbol_override",
      tradeSymbol: body.symbol,
      reason: body.symbolOverrideReason,
    };
  }

  const attach = buildAttachInput(
    {
      decisionId: body.decisionId,
      provider: "manual",
      externalId: null,
      symbol: body.symbol,
      side: body.side,
      quantity: body.quantity ?? null,
      entryPrice: body.entryPrice ?? null,
      exitPrice: body.exitPrice ?? null,
      fees: body.fees ?? "0",
      realizedPnl,
      openedAt: body.openedAt ?? null,
      closedAt: body.closedAt ?? null,
      occurredAt: body.openedAt ?? receivedAt,
    },
    facts,
  );
  return repo.attach(attach);
}

export interface ImportTradesResult {
  imported: Record<string, unknown>[];
  deduplicated: Record<string, unknown>[];
  rejected: { externalId: string | null; code: string }[];
  nextCursor: string | null;
  limited: true;
}

export async function importSelectedTrades(
  repo: TradeRepository,
  provider: TradeProvider,
  auth: AuthContext,
  input: unknown,
): Promise<ImportTradesResult> {
  const parsed = importBodySchema.safeParse(input);
  if (!parsed.success) throw new TradeError("INVALID_INPUT");
  const body = parsed.data;
  if (new Set(body.externalIds).size !== body.externalIds.length) {
    throw new TradeError("INVALID_INPUT");
  }
  assertPrivateAccountBinding(auth);

  await repo.assertDecisionLink({
    decisionId: body.decisionId,
    symbol: body.query.symbol,
    side: null,
    provenanceFacts:
      body.symbolOverrideReason === undefined
        ? {}
        : {
            symbolOverride: {
              kind: "symbol_override",
              tradeSymbol: body.query.symbol,
              reason: body.symbolOverrideReason,
            },
          },
  });

  const listed = await provider.listTrades({
    category: body.query.category,
    symbol: body.query.symbol,
    startTime: body.query.startTime,
    endTime: body.query.endTime,
    ...(body.query.cursor === undefined ? {} : { cursor: body.query.cursor }),
  });

  const wanted = new Map<string, (typeof listed.trades)[number]>();
  for (const trade of listed.trades) wanted.set(trade.externalId, trade);
  for (const id of body.externalIds) {
    if (!wanted.has(id)) throw new TradeError("NOT_FOUND");
  }

  const inputs = body.externalIds.map((id) => {
    const trade = wanted.get(id)!;
    const facts: Record<string, unknown> = {
      kind: "trade_provenance",
      source: "bitget",
      feesKnown: true,
      settlementCurrency: trade.metadata.marginCoin,
      calculationBasis: "provider_net_only",
      netPnlBasis: "supplied_net",
      metadata: trade.metadata,
    };
    if (body.symbolOverrideReason != null) {
      facts.symbolOverride = {
        kind: "symbol_override",
        tradeSymbol: trade.symbol,
        reason: body.symbolOverrideReason,
      };
    }
    return buildAttachInput(
      {
        decisionId: body.decisionId,
        provider: "bitget",
        externalId: trade.externalId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        fees: trade.fees,
        realizedPnl: trade.realizedPnl,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        occurredAt: trade.openedAt,
      },
      facts,
    );
  });

  const results = await repo.attachMany(inputs);
  const imported: Record<string, unknown>[] = [];
  const deduplicated: Record<string, unknown>[] = [];
  for (const result of results) {
    (result.created ? imported : deduplicated).push(result.trade);
  }
  return {
    imported,
    deduplicated,
    rejected: listed.rejected,
    nextCursor: listed.nextCursor,
    limited: true,
  };
}
