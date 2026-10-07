import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import type { DbSession, Queryable } from "../../src/server/db/client";
import { AIError } from "../../src/server/ai/errors";
import type { GenerationResult, LLMProvider, StructuredGenerationRequest } from "../../src/server/ai/types";
import {
  createConfirmHandler,
  createContextHandler,
  createGetHandler,
  createParseHandler,
} from "../../src/server/decisions/http";
import {
  DECISION_PARSE_PROMPT_VERSION,
  decisionInferenceSchema,
  decisionParseSystemPrompt,
} from "../../src/server/decisions/schemas";
import type { MarketContextResult } from "../../src/server/market/service";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "323e4567-e89b-42d3-a456-426614174000";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "external-1" };

const inference = {
  assetSymbol: "rNVDA",
  assetClass: "rtoken" as const,
  side: "long" as const,
  thesis: null,
  catalyst: null,
  evidence: [
    {
      quote: "someone in my Telegram group called it",
      sourceType: "telegram" as const,
      label: "Telegram group",
      url: null,
    },
  ],
  confidence: 0.9,
  intendedEntry: null,
  invalidation: null,
  intendedRiskPct: null,
  timeframe: null,
  origins: [
    {
      label: "borrowed_conviction" as const,
      explanation: "The input cites another person's call.",
      confidence: 0.95,
      observedInputFacts: ["someone in my Telegram group called it"],
    },
    {
      label: "social_confirmation" as const,
      explanation: "The input cites group influence.",
      confidence: 0.8,
      observedInputFacts: ["everyone looked bullish"],
    },
  ],
};

const snapshot = {
  assetSymbol: "rNVDA",
  assetClass: "rtoken" as const,
  side: "long" as const,
  thesis: "The group call may continue the move.",
  origins: ["borrowed_conviction" as const, "social_confirmation" as const],
  sources: [{ sourceType: "telegram" as const, label: "Telegram group", note: "someone in my Telegram group called it" }],
};

function fakeSession(initialStatus: "draft" | "confirmed" = "draft") {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  let status = initialStatus;
  let rawInput = "I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.";
  let confirmedSnapshot: unknown = initialStatus === "confirmed" ? snapshot : null;
  const decision = () => ({
    id: DECISION_ID,
    user_id: USER_ID,
    raw_input: rawInput,
    structured_inference: inference,
    status,
    confirmed_snapshot: confirmedSnapshot,
    confirmed_at: status === "confirmed" ? "2026-10-07T00:00:00.000Z" : null,
    created_at: "2026-10-07T00:00:00.000Z",
    asset_symbol: "rNVDA",
    asset_class: "rtoken",
    side: "long",
  });
  const session: DbSession & { calls: typeof calls } = {
    calls,
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (text.startsWith("INSERT INTO public.users")) return { rows: [{ id: USER_ID }] as T[] };
      if (text.includes("FOR UPDATE") && text.includes("public.decisions")) {
        return values?.[1] === OTHER_ID ? { rows: [] as T[] } : { rows: [decision()] as T[] };
      }
      if (text.startsWith("SELECT * FROM public.decisions")) {
        return values?.[1] === OTHER_ID ? { rows: [] as T[] } : { rows: [decision()] as T[] };
      }
      if (text.startsWith("UPDATE public.decisions")) {
        status = "confirmed";
        confirmedSnapshot = values?.[2];
        return { rows: [decision()] as T[] };
      }
      if (text.startsWith("INSERT INTO public.decisions")) {
        rawInput = String(values?.[1]);
        return { rows: [decision()] as T[] };
      }
      if (text.startsWith("INSERT INTO public.decision_revisions")) return { rows: [{ id: "revision-1", version: 1, snapshot }] as T[] };
      if (text.startsWith("INSERT INTO public.decision_origins")) return { rows: [{ id: "origin-1" }] as T[] };
      if (text.startsWith("INSERT INTO public.evidence_records")) return { rows: [{ id: "evidence-1" }] as T[] };
      if (text.startsWith("INSERT INTO public.decision_sources")) return { rows: [{ id: "source-1" }] as T[] };
      if (text.includes("decision_revisions WHERE")) return { rows: [] as T[] };
      if (text.includes("decision_origins WHERE") || text.includes("decision_sources WHERE") || text.includes("market_context_snapshots WHERE")) return { rows: [] as T[] };
      if (text.startsWith("INSERT INTO public.market_context_snapshots")) return { rows: [{ id: "context-1" }] as T[] };
      return { rows: [] as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      return fn(session);
    },
  };
  return session;
}

