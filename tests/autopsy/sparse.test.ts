import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { decisionSnapshotSchema } from "../../src/server/db/validation";
import {
  computeSparseManualMetrics,
  SPARSE_AUTOPSY_PROMPT_VERSION,
  SPARSE_AUTOPSY_SYSTEM_PROMPT,
} from "../../src/server/review-policy";
import { TradeError } from "../../src/server/trades/errors";
import { AIError } from "../../src/server/ai/errors";
import { normalizeBitgetReadFailure } from "../../src/server/trades/diagnostics";
import { createTradeRepository } from "../../src/server/trades/repository";
import { attachManualTrade } from "../../src/server/trades/service";
import { AgentKeyError, createAgentKeyClient } from "../../src/server/integrations/agentkey/client";
import { getDecisionContext } from "../../src/server/context/service";
import type { SecondaryContextResult } from "../../src/server/context/schemas";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const TRADE_ID = "423e4567-e89b-42d3-a456-426614174000";

const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };
const SNAPSHOT = { assetSymbol: "BTCUSDT", assetClass: "crypto", side: "long", origins: [], sources: [] };
const CONFIRMED_AT = "2026-10-04T00:00:00.000Z";

function fakeSession(handler: (text: string, values?: readonly unknown[]) => Record<string, unknown>[]) {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  const session: DbSession & { calls: { text: string; values?: readonly unknown[] }[] } = {
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
    confirmed_at: CONFIRMED_AT,
    created_at: CONFIRMED_AT,
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

function confirmedSession() {
  return fakeSession((text, values) => {
    if (text.includes("FOR UPDATE") && text.includes("public.decisions")) {
      return values?.[1] === DECISION_ID ? [decisionRow()] : [];
    }
    if (text.startsWith("INSERT INTO public.trades")) return [tradeRow(values)];
    if (text.startsWith("INSERT INTO public.trade_events")) return [{ id: "event-1" }];
    if (text.startsWith("INSERT INTO public.evidence_records")) return [{ id: "evidence-1" }];
    return [];
  });
}

function insertValues(session: ReturnType<typeof fakeSession>) {
  return session.calls.find((c) => c.text.startsWith("INSERT INTO public.trades"))?.values;
}

function provenanceFacts(session: ReturnType<typeof fakeSession>) {
  const event = session.calls.find(
    (c) =>
      c.text.startsWith("INSERT INTO public.trade_events") &&
      (c.values?.[3] as Record<string, unknown>).kind === "trade_provenance",
  );
  return event?.values?.[3] as Record<string, unknown>;
}

const sparseBase = { decisionId: DECISION_ID, symbol: "BTCUSDT", side: "long" as const };

test("lead recipe: market caps give movement multiple, never pnl", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: null,
      closedAt: null,
      executionState: "unknown",
      fees: null,
      netRealizedPnl: null,
      amountInvested: null,
      proceedsReceived: null,
      cashFlowBasis: "unknown",
      settlementCurrency: null,
      entryMarketCap: "100000",
      exitMarketCap: "300000",
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: "USD",
      captureBasis: "retrospective",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.marketCapMovementMultiple, "3");
  assert.equal(metrics.netRealizedPnl, null);
  assert.equal(metrics.outcome, "unknown");
});

test("lead recipe: gross cash flows less known fees give net 75", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: "2026-10-05T00:00:00.000Z",
      closedAt: "2026-10-06T00:00:00.000Z",
      executionState: "closed",
      fees: "5",
      netRealizedPnl: null,
      amountInvested: "100",
      proceedsReceived: "180",
      cashFlowBasis: "gross_excluding_fees",
      settlementCurrency: "USDT",
      entryMarketCap: null,
      exitMarketCap: null,
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: null,
      captureBasis: "unknown",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.netRealizedPnl, "75");
  assert.equal(metrics.netPnlBasis, "actual_gross_cashflows_less_fees");
  assert.equal(metrics.outcome, "positive");
});

test("lead recipe: net cash flows are not double-counted by fees", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: "2026-10-05T00:00:00.000Z",
      closedAt: "2026-10-06T00:00:00.000Z",
      executionState: "closed",
      fees: "5",
      netRealizedPnl: null,
      amountInvested: "100",
      proceedsReceived: "180",
      cashFlowBasis: "net_including_fees",
      settlementCurrency: "USDT",
      entryMarketCap: null,
      exitMarketCap: null,
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: null,
      captureBasis: "unknown",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.netRealizedPnl, "80");
  assert.equal(metrics.netPnlBasis, "actual_net_cashflows");
});

test("lead recipe: unknown basis and no execution keeps net null", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: null,
      closedAt: null,
      executionState: "closed",
      fees: null,
      netRealizedPnl: null,
      amountInvested: "100",
      proceedsReceived: "180",
      cashFlowBasis: "unknown",
      settlementCurrency: "USDT",
      entryMarketCap: null,
      exitMarketCap: null,
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: null,
      captureBasis: "unknown",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.netRealizedPnl, null);
  assert.equal(metrics.outcome, "unknown");
});

test("lead recipe: missing opening time keeps holding duration null", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: null,
      closedAt: "2026-10-06T00:00:00.000Z",
      executionState: "closed",
      fees: null,
      netRealizedPnl: null,
      amountInvested: null,
      proceedsReceived: null,
      cashFlowBasis: "unknown",
      settlementCurrency: null,
      entryMarketCap: null,
      exitMarketCap: null,
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: null,
      captureBasis: "unknown",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.holdingDurationMs, null);
  assert.equal(metrics.entryAfterConfirmationMs, null);
});

test("lead recipe: proceeds of zero is a real negative outcome", () => {
  const metrics = computeSparseManualMetrics(
    {
      quantity: null,
      entryPrice: null,
      exitPrice: null,
      side: "long",
      openedAt: "2026-10-05T00:00:00.000Z",
      closedAt: "2026-10-06T00:00:00.000Z",
      executionState: "closed",
      fees: null,
      netRealizedPnl: null,
      amountInvested: "100",
      proceedsReceived: "0",
      cashFlowBasis: "net_including_fees",
      settlementCurrency: "USDT",
      entryMarketCap: null,
      exitMarketCap: null,
      peakObservedMarketCap: null,
      intendedTakeProfitMarketCap: null,
      marketCapCurrency: null,
      captureBasis: "unknown",
    },
    { confirmedAt: CONFIRMED_AT, intendedEntry: null },
  );
  assert.equal(metrics.netRealizedPnl, "-100");
  assert.equal(metrics.outcome, "negative");
});

