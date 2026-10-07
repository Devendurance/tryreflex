import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { TradeError } from "../../src/server/trades/errors";
import type { NormalizedTrade, TradeListResult } from "../../src/server/trades/provider";
import { createTradeRepository } from "../../src/server/trades/repository";
import { attachManualTrade, importSelectedTrades } from "../../src/server/trades/service";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const OTHER_DECISION_ID = "323e4567-e89b-42d3-a456-426614174000";
const TRADE_ID = "423e4567-e89b-42d3-a456-426614174000";

const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };

const SNAPSHOT = { assetSymbol: "BTCUSDT", assetClass: "crypto", side: "long", origins: [], sources: [] };

type Call = { text: string; values?: readonly unknown[] };
type Handler = (text: string, values?: readonly unknown[]) => Record<string, unknown>[];

function fakeSession(handler: Handler) {
  const calls: Call[] = [];
  const session: DbSession & { calls: Call[] } = {
    calls,
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return { rows: handler(text, values) as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      calls.push({ text: "BEGIN" });
      try {
        const result = await fn(session);
        calls.push({ text: "COMMIT" });
        return result;
      } catch (error) {
        calls.push({ text: "ROLLBACK" });
        throw error;
      }
    },
  };
  return session;
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DECISION_ID,
    user_id: USER_ID,
    status: "confirmed",
    confirmed_snapshot: SNAPSHOT,
    confirmed_at: "2026-10-07T00:00:00.000Z",
    created_at: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function tradeRow(values?: readonly unknown[]) {
  return {
    id: TRADE_ID,
    user_id: values?.[0],
    decision_id: values?.[1],
    provider: values?.[2],
    external_id: values?.[3],
    symbol: values?.[4],
    side: values?.[5],
    quantity: values?.[6],
    entry_price: values?.[7],
    exit_price: values?.[8],
    fees: values?.[9],
    realized_pnl: values?.[10],
    opened_at: values?.[11],
    closed_at: values?.[12],
  };
}

function confirmedSession(existing: Record<string, unknown> | null = null, skipInsert = false) {
  return fakeSession((text, values) => {
    if (text.includes("FOR UPDATE") && text.includes("public.decisions")) {
      return values?.[1] === DECISION_ID ? [decisionRow()] : [];
    }
    if (text.startsWith("INSERT INTO public.trades")) {
      return skipInsert ? [] : [tradeRow(values)];
    }
    if (text.includes("FROM public.trades WHERE user_id=$1 AND provider")) {
      return existing ? [existing] : [];
    }
    if (text.startsWith("INSERT INTO public.trade_events")) return [{ id: "event-1" }];
    if (text.startsWith("INSERT INTO public.evidence_records")) return [{ id: "evidence-1" }];
    return [];
  });
}

const manualBody = {
  decisionId: DECISION_ID,
  symbol: "btcusdt",
  side: "long",
  quantity: "0.1",
  entryPrice: "100",
  exitPrice: "110",
  openedAt: "2026-10-05T00:00:00.000Z",
  closedAt: "2026-10-06T00:00:00.000Z",
  settlementCurrency: "USDT",
};

test("manual attach inserts trade, provenance event, and evidence atomically", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  const result = await attachManualTrade(repo, manualBody);
  assert.equal(result.created, true);
  assert.equal(result.trade.provider, "manual");
  const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"));
  assert.equal(insert?.values?.[9], "0");
  assert.equal(insert?.values?.[10], null);
  const event = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trade_events"));
  const facts = event?.values?.[3] as Record<string, unknown>;
  assert.equal(facts.kind, "trade_provenance");
  assert.equal(facts.source, "manual");
  assert.equal(facts.feesKnown, false);
  assert.equal(facts.settlementCurrency, "USDT");
  assert.ok(session.calls.some((c) => c.text.startsWith("INSERT INTO public.evidence_records")));
  assert.ok(session.calls.some((c) => c.text === "COMMIT"));
});

test("manual supplied net is authoritative and fees known when provided", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await attachManualTrade(repo, { ...manualBody, fees: "0.5", realizedPnl: "7.25" });
  const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"));
  assert.equal(insert?.values?.[9], "0.5");
  assert.equal(insert?.values?.[10], "7.25");
  const event = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trade_events"));
  assert.equal((event?.values?.[3] as Record<string, unknown>).netPnlBasis, "supplied_net");
});

