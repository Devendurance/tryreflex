import { validateAuthContext, type AuthContext } from "../auth/context";
import type { DbSession, Queryable } from "../db/client";
import { mapPersistenceError } from "../db/repositories";
import { TradeError } from "./errors";

type Row = Record<string, unknown>;

export interface AttachTradeInput {
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
  provenanceFacts: Record<string, unknown>;
}

export interface AttachTradeResult {
  trade: Row;
  created: boolean;
  event: Row | null;
  evidence: Row | null;
}

export interface DecisionLinkCheck {
  decisionId: string;
  symbol: string;
  side: "long" | "short" | null;
  provenanceFacts: Record<string, unknown>;
}

function toRecord(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

export function createTradeRepository(db: DbSession, authContext: AuthContext) {
  const auth = validateAuthContext(authContext);
  const userId = auth.userId;

  async function lockDecision(q: Queryable, decisionId: string): Promise<Row> {
    const locked = await q.query<Row>(
      `SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 FOR UPDATE`,
      [userId, decisionId],
    );
    const decision = locked.rows[0];
    if (!decision) throw new TradeError("NOT_FOUND");
    return decision;
  }

  function assertAttachable(decision: Row, input: DecisionLinkCheck): void {
    if (decision.status !== "confirmed" && decision.status !== "closed") {
      throw new TradeError("CONFLICT");
    }
    const snapshot = toRecord(decision.confirmed_snapshot);
    if (!snapshot) throw new TradeError("CONFLICT");
    const decisionSymbol =
      typeof snapshot.assetSymbol === "string" ? snapshot.assetSymbol.toUpperCase() : null;
    if (input.side !== null && snapshot.side !== input.side) throw new TradeError("CONFLICT");
    if (decisionSymbol === input.symbol.toUpperCase()) return;
    const override = toRecord(input.provenanceFacts.symbolOverride);
    if (
      !override ||
      override.kind !== "symbol_override" ||
      typeof override.reason !== "string" ||
      override.reason.trim().length === 0
    ) {
      throw new TradeError("CONFLICT");
    }
  }

  async function attachPrepared(
    q: Queryable,
    input: AttachTradeInput,
    decisionSymbol: string | null,
  ): Promise<AttachTradeResult> {
    const inserted = await q.query<Row>(
      `INSERT INTO public.trades (user_id,decision_id,provider,external_id,symbol,side,quantity,entry_price,exit_price,fees,realized_pnl,opened_at,closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (user_id,provider,external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING *`,
      [
        userId,
        input.decisionId,
        input.provider,
        input.externalId,
        input.symbol,
        input.side,
        input.quantity,
        input.entryPrice,
        input.exitPrice,
        input.fees,
        input.realizedPnl,
        input.openedAt,
        input.closedAt,
      ],
    );
    const trade = inserted.rows[0];
    if (!trade) {
      const existing = await q.query<Row>(
        `SELECT * FROM public.trades WHERE user_id=$1 AND provider=$2 AND external_id=$3 LIMIT 1`,
        [userId, input.provider, input.externalId],
      );
      const prior = existing.rows[0];
      if (!prior) throw new TradeError("CONFLICT");
      if (String(prior.decision_id) !== input.decisionId) throw new TradeError("CONFLICT");
      return { trade: prior, created: false, event: null, evidence: null };
    }
    const event = await q.query<Row>(
      `INSERT INTO public.trade_events (user_id,trade_id,event_type,occurred_at,facts) VALUES($1,$2,'other',$3,$4) RETURNING *`,
      [userId, trade.id, input.openedAt, input.provenanceFacts],
    );
    const override = toRecord(input.provenanceFacts.symbolOverride);
    if (override) {
      await q.query(
        `INSERT INTO public.trade_events (user_id,trade_id,event_type,occurred_at,facts) VALUES($1,$2,'other',$3,$4)`,
        [
          userId,
          trade.id,
          input.openedAt,
          {
            kind: "symbol_override",
            decisionSymbol,
            tradeSymbol: input.symbol,
            reason: override.reason,
          },
        ],
      );
    }
    const evidence = await q.query<Row>(
      `INSERT INTO public.evidence_records (user_id,kind,trade_id,label,observed_at) VALUES($1,'trade_data',$2,$3,$4) RETURNING *`,
      [userId, trade.id, "Trade attachment and execution summary", input.closedAt ?? input.openedAt],
    );
    return { trade, created: true, event: event.rows[0] ?? null, evidence: evidence.rows[0] ?? null };
  }

  async function attachChecked(q: Queryable, input: AttachTradeInput): Promise<AttachTradeResult> {
    const decision = await lockDecision(q, input.decisionId);
    const snapshot = toRecord(decision.confirmed_snapshot);
    const decisionSymbol =
      snapshot && typeof snapshot.assetSymbol === "string" ? snapshot.assetSymbol.toUpperCase() : null;
    assertAttachable(decision, input);
    return attachPrepared(q, input, decisionSymbol);
  }

  return {
    attach(input: AttachTradeInput): Promise<AttachTradeResult> {
      return db.transaction((q) => attachChecked(q, input)).catch(mapPersistenceError);
    },
    attachMany(inputs: readonly AttachTradeInput[]): Promise<AttachTradeResult[]> {
      return db
        .transaction(async (q) => {
          const results: AttachTradeResult[] = [];
          for (const input of inputs) results.push(await attachChecked(q, input));
          return results;
        })
        .catch(mapPersistenceError);
    },
    assertDecisionLink(input: DecisionLinkCheck): Promise<void> {
      return db
        .transaction(async (q) => {
          const decision = await lockDecision(q, input.decisionId);
          assertAttachable(decision, input);
        })
        .catch(mapPersistenceError);
    },
    async getTrade(id: string): Promise<Row | null> {
      const result = await db
        .query<Row>(`SELECT * FROM public.trades WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, id])
        .catch(mapPersistenceError);
      return result.rows[0] ?? null;
    },
  };
}