test("market-cap-only observation stores null execution columns and observations in facts", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  const result = await attachManualTrade(repo, {
    ...sparseBase,
    entryMarketCap: "100000",
    exitMarketCap: "300000",
    marketCapCurrency: "USD",
    captureBasis: "retrospective",
  });
  assert.equal(result.created, true);
  const insert = insertValues(session)!;
  assert.equal(insert[6], null, "quantity must stay null");
  assert.equal(insert[7], null, "entry price must stay null");
  assert.equal(insert[8], null, "exit price must stay null");
  assert.equal(insert[10], null, "realized pnl must stay null");
  assert.equal(insert[11], null, "opened_at must stay null");
  assert.equal(insert[12], null, "closed_at must stay null");
  const facts = provenanceFacts(session);
  assert.equal(facts.calculationBasis, "manual_observations");
  assert.equal(facts.eventTimeBasis, "recorded_at");
  const observations = facts.manualObservations as Record<string, unknown>;
  assert.equal(observations.entryMarketCap, "100000");
  assert.equal(observations.exitMarketCap, "300000");
  assert.equal(observations.marketCapCurrency, "USD");
  assert.equal(observations.executionState, "unknown");
  assert.equal(observations.cashFlowBasis, "unknown");
});

test("gross cash flows with fees store computed net", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await attachManualTrade(repo, {
    ...sparseBase,
    amountInvested: "100",
    proceedsReceived: "180",
    cashFlowBasis: "gross_excluding_fees",
    fees: "5",
    settlementCurrency: "USDT",
    closedAt: "2026-10-06T00:00:00.000Z",
  });
  const insert = insertValues(session)!;
  assert.equal(insert[10], "75");
  assert.equal(provenanceFacts(session).netPnlBasis, "actual_gross_cashflows_less_fees");
});

test("unknown cash-flow basis stores no net pnl", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await attachManualTrade(repo, {
    ...sparseBase,
    amountInvested: "100",
    proceedsReceived: "180",
    settlementCurrency: "USDT",
    closedAt: "2026-10-06T00:00:00.000Z",
  });
  assert.equal(insertValues(session)![10], null);
});

test("manual attach rejects empty observation payloads and bad shapes", async () => {
  const repo = createTradeRepository(confirmedSession(), auth);
  const invalid: Record<string, unknown>[] = [
    sparseBase,
    { ...sparseBase, quantity: "abc" },
    { ...sparseBase, quantity: "1e3" },
    { ...sparseBase, quantity: "-1" },
    { ...sparseBase, amountInvested: "100", realizedPnl: "50" },
    { ...sparseBase, entryMarketCap: "100000", executionState: "open", closedAt: "2026-10-06T00:00:00.000Z" },
    {
      ...sparseBase,
      quantity: "1",
      openedAt: "2026-10-06T00:00:00.000Z",
      closedAt: "2026-10-05T00:00:00.000Z",
    },
    { ...sparseBase, quantity: "1", openedAt: "2999-01-01T00:00:00.000Z" },
    { ...sparseBase, quantity: "1", settlementCurrency: "usd" },
  ];
  for (const body of invalid) {
    await assert.rejects(
      () => attachManualTrade(repo, body),
      (error) => error instanceof TradeError && error.code === "INVALID_INPUT",
    );
  }
});

test("explicit null fields are unknown, not zero, and never compute net", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  const result = await attachManualTrade(repo, {
    decisionId: DECISION_ID,
    symbol: "BTCUSDT",
    side: "long",
    quantity: null,
    entryPrice: null,
    exitPrice: null,
    openedAt: null,
    closedAt: null,
    fees: null,
    realizedPnl: null,
    settlementCurrency: null,
    executionState: null,
    amountInvested: "100",
    proceedsReceived: null,
    cashFlowBasis: null,
    captureBasis: null,
    retrospectiveComments: null,
    contractAddress: null,
    chain: null,
  });
  assert.equal(result.created, true);
  const insert = insertValues(session)!;
  assert.equal(insert[6], null);
  assert.equal(insert[7], null);
  assert.equal(insert[10], null);
  assert.equal(insert[11], null);
  assert.equal(insert[12], null);
  const facts = provenanceFacts(session);
  assert.equal(facts.feesKnown, false);
  const observations = facts.manualObservations as Record<string, unknown>;
  assert.equal(observations.amountInvested, "100");
  assert.equal(observations.proceedsReceived, null);
  assert.equal(observations.executionState, "unknown");
  assert.equal(observations.cashFlowBasis, "unknown");
});

test("closedAt implies closed execution state, missing timestamps stay null", async () => {
  const session = confirmedSession();
  const repo = createTradeRepository(session, auth);
  await attachManualTrade(repo, {
    ...sparseBase,
    amountInvested: "10",
    closedAt: "2026-10-06T00:00:00.000Z",
  });
  const observations = provenanceFacts(session).manualObservations as Record<string, unknown>;
  assert.equal(observations.executionState, "closed");
  assert.equal(insertValues(session)![11], null);
});

test("migration adds the bitget execution check without touching other constraints", () => {
  const dir = path.join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.startsWith("0000"));
  assert.equal(files.length, 1);
  const sql = readFileSync(path.join(dir, files[0]), "utf8");
  assert.ok(sql.includes('"trades_bitget_execution_required"'));
  assert.ok(sql.includes("provider <> 'bitget'"));
  assert.ok(sql.includes("DROP NOT NULL"));
  assert.ok(!sql.includes("DROP TABLE"));
  assert.ok(!sql.includes("DROP CONSTRAINT"));
});