test("manual closed trade without realized pnl computes net when fees known", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await attachManualTrade(repo, { ...manualBody, fees: "0.2" });
  const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"));
  assert.equal(insert?.values?.[10], "0.8");
});

test("open manual trade leaves net unknown", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  const open = {
    decisionId: manualBody.decisionId,
    symbol: manualBody.symbol,
    side: manualBody.side,
    quantity: manualBody.quantity,
    entryPrice: manualBody.entryPrice,
    openedAt: manualBody.openedAt,
    settlementCurrency: manualBody.settlementCurrency,
  };
  const result = await attachManualTrade(repo, open);
  assert.equal(result.created, true);
  const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"));
  assert.equal(insert?.values?.[8], null);
  assert.equal(insert?.values?.[10], null);
});

test("import denies unconfirmed decision before provider call", async () => {
  await withBoundSubject("trusted-subject", async () => {
    const calls: string[] = [];
    const session = fakeSession((text, values) => {
      if (text.includes("FOR UPDATE") && text.includes("public.decisions")) {
        return values?.[1] === DECISION_ID ? [decisionRow({ status: "draft", confirmed_snapshot: null })] : [];
      }
      return [];
    });
    await assert.rejects(
      () =>
        importSelectedTrades(
          createTradeRepository(session, auth),
          fakeProvider([normalized()], calls),
          auth,
          importBody,
        ),
      (error) => error instanceof TradeError && error.code === "CONFLICT",
    );
    assert.equal(calls.length, 0);
  });
});

test("unconfirmed decision denies attach", async () => {
  const session = fakeSession((text, values) => {
    if (text.includes("FOR UPDATE") && text.includes("public.decisions")) {
      return values?.[1] === DECISION_ID ? [decisionRow({ status: "draft", confirmed_snapshot: null })] : [];
    }
    return [];
  });
  const repo = createTradeRepository(session, auth);
  await assert.rejects(
    () => attachManualTrade(repo, manualBody),
    (error) => error instanceof TradeError && error.code === "CONFLICT",
  );
  assert.ok(!session.calls.some((c) => c.text.startsWith("INSERT INTO public.trades")));
});

test("cross-owner decision returns not found", async () => {
  const session = fakeSession(() => []);
  const repo = createTradeRepository(session, auth);
  await assert.rejects(
    () => attachManualTrade(repo, manualBody),
    (error) => error instanceof TradeError && error.code === "NOT_FOUND",
  );
});

test("side mismatch is rejected without insert", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await assert.rejects(
    () => attachManualTrade(repo, { ...manualBody, side: "short" }),
    (error) => error instanceof TradeError && error.code === "CONFLICT",
  );
});

test("symbol mismatch requires explicit reason and writes override audit event", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await assert.rejects(
    () => attachManualTrade(repo, { ...manualBody, symbol: "BTCUSDTPERP" }),
    (error) => error instanceof TradeError && error.code === "CONFLICT",
  );
  const session2 = confirmedSession();
  const repo2 = createTradeRepository(session2, auth);
  await attachManualTrade(repo2, {
    ...manualBody,
    symbol: "BTCUSDTPERP",
    symbolOverrideReason: "provider reports the perpetual symbol",
  });
  const overrides = session2.calls.filter(
    (c) =>
      c.text.startsWith("INSERT INTO public.trade_events") &&
      (c.values?.[3] as Record<string, unknown>).kind === "symbol_override",
  );
  assert.equal(overrides.length, 1);
  const facts = overrides[0].values?.[3] as Record<string, unknown>;
  assert.equal(facts.decisionSymbol, "BTCUSDT");
  assert.equal(facts.tradeSymbol, "BTCUSDTPERP");
  assert.equal(facts.reason, "provider reports the perpetual symbol");
});

function normalized(overrides: Partial<NormalizedTrade> = {}): NormalizedTrade {
  return {
    externalId: "USDT-FUTURES:pos-1",
    symbol: "BTCUSDT",
    side: "long",
    quantity: "0.1",
    entryPrice: "100",
    exitPrice: "110",
    fees: "0.2",
    realizedPnl: "0.8",
    openedAt: "2026-10-05T00:00:00.000Z",
    closedAt: "2026-10-06T00:00:00.000Z",
    metadata: { marginCoin: "USDT", provider: "bitget" },
    ...overrides,
  };
}

function fakeProvider(trades: NormalizedTrade[], calls?: string[]) {
  return {
    async listTrades(): Promise<TradeListResult> {
      calls?.push("listTrades");
      return { trades, rejected: [], nextCursor: null, provider: "bitget", retrievedAt: "t" };
    },
  };
}

