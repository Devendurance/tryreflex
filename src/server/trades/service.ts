import { z } from "zod";
import type { AuthContext } from "../auth/context";
import { computeTradeMetrics, decimalUnits } from "../review-policy";
import { TradeError } from "./errors";
import { tradeHistoryQuerySchema, type TradeProvider } from "./provider";
import type { AttachTradeInput, AttachTradeResult, createTradeRepository } from "./repository";

type TradeRepository = ReturnType<typeof createTradeRepository>;

const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,12})?$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9._-]{0,29}$/;
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

const manualTradeSchema = z
  .strictObject({
    decisionId: z.string().uuid(),
    symbol: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.string().regex(SYMBOL_PATTERN)),
    side: z.enum(["long", "short"]),
    quantity: positiveDecimal,
    entryPrice: positiveDecimal,
    exitPrice: positiveDecimal.optional(),
    fees: nonnegativeDecimal.optional(),
    realizedPnl: signedDecimal.optional(),
    openedAt: isoOffset,
    closedAt: isoOffset.optional(),
    settlementCurrency: z.enum(["USD", "USDT", "USDC"]),
    symbolOverrideReason: z
      .string()
      .min(1)
      .max(1000)
      .refine((v) => v.trim().length > 0)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const hasExit = value.exitPrice !== undefined;
    const hasClose = value.closedAt !== undefined;
    if (hasExit !== hasClose) ctx.addIssue({ code: "custom" });
    if (hasClose && Date.parse(value.closedAt!) < Date.parse(value.openedAt)) {
      ctx.addIssue({ code: "custom" });
    }
    if (Date.parse(value.openedAt) > Date.now()) ctx.addIssue({ code: "custom" });
    if (hasClose && Date.parse(value.closedAt!) > Date.now()) ctx.addIssue({ code: "custom" });
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
    quantity: string;
    entryPrice: string;
    exitPrice: string | null;
    fees: string;
    realizedPnl: string | null;
    openedAt: string;
    closedAt: string | null;
  },
  facts: Record<string, unknown>,
): AttachTradeInput {
  return { ...base, provenanceFacts: facts };
}

export async function attachManualTrade(
  repo: TradeRepository,
  input: unknown,
): Promise<AttachTradeResult> {
  const parsed = manualTradeSchema.safeParse(input);
  if (!parsed.success) throw new TradeError("INVALID_INPUT");
  const body = parsed.data;

  const isClosed = body.closedAt !== undefined;
  const feesKnown = body.fees !== undefined;
  let realizedPnl: string | null = body.realizedPnl ?? null;
  let netPnlBasis = "unavailable";

  if (isClosed) {
    if (body.realizedPnl !== undefined) {
      netPnlBasis = "supplied_net";
    } else if (feesKnown) {
      let metrics: ReturnType<typeof computeTradeMetrics>;
      try {
        metrics = computeTradeMetrics(
          {
          quantity: body.quantity,
          entryPrice: body.entryPrice,
          exitPrice: body.exitPrice ?? null,
          side: body.side,
          openedAt: body.openedAt,
          closedAt: body.closedAt ?? null,
          fees: body.fees ?? null,
          netRealizedPnl: null,
          calculationBasis: "linear_base_quantity",
        },
          { confirmedAt: new Date(0).toISOString(), intendedEntry: null },
        );
      } catch {
        throw new TradeError("INVALID_INPUT");
      }
      const computed = metrics.netRealizedPnl;
      if (computed === null || !DECIMAL_PATTERN.test(computed)) {
        throw new TradeError("INVALID_INPUT");
      }
      realizedPnl = computed;
      netPnlBasis = "computed_linear_net";
    }
  }

  const facts: Record<string, unknown> = {
    kind: "trade_provenance",
    source: "manual",
    feesKnown,
    settlementCurrency: body.settlementCurrency,
    calculationBasis: "linear_base_quantity",
    netPnlBasis,
  };
  if (body.symbolOverrideReason !== undefined) {
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
      quantity: body.quantity,
      entryPrice: body.entryPrice,
      exitPrice: body.exitPrice ?? null,
      fees: body.fees ?? "0",
      realizedPnl,
      openedAt: body.openedAt,
      closedAt: body.closedAt ?? null,
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
    if (body.symbolOverrideReason !== undefined) {
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