test("decision snapshot accepts plan fields and rejects retrospective comments", () => {
  const base = {
    assetSymbol: "BTCUSDT",
    assetClass: "crypto",
    side: "long",
    origins: ["original_research"],
    sources: [],
  };
  const withPlan = decisionSnapshotSchema.safeParse({
    ...base,
    intendedTakeProfitMarketCap: "300000",
    marketCapCurrency: "USD",
    knowledgeBasis: "contemporaneous_record",
  });
  assert.equal(withPlan.success, true);
  const withComments = decisionSnapshotSchema.safeParse({
    ...base,
    retrospectiveComments: "i think it went well",
  });
  assert.equal(withComments.success, false);
});

test("sparse review uses v22 prompt, keeps outcome unknown, separates retrospective evidence", async () => {
  const { generateReview } = await import("../../src/server/reviews/service");
  const { REVIEW_DIMENSIONS } = await import("../../src/server/review-policy");
  const captured: { input: string; promptVersion: string; system: string }[] = [];
  const EV = "623e4567-e89b-42d3-a456-426614174010";
  const ensured: Record<string, string> = {};
  let ensuredCount = 0;
  const llm = {
    generateText: async () => {
      throw new Error("unused");
    },
    async generateStructured(request: {
      input: string;
      promptVersion: string;
      system: string;
      validate?: (v: unknown) => void;
    }) {
      captured.push(request);
      const quoteCatalog = (
        JSON.parse(request.input) as {
          evidenceLedger: {
            evidenceId: string;
            quotes: { quoteRef: string; quote: string }[];
          }[];
        }
      ).evidenceLedger.flatMap((entry) =>
        entry.quotes.map((quote) => ({ ...quote, evidenceId: entry.evidenceId })),
      );
      const evQuote = quoteCatalog.find((q) => q.evidenceId === EV)?.quoteRef ?? quoteCatalog[0].quoteRef;
      const value = {
        dimensions: REVIEW_DIMENSIONS.map((d) => ({
          dimension: d,
          score: null,
          explanation: "insufficient evidence",
          confidence: 0,
          observedFacts: [],
          inferredFindings: [],
        })),
        lessons: [{ text: "record execution details at decision time", supportQuotes: [evQuote] }],
        planDriftLessons: [],
      };
      request.validate?.(value);
      return {
        value,
        provider: "groq",
        model: "m",
        promptVersion: request.promptVersion,
        runId: "r1",
        attempts: 1,
      };
    },
  };
  const persisted: { observedMetrics: Record<string, unknown> }[] = [];
  const confirmedSnapshot = {
    ...SNAPSHOT,
    origins: ["pure_impulse"],
    intendedTakeProfitMarketCap: "300000",
    marketCapCurrency: "USD",
    knowledgeBasis: "retrospective_recollection",
  };
  const repo = {
    async loadBundle() {
      return {
        trade: {
          id: TRADE_ID,
          provider: "manual",
          symbol: "BTCUSDT",
          side: "long",
          quantity: null,
          entry_price: null,
          exit_price: null,
          fees: "0",
          realized_pnl: null,
          opened_at: null,
          closed_at: null,
          created_at: "2026-10-08T00:00:00.000Z",
        },
        decision: {
          id: DECISION_ID,
          status: "confirmed",
          raw_input: "bought some early",
          confirmed_snapshot: confirmedSnapshot,
          confirmed_at: CONFIRMED_AT,
          created_at: CONFIRMED_AT,
        },
        origins: [
          { label: "pure_impulse", basis: "inference", explanation: "model guessed impulse", confidence: 0.5, observedInputFacts: [] },
        ],
        sources: [],
        contexts: [],
        events: [
          {
            facts: {
              kind: "trade_provenance",
              source: "manual",
              feesKnown: false,
              calculationBasis: "manual_observations",
              settlementCurrency: null,
              netPnlBasis: "unavailable",
              receivedAt: "2026-10-08T00:00:00.000Z",
              eventTimeBasis: "recorded_at",
              manualObservations: {
                amountInvested: "100",
                proceedsReceived: "180",
                entryMarketCap: "100000",
                exitMarketCap: "300000",
                marketCapCurrency: "USD",
                executionState: "unknown",
                cashFlowBasis: "unknown",
                captureBasis: "retrospective",
                retrospectiveComments: "i remember it roughly tripled",
              },
            },
          },
        ],
        evidence: [],
      };
    },
    async ensureEvidence(input: { label: string }) {
      if (!ensured[input.label]) {
        ensuredCount += 1;
        ensured[input.label] = ensuredCount === 1 ? EV : `623e4567-e89b-42d3-a456-426614174${100 + ensuredCount}`;
      }
      return { id: ensured[input.label] };
    },
    async persistReview(input: { observedMetrics: Record<string, unknown> }) {
      persisted.push(input);
      return { review: { id: "rev-1" }, dimensions: [] };
    },
    async getReviewView() {
      return { review: null, trade: null, decision: null, dimensions: [], evidenceLinks: [] };
    },
  };
  const result = await generateReview(repo as never, llm as never, { tradeId: TRADE_ID });
  assert.equal(captured[0].promptVersion, "decision-autopsy.v22");
  assert.equal(
    (JSON.parse(captured[0].input) as { verifiedDecisionTimeContextAvailable: boolean })
      .verifiedDecisionTimeContextAvailable,
    false,
    "no owned context rows means the flag is false",
  );
  assert.ok(captured[0].system.includes("sparse retail process reviewer"));
  const input = JSON.parse(captured[0].input) as {
    evidenceLedger: {
      evidenceId: string;
      evidenceType: string;
      knowledgeBasis: string;
      sourceEntityId: string;
      timing: string;
      normalizedFact?: Record<string, unknown>;
      quotes: { quoteRef: string; quote: string; claimType: string }[];
    }[];
    unavailable: Record<string, boolean>;
  };
  assert.equal("decisionSnapshot" in input, false, "the ledger replaces the duplicated snapshot/catalog inputs");
  assert.equal("evidenceCatalog" in input, false);
  assert.equal("quoteCatalog" in input, false);
  assert.ok(
    input.evidenceLedger.every(
      (entry) =>
        typeof entry.evidenceId === "string" &&
        typeof entry.evidenceType === "string" &&
        typeof entry.knowledgeBasis === "string" &&
        typeof entry.sourceEntityId === "string" &&
        typeof entry.timing === "string" &&
        !("text" in entry),
    ),
    "ledger entries carry provenance metadata, never raw text blobs",
  );
  const quoteCatalog = input.evidenceLedger.flatMap((entry) =>
    entry.quotes.map((quote) => ({ ...quote, evidenceId: entry.evidenceId })),
  );
  const snapshotEntry = input.evidenceLedger.find(
    (entry) => entry.sourceEntityId === DECISION_ID && entry.quotes.some((q) => q.quote === "intendedTakeProfitMarketCap: 300000"),
  );
  assert.equal(snapshotEntry?.knowledgeBasis, "recollected_decision");
  assert.equal(snapshotEntry?.timing, "retrospective_recollection");
  assert.ok(
    !JSON.stringify(captured[0].input).includes("pure_impulse"),
    "parser-inferred origin labels never reach the model-facing evidence ledger",
  );
  assert.ok(
    (snapshotEntry?.quotes ?? []).every((q) => !/\borigins?[:|]|\bimpulse\b/i.test(q.quote)),
    "the confirmed snapshot evidence projects no origins line",
  );
  assert.deepEqual(
    confirmedSnapshot.origins,
    ["pure_impulse"],
    "the saved snapshot origins array is untouched by evidence projection",
  );
  const observationEntry = input.evidenceLedger.find(
    (entry) => entry.knowledgeBasis === "retrospective_execution" && entry.quotes.some((q) => q.quote.includes("after_the_fact")),
  );
  assert.ok(observationEntry, "retrospective observations must appear as separate evidence");
  assert.equal(observationEntry?.sourceEntityId, TRADE_ID);
  assert.equal(observationEntry?.timing, "execution_time_unknown");
  assert.ok(
    input.evidenceLedger.some(
      (entry) => entry.knowledgeBasis === "reported_execution" && entry.quotes.some((q) => q.quote === "provider: manual"),
    ),
  );
  const metricEntry = input.evidenceLedger.find((entry) => entry.knowledgeBasis === "deterministic_derived");
  assert.ok(metricEntry?.normalizedFact, "the metric row carries a server-derived normalizedFact");
  for (const excluded of ["netRealizedPnl", "netReturnPct", "outcome", "exitPrice", "amountInvested", "proceedsReceived", "fees"]) {
    assert.equal(
      excluded in (metricEntry?.normalizedFact ?? {}),
      false,
      `${excluded} stays excluded from normalized facts`,
    );
  }
  assert.ok(metricEntry?.quotes.every((quote) => quote.claimType === "deterministic_fact"));
  assert.equal(input.unavailable.actualProceeds, false);
  assert.equal(input.unavailable.realizedPnl, true);
  assert.equal(input.unavailable.unitPrices, true);
  assert.equal(input.unavailable.executionTimestamps, true);
  assert.equal(input.unavailable.verifiedDecisionTimeContext, true);
  assert.ok(quoteCatalog.some((q) => q.quote.includes("i remember it roughly tripled")));
  assert.ok(
    !quoteCatalog.some((q) => q.quote === "quantity: null" || q.quote === "entry_price: null"),
    "unknown execution fields must not be quoted",
  );
  assert.ok(
    !captured[0].input.includes("proceedsReceived") &&
      !quoteCatalog.some((q) => q.quote.includes("user_reported_proceeds_received")),
    "money amounts must not be injected into the process catalog",
  );
  const metrics = persisted[0].observedMetrics.tradeMetrics as Record<string, unknown>;
  assert.equal(metrics.outcome, "unknown");
  assert.equal(metrics.netRealizedPnl, null);
  assert.equal(metrics.captureTiming, "retrospective");
  const inference = (persisted[0] as unknown as { aiInference: { summary: string; summaryBasis: string } }).aiInference;
  assert.equal(
    inference.summary,
    "This review assesses the supplied process evidence. Missing execution information is not evidence of poor execution.",
    "with no drift findings the sparse summary is the fixed server synopsis",
  );
  assert.equal(inference.summaryBasis, "server_derived_evidence_synopsis");
  assert.equal(result.classification, null);
});