const importBody = {
  decisionId: DECISION_ID,
  query: {
    category: "USDT-FUTURES",
    symbol: "BTCUSDT",
    startTime: Date.now() - 7 * 86400000,
    endTime: Date.now() - 86400000,
  },
  externalIds: ["USDT-FUTURES:pos-1"],
};

function withBoundSubject<T>(subject: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  if (subject === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
  else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = subject;
  return fn().finally(() => {
    if (prior === undefined) delete process.env.BITGET_ACCOUNT_AUTH_SUBJECT;
    else process.env.BITGET_ACCOUNT_AUTH_SUBJECT = prior;
  });
}

test("import denied when private account binding is missing without provider call", async () => {
  const calls: string[] = [];
  await withBoundSubject(undefined, () =>
    assert.rejects(
      () =>
        importSelectedTrades(
          createTradeRepository(confirmedSession(), auth),
          fakeProvider([normalized()], calls),
          auth,
          importBody,
        ),
      (error) => error instanceof TradeError && error.code === "PRIVATE_ACCOUNT_NOT_BOUND",
    ),
  );
  assert.equal(calls.length, 0);
});

test("import denied for foreign subject without provider call", async () => {
  const calls: string[] = [];
  await withBoundSubject("someone-else", () =>
    assert.rejects(
      () =>
        importSelectedTrades(
          createTradeRepository(confirmedSession(), auth),
          fakeProvider([normalized()], calls),
          auth,
          importBody,
        ),
      (error) => error instanceof TradeError && error.code === "PRIVATE_ACCOUNT_FORBIDDEN",
    ),
  );
  assert.equal(calls.length, 0);
});

test("import attaches selected trade and reports limited page", async () => {
  await withBoundSubject("trusted-subject", async () => {
    const session = confirmedSession();
    const result = await importSelectedTrades(
      createTradeRepository(session, auth),
      fakeProvider([normalized()]),
      auth,
      importBody,
    );
    assert.equal(result.imported.length, 1);
    assert.equal(result.deduplicated.length, 0);
    assert.equal(result.limited, true);
    const insert = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"));
    assert.equal(insert?.values?.[2], "bitget");
    assert.equal(insert?.values?.[3], "USDT-FUTURES:pos-1");
    const event = session.calls.find((c) => c.text.startsWith("INSERT INTO public.trade_events"));
    const facts = event?.values?.[3] as Record<string, unknown>;
    assert.equal(facts.source, "bitget");
    assert.equal(facts.feesKnown, true);
    assert.equal(facts.calculationBasis, "provider_net_only");
  });
});

test("reimport same decision deduplicates without duplicate events", async () => {
  await withBoundSubject("trusted-subject", async () => {
    const existing = { ...tradeRow(), id: TRADE_ID, decision_id: DECISION_ID, external_id: "USDT-FUTURES:pos-1" };
    const session = confirmedSession(existing, true);
    const result = await importSelectedTrades(
      createTradeRepository(session, auth),
      fakeProvider([normalized()]),
      auth,
      importBody,
    );
    assert.equal(result.imported.length, 0);
    assert.equal(result.deduplicated.length, 1);
    assert.equal(
      session.calls.filter((c) => c.text.startsWith("INSERT INTO public.trade_events")).length,
      0,
    );
  });
});

test("reimport under a different decision conflicts atomically", async () => {
  await withBoundSubject("trusted-subject", async () => {
    const existing = { ...tradeRow(), id: TRADE_ID, decision_id: OTHER_DECISION_ID };
    const session = confirmedSession(existing, true);
    await assert.rejects(
      () =>
        importSelectedTrades(
          createTradeRepository(session, auth),
          fakeProvider([normalized()]),
          auth,
          importBody,
        ),
      (error) => error instanceof TradeError && error.code === "CONFLICT",
    );
    assert.ok(session.calls.some((c) => c.text === "ROLLBACK"));
  });
});

test("selected id absent from page fails before writes", async () => {
  await withBoundSubject("trusted-subject", async () => {
    const session = confirmedSession();
    await assert.rejects(
      () =>
        importSelectedTrades(
          createTradeRepository(session, auth),
          fakeProvider([]),
          auth,
          importBody,
        ),
      (error) => error instanceof TradeError && error.code === "NOT_FOUND",
    );
    assert.ok(!session.calls.some((c) => c.text.startsWith("INSERT INTO")));
  });
});