function authProvider(context: AuthContext | null = auth) {
  return { getContext: async () => context };
}

function llm(): LLMProvider {
  return {
    async generateText() {
      throw new Error("unused");
    },
    async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<GenerationResult<T>> {
      const result = request.schema.safeParse(inference);
      if (!result.success) throw new AIError("SCHEMA");
      request.validate?.(result.data);
      return {
        value: result.data,
        provider: "groq",
        model: "openai/gpt-oss-120b",
        promptVersion: "decision-parse.v1",
        runId: "run-1",
        attempts: 1,
      };
    },
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("parse creates an owned draft, preserves raw input, and stores grounded origins", async () => {
  const db = fakeSession();
  const rawInput = "  I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.\n";
  const response = await createParseHandler({ authProvider: authProvider(), db, llm: llm() })(request({ text: rawInput }));
  assert.equal(response.status, 201);
  const body = await response.json() as { decision: Record<string, unknown>; inference: typeof inference };
  assert.equal(body.decision.raw_input, rawInput);
  assert.deepEqual(body.inference.origins.map((origin) => origin.label), ["borrowed_conviction", "social_confirmation"]);
  assert.ok(db.calls.some((call) => call.text.startsWith("INSERT INTO public.decision_origins")));
  assert.ok(db.calls.some((call) => call.text.startsWith("INSERT INTO public.evidence_records")));
  assert.ok(!db.calls.some((call) => call.text.includes("confirmed_snapshot")));
});

test("unauthenticated parse returns 401 before touching persistence", async () => {
  const db = fakeSession();
  const response = await createParseHandler({ authProvider: authProvider(null), db, llm: llm() })(request({ text: "thinking about BTC" }));
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("repeated confirmation is idempotent and does not duplicate revision history", async () => {
  const db = fakeSession();
  const handler = createConfirmHandler({ authProvider: authProvider(), db });
  const first = await handler(request(snapshot), { id: DECISION_ID });
  const second = await handler(request(snapshot), { id: DECISION_ID });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).decision.idempotent, true);
  assert.equal(db.calls.filter((call) => call.text.startsWith("INSERT INTO public.decision_revisions")).length, 1);
});

test("cross-owner read returns 404 without exposing another decision", async () => {
  const db = fakeSession();
  const response = await createGetHandler({ authProvider: authProvider(), db })(new Request("http://localhost"), { id: OTHER_ID });
  assert.equal(response.status, 404);
});

test("available market context persists observed facts and provenance evidence", async () => {
  const db = fakeSession("confirmed");
  const available: MarketContextResult = {
    assetClass: "crypto",
    capturedAt: "2026-10-07T00:00:00.000Z",
    status: "available",
    components: {
      sentiment: {
        status: "available",
        data: { scope: "crypto-market", value: 25, classification: "Fear", observedAt: null },
        provenance: {
          evidenceId: "423e4567-e89b-42d3-a456-426614174000",
          provider: "bitget-signal",
          tool: "sentiment_index",
          sourceUrl: "https://datahub.noxiaohao.com/mcp",
          fetchedAt: "2026-10-07T00:00:00.000Z",
        },
      },
    },
  };
  const response = await createContextHandler({ authProvider: authProvider(), db, market: async () => available })(request({}), { id: DECISION_ID });
  assert.equal(response.status, 201);
  assert.equal(db.calls.filter((call) => call.text.startsWith("INSERT INTO public.market_context_snapshots")).length, 1);
  assert.equal(db.calls.filter((call) => call.text.startsWith("INSERT INTO public.evidence_records")).length, 1);
});

test("failed real market context creates no snapshot", async () => {
  const db = fakeSession("confirmed");
  const unavailable: MarketContextResult = {
    assetClass: "stock",
    symbol: "RNVDA",
    capturedAt: "2026-10-07T00:00:00.000Z",
    status: "unavailable",
    components: {
      quote: { status: "unavailable", code: "UPSTREAM_UNAVAILABLE", message: "market provider is unavailable" },
      history: { status: "unavailable", code: "UPSTREAM_UNAVAILABLE", message: "market provider is unavailable" },
    },
  };
  const response = await createContextHandler({ authProvider: authProvider(), db, market: async () => unavailable })(request({}), { id: DECISION_ID });
  assert.equal(response.status, 503);
  assert.equal(db.calls.filter((call) => call.text.startsWith("INSERT INTO public.market_context_snapshots")).length, 0);
});

test("secondary fallback persists partial status, agentkey provider, and owned evidence ids", async () => {
  const db = fakeSession("confirmed");
  const unavailable: MarketContextResult = {
    assetClass: "stock",
    symbol: "RNVDA",
    capturedAt: "2026-10-07T00:00:00.000Z",
    status: "unavailable",
    components: {
      quote: { status: "unavailable", code: "UPSTREAM_UNAVAILABLE", message: "market provider is unavailable" },
      history: { status: "unavailable", code: "TIMEOUT", message: "provider timed out" },
    },
  };
  const secondary = async (query: { assetSymbol: string }, role: string) => ({
    provider: "agentkey" as const,
    status: "available" as const,
    items: [
      {
        kind: "external_context" as const,
        text: "provider-reported context note",
        underlyingSource: "x-search",
        originalId: "post-1",
        url: "https://example.com/post/1",
        retrievedAt: "2026-10-07T00:00:00.000Z",
        query,
        provider: "agentkey" as const,
        role: role as "fallback",
      },
    ],
    error: null,
  });
  const response = await createContextHandler({
    authProvider: authProvider(),
    db,
    market: async () => unavailable,
    secondary,
  })(request({}), { id: DECISION_ID });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { status: string; evidence: { id: string }[] };
  assert.equal(body.status, "partial");
  const insert = db.calls.find((call) => call.text.startsWith("INSERT INTO public.market_context_snapshots"));
  assert.equal(insert?.values?.[3], "agentkey");
  const observedFacts = insert?.values?.[4] as Record<string, unknown>;
  assert.equal(observedFacts.status, "partial");
  assert.equal(observedFacts.primaryStatus, "unavailable");
  const failures = observedFacts.primaryFailures as Record<string, { code: string }>;
  assert.equal(failures.quote.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(failures.history.code, "TIMEOUT");
  const provenance = insert?.values?.[6] as { secondary: { role: string; query: { assetSymbol: string } }[] };
  assert.equal(provenance.secondary[0].role, "fallback");
  assert.equal(provenance.secondary[0].query.assetSymbol, "RNVDA");
  assert.ok(body.evidence.length >= 1);
  for (const row of body.evidence) {
    assert.equal(row.id, "evidence-1");
    assert.notEqual(row.id, "post-1");
  }
});

test("parse prompt v2 pins intendedEntry to token unit price and schema keeps null", () => {
  assert.equal(DECISION_PARSE_PROMPT_VERSION, "decision-parse.v2");
  assert.match(decisionParseSystemPrompt, /TOKEN UNIT PRICE/);
  assert.match(decisionParseSystemPrompt, /valuation context, never unit prices/);
  const parsed = decisionInferenceSchema.safeParse({
    assetSymbol: "SOL",
    assetClass: "crypto",
    side: "long",
    thesis: "Community rotation into SOL ecosystem.",
    catalyst: null,
    evidence: [
      {
        quote: "I got in around 800m market cap",
        sourceType: "telegram",
        label: "Telegram recap",
        url: null,
      },
    ],
    confidence: 0.8,
    intendedEntry: null,
    invalidation: null,
    intendedRiskPct: null,
    timeframe: null,
    origins: [
      {
        label: "social_confirmation",
        explanation: "Group recap influenced the buy.",
        confidence: 0.7,
        observedInputFacts: ["I got in around 800m market cap"],
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.intendedEntry, null);
  }
});