test("sparse prompt v22 keeps grading guards without the duplicated base text", () => {
  assert.equal(SPARSE_AUTOPSY_PROMPT_VERSION, "decision-autopsy.v22");
  const prompt = SPARSE_AUTOPSY_SYSTEM_PROMPT;
  assert.ok(prompt.includes("Do not return summary"));
  assert.ok(prompt.includes("server builds a factual synopsis from its validated Plan Drift findings"));
  assert.ok(
    prompt.includes("select executionQuoteRef and behavioralQuoteRef from that finding's behaviorQuoteRefs"),
  );
  assert.ok(prompt.includes("intentionally excluded from the narrative ledger"));
  assert.ok(prompt.includes("Do not infer or advise about psychological motives"));
  assert.ok(prompt.includes("lessons must be an empty array"));
  assert.ok(
    prompt.includes("Claims that a risk rule was not applied, not enforced, ignored, breached, or violated require an explicit retrospective risk-adherence statement"),
  );
  assert.ok(prompt.includes("Do not place internal q-number selectors in narrative prose"));
  assert.ok(
    prompt.includes("A scored execution explanation must explicitly explain the target change and reported selling action"),
  );
  assert.ok(prompt.includes("Return exactly one planDriftLessons entry for each supplied drift"));
  assert.ok(prompt.includes("Its text is only a concrete process takeaway"));
  assert.ok(prompt.includes("Use no digits and do not mention peaks"));
  assert.ok(prompt.includes("If verifiedDecisionTimeContextAvailable=false, context_awareness must be unassessed"));
  assert.ok(prompt.includes("The evidenceLedger is the only allowed source of observations"));
  assert.ok(
    prompt.includes("stable owned evidenceId, evidenceType, knowledgeBasis, sourceEntityId, timing classification"),
  );
  assert.ok(prompt.includes("inferred findings and lessons cite supportQuotes arrays of ledger quoteRef keys"));
  assert.ok(prompt.includes("Never write evidenceId, quote, or evidenceRefs in the wire response"));
  assert.ok(
    prompt.includes("If a dimension is unassessed it stays empty"),
  );
  assert.ok(
    prompt.includes("Assess the clarity/actionability of a documented risk rule from its wording separately from unknown execution adherence"),
  );
  assert.ok(prompt.includes("Wire observedFacts contain only {quoteRef}"));
  assert.ok(
    prompt.includes("never realized return, realized loss, financial cost, investment performance, or money left on the table"),
  );
  assert.ok(prompt.includes("Bare 'Stick to your plan.' or 'Do more research.' are rejected."));
  assert.ok(prompt.includes("diagnose psychological/medical conditions"));
  assert.ok(prompt.includes("Context awareness requires verified decision-time conditions; when unavailable, abstain"));
  assert.ok(!prompt.includes("evidence-backed trading-process reviewer"), "compact sparse prompt does not embed the v1 base");
});

test("agentkey: missing credential is a configuration failure, not a network call", async () => {
  const client = createAgentKeyClient({ apiKey: "" });
  await assert.rejects(
    () => client.listCapabilities(),
    (error) => error instanceof AgentKeyError && error.code === "CONFIGURATION",
  );
  await assert.rejects(
    () => client.executeVerified(null),
    (error) => error instanceof AgentKeyError && error.code === "CONFIGURATION",
  );
});

test("agentkey: http 401 maps to auth failure", async () => {
  const client = createAgentKeyClient({
    apiKey: "test-key",
    fetchImpl: (async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
  });
  await assert.rejects(
    () => client.listCapabilities(),
    (error) => error instanceof AgentKeyError && error.code === "AUTH",
  );
});

test("agentkey: undiscovered tools cannot be described or executed", async () => {
  const client = createAgentKeyClient({ apiKey: "test-key" });
  await assert.rejects(
    () => client.describe("any_tool"),
    (error) => error instanceof AgentKeyError && error.code === "CAPABILITY_NOT_VERIFIED",
  );
  await assert.rejects(
    () =>
      client.executeVerified({
        name: "unverified",
        purpose: "public_market_context",
        readOnly: true,
        params: {},
        paramsSchema: z.record(z.string(), z.unknown()),
        outputSchema: z.unknown(),
      }),
    (error) => error instanceof AgentKeyError && error.code === "CAPABILITY_NOT_VERIFIED",
  );
});

const SECONDARY_QUERY = { assetSymbol: "BTCUSDT" };
const VALID_AT = "2026-10-08T00:00:00.000Z";
const VALID_EVIDENCE_ID = "623e4567-e89b-42d3-a456-426614174099";

function sentimentAvailable() {
  return {
    status: "available" as const,
    data: {
      scope: "crypto-market" as const,
      value: 55,
      classification: "neutral",
      observedAt: VALID_AT,
    },
    provenance: {
      evidenceId: VALID_EVIDENCE_ID,
      provider: "bitget-signal" as const,
      tool: "fear_greed_index",
      sourceUrl: "https://datahub.noxiaohao.com/mcp",
      fetchedAt: VALID_AT,
    },
  };
}

function sentimentUnavailable() {
  return {
    status: "unavailable" as const,
    code: "UPSTREAM_UNAVAILABLE" as const,
    message: "upstream provider unavailable",
  };
}

function secondaryItem() {
  return {
    kind: "external_context" as const,
    text: "provider-reported context note",
    underlyingSource: "x-search",
    originalId: "post-1",
    url: "https://example.com/post/1",
    retrievedAt: VALID_AT,
    query: SECONDARY_QUERY,
    provider: "agentkey" as const,
    role: "fallback" as const,
  };
}

test("decision context keeps bitget failures primary and agentkey failures secondary", async () => {
  const result = await getDecisionContext(
    { assetClass: "crypto", secondaryQuery: SECONDARY_QUERY },
    {
      primary: async () => ({
        assetClass: "crypto",
        capturedAt: VALID_AT,
        status: "unavailable",
        components: { sentiment: sentimentUnavailable() },
      }),
      secondary: async () => ({
        provider: "agentkey",
        status: "unavailable",
        items: [],
        error: { code: "AUTH", message: "unauthorized" },
      }),
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.secondary?.error?.code, "AUTH");
  assert.equal(
    (result.primary.components as Record<string, { status: string }>).sentiment.status,
    "unavailable",
  );
});

test("secondary is not attempted without an owned asset query", async () => {
  let calls = 0;
  const result = await getDecisionContext(
    { assetClass: "crypto" },
    {
      primary: async () => ({
        assetClass: "crypto",
        capturedAt: VALID_AT,
        status: "unavailable",
        components: { sentiment: sentimentUnavailable() },
      }),
      secondary: async () => {
        calls += 1;
        return {
          provider: "agentkey",
          status: "available",
          items: [secondaryItem()],
          error: null,
        };
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(result.secondary?.error?.code, "CAPABILITY_NOT_VERIFIED");
});

test("secondary items cannot rescue a failed primary beyond partial", async () => {
  const enriched = await getDecisionContext(
    { assetClass: "crypto", enrichment: true, secondaryQuery: SECONDARY_QUERY },
    {
      primary: async () => ({
        assetClass: "crypto",
        capturedAt: VALID_AT,
        status: "available",
        components: { sentiment: sentimentAvailable() },
      }),
      secondary: async (_query, role) => ({
        provider: "agentkey",
        status: "available",
        items: [{ ...secondaryItem(), role }],
        error: null,
      }),
    },
  );
  assert.equal(enriched.status, "available");
  assert.equal(enriched.secondary?.items[0].role, "enrichment");
  const fallback = await getDecisionContext(
    { assetClass: "crypto", secondaryQuery: SECONDARY_QUERY },
    {
      primary: async () => ({
        assetClass: "crypto",
        capturedAt: VALID_AT,
        status: "unavailable",
        components: { sentiment: sentimentUnavailable() },
      }),
      secondary: async () => ({
        provider: "agentkey",
        status: "available",
        items: [secondaryItem()],
        error: null,
      }),
    },
  );
  assert.equal(fallback.status, "partial");
});

test("secondary items with a mismatched role or query are rejected", async () => {
  for (const item of [
    { ...secondaryItem(), role: "enrichment" as const },
    { ...secondaryItem(), query: { assetSymbol: "ETHUSDT" } },
  ]) {
    const result = await getDecisionContext(
      { assetClass: "crypto", secondaryQuery: SECONDARY_QUERY },
      {
        primary: async () => ({
          assetClass: "crypto",
          capturedAt: VALID_AT,
          status: "unavailable",
          components: { sentiment: sentimentUnavailable() },
        }),
        secondary: async () => ({
          provider: "agentkey",
          status: "available",
          items: [item],
          error: null,
        }),
      },
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.secondary?.error?.code, "INVALID_PROVIDER_RESPONSE");
  }
});

test("invalid primary payload degrades safely instead of throwing", async () => {
  const result = await getDecisionContext(
    { assetClass: "crypto", secondaryQuery: SECONDARY_QUERY },
    {
      primary: async () =>
        ({ assetClass: "crypto", capturedAt: "not-a-date", status: "available" }) as never,
      secondary: async () => ({
        provider: "agentkey",
        status: "unavailable",
        items: [],
        error: { code: "AUTH", message: "unauthorized" },
      }),
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.primary.status, "unavailable");
});

test("malformed secondary payloads fail closed with provider label kept separate", async () => {
  const result = await getDecisionContext(
    { assetClass: "crypto", secondaryQuery: SECONDARY_QUERY },
    {
      primary: async () => ({
        assetClass: "crypto",
        capturedAt: VALID_AT,
        status: "unavailable",
        components: { sentiment: sentimentUnavailable() },
      }),
      secondary: async () =>
        ({ provider: "agentkey", status: "available", items: [{ bad: true }], error: null }) as unknown as SecondaryContextResult,
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.secondary?.error?.code, "INVALID_PROVIDER_RESPONSE");
});

test("diagnostics redact secrets and preserve provider and http codes without inference", () => {
  const out = normalizeBitgetReadFailure(
    {
      type: "BitgetApiError",
      code: "40099",
      message: "ACCESS-KEY: secretkey Bearer abc123 passphrase=hunter2 exchange environment is incorrect",
      category: "business",
    },
    { status: 400, code: "40099" },
    ["secretkey", "hunter2"],
  );
  assert.equal(out.httpStatus, 400);
  assert.equal(out.providerCode, "40099");
  assert.equal(out.exchangeEnvironment, "mismatch");
  assert.equal(out.accountCompatibility, "unproven");
  assert.equal(out.needsUserAction, true);
  assert.ok(!out.safeMessage.includes("secretkey"));
  assert.ok(!out.safeMessage.includes("hunter2"));
  assert.ok(!out.safeMessage.includes("abc123"));
  const unknown = normalizeBitgetReadFailure(
    { type: "InternalError", message: "boom" },
    null,
  );
  assert.equal(unknown.accountCompatibility, "unproven");
  assert.equal(unknown.httpStatus, null);
});

async function runSparseReview(
  snapshotOverrides: Record<string, unknown>,
  observations: Record<string, unknown>,
  options: { contextScore?: number; captured?: string[] } = {},
) {
  const { generateReview } = await import("../../src/server/reviews/service");
  const { REVIEW_DIMENSIONS } = await import("../../src/server/review-policy");
  const EV = "623e4567-e89b-42d3-a456-426614174010";
  const llm = {
    generateText: async () => {
      throw new Error("unused");
    },
    async generateStructured(request: {
      input: string;
      validate?: (v: unknown) => void;
      promptVersion: string;
    }) {
      options.captured?.push(request.input);
      const quoteCatalog = (
        JSON.parse(request.input) as {
          evidenceLedger: {
            evidenceId: string;
            quotes: { quoteRef: string; quote: string }[];
          }[];
        }
      ).evidenceLedger.flatMap((entry) =>
        entry.quotes.map((quote) => ({ ...quote, evidenceId: entry.evidenceId })),
      );
      const evQuote = quoteCatalog.find((q) => q.evidenceId === EV)?.quoteRef ?? quoteCatalog[0]?.quoteRef;
      const contextFact = options.contextScore !== undefined && evQuote !== undefined ? [{ quoteRef: evQuote }] : [];
      const value = {
        dimensions: REVIEW_DIMENSIONS.map((d) => ({
          dimension: d,
          score: d === "context_awareness" && options.contextScore !== undefined ? options.contextScore : null,
          explanation: "insufficient evidence",
          confidence: 0,
          observedFacts: d === "context_awareness" ? contextFact : [],
          inferredFindings: [],
        })),
        lessons: evQuote === undefined ? [] : [{ text: "record execution details", supportQuotes: [evQuote] }],
        planDriftLessons: [],
      };
      request.validate?.(value);
      return { value, provider: "groq", model: "m", promptVersion: request.promptVersion, runId: "r", attempts: 1 };
    },
  };
  const persisted: { observedMetrics: Record<string, unknown> }[] = [];
  let ensuredCount = 0;
  const repo = {
    async loadBundle() {
      return {
        trade: {
          id: TRADE_ID,
          provider: "manual",
          symbol: "BTCUSDT",
          side: "long",
          quantity: null,
          entry_price: null,
          exit_price: null,
          fees: "0",
          realized_pnl: null,
          opened_at: null,
          closed_at: null,
          created_at: "2026-10-08T00:00:00.000Z",
        },
        decision: {
          id: DECISION_ID,
          status: "confirmed",
          raw_input: "bought some early",
          confirmed_snapshot: { ...SNAPSHOT, ...snapshotOverrides },
          confirmed_at: CONFIRMED_AT,
          created_at: CONFIRMED_AT,
        },
        origins: [],
        sources: [],
        contexts: [],
        events: [
          {
            facts: {
              kind: "trade_provenance",
              source: "manual",
              feesKnown: false,
              calculationBasis: "manual_observations",
              settlementCurrency: null,
              netPnlBasis: "unavailable",
              receivedAt: "2026-10-08T00:00:00.000Z",
              eventTimeBasis: "recorded_at",
              manualObservations: observations,
            },
          },
        ],
        evidence: [],
      };
    },
    async ensureEvidence() {
      ensuredCount += 1;
      return { id: `623e4567-e89b-42d3-a456-426614174${100 + ensuredCount}` };
    },
    async persistReview(input: { observedMetrics: Record<string, unknown> }) {
      persisted.push(input);
      return { review: { id: "rev-1" }, dimensions: [] };
    },
    async getReviewView() {
      return { review: null, trade: null, decision: null, dimensions: [], evidenceLinks: [] };
    },
  };
  await generateReview(repo as never, llm as never, { tradeId: TRADE_ID });
  return persisted[0].observedMetrics.tradeMetrics as Record<string, unknown>;
}

test("different currencies never compare caps against the original target", async () => {
  const metrics = await runSparseReview(
    { intendedTakeProfitMarketCap: "300000", marketCapCurrency: "USD" },
    {
      entryMarketCap: "100000",
      exitMarketCap: "300000",
      marketCapCurrency: "SOL",
      executionState: "unknown",
      cashFlowBasis: "unknown",
      captureBasis: "retrospective",
    },
  );
  assert.equal(metrics.marketCapCurrency, "SOL");
  assert.equal(metrics.intendedTakeProfitMarketCap, null);
  assert.equal(metrics.exitVsTargetMarketCapMultiple, null);
  assert.equal(metrics.marketCapMovementMultiple, "3");
});

test("omitted observation currency keeps every market-cap ratio null", async () => {
  const metrics = await runSparseReview(
    { intendedTakeProfitMarketCap: "300000", marketCapCurrency: "USD" },
    {
      entryMarketCap: "100000",
      exitMarketCap: "300000",
      marketCapCurrency: null,
      executionState: "unknown",
      cashFlowBasis: "unknown",
      captureBasis: "retrospective",
    },
  );
  assert.equal(metrics.marketCapCurrency, null);
  assert.equal(metrics.exitVsTargetMarketCapMultiple, null);
  assert.equal(metrics.marketCapMovementMultiple, null);
});

test("same declared currency allows the target comparison", async () => {
  const metrics = await runSparseReview(
    { intendedTakeProfitMarketCap: "300000", marketCapCurrency: "USD" },
    {
      entryMarketCap: "100000",
      exitMarketCap: "300000",
      marketCapCurrency: "USD",
      executionState: "unknown",
      cashFlowBasis: "unknown",
      captureBasis: "retrospective",
    },
  );
  assert.equal(metrics.exitVsTargetMarketCapMultiple, "1");
});

test("a scored context dimension fails when no verified decision-time context exists", async () => {
  const captured: string[] = [];
  await assert.rejects(
    () =>
      runSparseReview(
        { intendedTakeProfitMarketCap: "300000", marketCapCurrency: "USD" },
        {
          entryMarketCap: "100000",
          exitMarketCap: "300000",
          marketCapCurrency: "USD",
          executionState: "unknown",
          cashFlowBasis: "unknown",
          captureBasis: "retrospective",
        },
        { contextScore: 20, captured },
      ),
    (error) =>
      error instanceof AIError &&
      error.code === "GROUNDING" &&
      error.grounding?.reason === "DECISION_TIME_CONTEXT_UNAVAILABLE" &&
      error.grounding.path === "dimensions[1].score",
  );
  assert.equal(
    (JSON.parse(captured[0]) as { verifiedDecisionTimeContextAvailable: boolean })
      .verifiedDecisionTimeContextAvailable,
    false,
  );
  const metrics = await runSparseReview(
    { intendedTakeProfitMarketCap: "300000", marketCapCurrency: "USD" },
    {
      entryMarketCap: "100000",
      exitMarketCap: "300000",
      marketCapCurrency: "USD",
      executionState: "unknown",
      cashFlowBasis: "unknown",
      captureBasis: "retrospective",
    },
  );
  assert.equal(metrics.marketCapMovementMultiple, "3");
});

type RpcCall = { method: string; params: Record<string, unknown> };

function mcpFetch(
  calls: RpcCall[],
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
): typeof fetch {
  return (async (_input: unknown, init?: { body?: unknown }) => {
    const text = typeof init?.body === "string" ? init.body : "";
    let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      message = JSON.parse(text);
    } catch {
      return new Response("bad", { status: 400 });
    }
    if (message.id === undefined || message.id === null) {
      return new Response(null, { status: 202 });
    }
    calls.push({ method: String(message.method), params: message.params ?? {} });
    const handler = handlers[String(message.method)];
    const result = handler
      ? handler(message.params ?? {})
      : { error: "unhandled" };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

const INITIALIZE_RESULT = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: {} },
  serverInfo: { name: "mock-agentkey", version: "0.0.1" },
};

function gatewayTools() {
  return {
    tools: [
      { name: "find_tools", inputSchema: { type: "object" } },
      { name: "describe_tool", inputSchema: { type: "object" } },
      { name: "execute_tool", inputSchema: { type: "object" } },
    ],
  };
}

test("agentkey discovery uses only advertised find_tools", async () => {
  const calls: RpcCall[] = [];
  const client = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch(calls, {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => ({
        tools: [{ name: "find_tools", inputSchema: { type: "object" } }],
      }),
      "tools/call": (params) => {
        assert.equal((params as { name: string }).name, "find_tools");
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify([{ name: "token_context", summary: "s", cost: { credits_per_call: 1 } }]),
            },
          ],
        };
      },
    }),
  });
  const ranked = await client.discover("token");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "token_context");
  assert.deepEqual(ranked[0].cost, { credits_per_call: 1 });
  const notAdvertised = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch([], {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => ({ tools: [] }),
    }),
  });
  await assert.rejects(
    () => notAdvertised.discover("token"),
    (error) => error instanceof AgentKeyError && error.code === "CAPABILITY_NOT_VERIFIED",
  );
});

test("agentkey execute goes through describe_tool then execute_tool in one session", async () => {
  const calls: RpcCall[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  const client = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch(calls, {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => gatewayTools(),
      "tools/call": (params) => {
        toolCalls.push(params);
        const named = params as { name?: string; arguments?: Record<string, unknown> };
        if (named.name === "find_tools") {
          return {
            isError: false,
            content: [{ type: "text", text: JSON.stringify([{ name: "token_context" }]) }],
          };
        }
        if (named.name === "describe_tool") {
          return {
            isError: false,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  name: "token_context",
                  params: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
                  cost: { credits_per_call: 1 },
                  execute_as: { name: "token_context" },
                }),
              },
            ],
          };
        }
        if (named.name === "execute_tool") {
          return { isError: false, structuredContent: { text: "context", source: "x" } };
        }
        return { isError: true, content: [] };
      },
    }),
  });
  await client.discover("token");
  const executed = await client.executeVerified({
    name: "token_context",
    purpose: "public_market_context",
    readOnly: true,
    params: { q: "BTCUSDT" },
    paramsSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.looseObject({ text: z.string(), source: z.string() }),
  });
  assert.deepEqual(executed, { text: "context", source: "x" });
  const executeCall = toolCalls.find((p) => p.name === "execute_tool");
  const execArgs = executeCall?.arguments as Record<string, unknown>;
  assert.equal(execArgs.name, "token_context");
  assert.deepEqual(execArgs.params, { q: "BTCUSDT" });
});

test("agentkey plans without the approved contract are never executed", async () => {
  const client = createAgentKeyClient({ apiKey: "k" });
  const plans = [
    null,
    {
      name: "x",
      purpose: "other",
      readOnly: true,
      params: {},
      paramsSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.unknown(),
    },
    {
      name: "x",
      purpose: "public_market_context",
      readOnly: false,
      params: {},
      paramsSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.unknown(),
    },
    {
      name: "not_discovered",
      purpose: "public_market_context",
      readOnly: true,
      params: {},
      paramsSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.unknown(),
    },
  ] as never[];
  for (const plan of plans) {
    await assert.rejects(
      () => client.executeVerified(plan),
      (error) => error instanceof AgentKeyError && error.code === "CAPABILITY_NOT_VERIFIED",
    );
  }
});

test("agentkey tool errors and oversized payloads fail closed", async () => {
  const erroring = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch([], {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => ({ tools: [{ name: "find_tools", inputSchema: { type: "object" } }] }),
      "tools/call": () => ({ isError: true, content: [{ type: "text", text: "failed" }] }),
    }),
  });
  await assert.rejects(
    () => erroring.discover("x"),
    (error) => error instanceof AgentKeyError && error.code === "UNAVAILABLE",
  );
  const oversized = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch([], {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => ({ tools: [{ name: "find_tools", inputSchema: { type: "object" } }] }),
      "tools/call": () => ({
        isError: false,
        content: [{ type: "text", text: "x".repeat(200001) }],
      }),
    }),
  });
  await assert.rejects(
    () => oversized.discover("x"),
    (error) => error instanceof AgentKeyError && error.code === "INVALID_PROVIDER_RESPONSE",
  );
});

test("agentkey connect failure and noncooperative fetch map safely", async () => {
  const unauthorized = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: (async () => new Response("no", { status: 403 })) as typeof fetch,
  });
  await assert.rejects(
    () => unauthorized.listCapabilities(),
    (error) => error instanceof AgentKeyError && error.code === "AUTH",
  );
  const hanging = createAgentKeyClient({
    apiKey: "k",
    timeoutMs: 1000,
    fetchImpl: (() => new Promise<Response>(() => {})) as typeof fetch,
  });
  await assert.rejects(
    () => hanging.listCapabilities(),
    (error) => error instanceof AgentKeyError && error.code === "TIMEOUT",
  );
});

test("agentkey hung tool call is bounded by the shared deadline", async () => {
  const client = createAgentKeyClient({
    apiKey: "k",
    timeoutMs: 1000,
    fetchImpl: (async (_input: unknown, init?: { body?: unknown }) => {
      const msg = JSON.parse(String(init?.body ?? "{}"));
      if (msg.id === undefined) return new Response(null, { status: 202 });
      if (msg.method === "tools/call") return new Promise<Response>(() => {});
      const result =
        msg.method === "initialize"
          ? INITIALIZE_RESULT
          : { tools: [{ name: "find_tools", inputSchema: { type: "object" } }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  await assert.rejects(
    () => client.discover("x"),
    (error) => error instanceof AgentKeyError && error.code === "TIMEOUT",
  );
});

test("agentkey chunked oversize without content-length is an invalid provider response", async () => {
  const big = "x".repeat(3 * 1024 * 1024);
  const client = createAgentKeyClient({
    apiKey: "k",
    timeoutMs: 5000,
    fetchImpl: (async (_input: unknown, init?: { body?: unknown }) => {
      const msg = JSON.parse(String(init?.body ?? "{}"));
      if (msg.id === undefined) return new Response(null, { status: 202 });
      let payload: string;
      if (msg.method === "initialize") {
        payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: INITIALIZE_RESULT });
      } else {
        payload = JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [], pad: big },
        });
      }
      const encoded = new TextEncoder().encode(payload);
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (let offset = 0; offset < encoded.length; offset += 65536) {
            ctrl.enqueue(encoded.subarray(offset, offset + 65536));
          }
          ctrl.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  await assert.rejects(
    () => client.listCapabilities(),
    (error) => error instanceof AgentKeyError && error.code === "INVALID_PROVIDER_RESPONSE",
  );
});

test("agentkey mismatched execute_as blocks before the gateway", async () => {
  const toolCalls: string[] = [];
  const client = createAgentKeyClient({
    apiKey: "k",
    fetchImpl: mcpFetch([], {
      initialize: () => INITIALIZE_RESULT,
      "tools/list": () => gatewayTools(),
      "tools/call": (params) => {
        const named = params as { name?: string };
        toolCalls.push(String(named.name));
        if (named.name === "find_tools") {
          return {
            isError: false,
            content: [{ type: "text", text: JSON.stringify([{ name: "token_context" }]) }],
          };
        }
        if (named.name === "describe_tool") {
          return {
            isError: false,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  name: "token_context",
                  params: { type: "object" },
                  execute_as: { name: "different_tool" },
                }),
              },
            ],
          };
        }
        return { isError: false, structuredContent: {} };
      },
    }),
  });
  await client.discover("token");
  await assert.rejects(
    () =>
      client.executeVerified({
        name: "token_context",
        purpose: "public_market_context",
        readOnly: true,
        params: {},
        paramsSchema: z.record(z.string(), z.unknown()),
        outputSchema: z.unknown(),
      }),
    (error) => error instanceof AgentKeyError && error.code === "INVALID_PROVIDER_RESPONSE",
  );
  assert.ok(!toolCalls.includes("execute_tool"), "execute_tool must never run on a mismatched descriptor");
});
