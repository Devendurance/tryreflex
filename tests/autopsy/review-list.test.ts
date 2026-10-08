import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import { createDecisionTradesHandler, createListReviewsHandler } from "../../src/server/reviews/http";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_USER = "999e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "223e4567-e89b-42d3-a456-426614174000";
const FOREIGN_DECISION = "323e4567-e89b-42d3-a456-426614174000";
const TRADE_ID = "423e4567-e89b-42d3-a456-426614174000";
const REVIEW_ID = "523e4567-e89b-42d3-a456-426614174000";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };
const authProvider = (context: AuthContext | null = auth) => ({ getContext: async () => context });

type Row = Record<string, unknown>;
const decisions: Row[] = [
  { id: DECISION_ID, user_id: USER_ID },
  { id: FOREIGN_DECISION, user_id: OTHER_USER },
];
const reviews: Row[] = [
  { id: REVIEW_ID, user_id: USER_ID, version: 1, is_current: true, trade_id: TRADE_ID, decision_id: DECISION_ID, created_at: "2026-10-01T00:00:00Z", process_classification: null, decision_quality: { status: "provisional", score: 37.8125, evidenceCoveragePct: 80, weights: {} }, symbol: "RUNNER", side: "long", observed_metrics: { secret: true } },
  { id: "623e4567-e89b-42d3-a456-426614174000", user_id: OTHER_USER, version: 1, is_current: true, trade_id: TRADE_ID, decision_id: FOREIGN_DECISION, created_at: "2026-10-02T00:00:00Z", symbol: "FOREIGN", side: "long" },
];
const trades: Row[] = [
  { id: TRADE_ID, user_id: USER_ID, decision_id: DECISION_ID, provider: "manual", symbol: "RUNNER", side: "long", quantity: null, entry_price: null, exit_price: null, opened_at: null, closed_at: null, created_at: "2026-10-01T00:00:00Z", review_id: REVIEW_ID, review_version: 1, review_created_at: "2026-10-01T00:00:00Z" },
  { id: "723e4567-e89b-42d3-a456-426614174000", user_id: OTHER_USER, decision_id: FOREIGN_DECISION, provider: "manual", symbol: "FOREIGN", side: "long", created_at: "2026-10-02T00:00:00Z" },
];

function ownerDb() {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const query = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    const owner = values[0];
    if (text.includes("FROM public.decisions")) return { rows: decisions.filter((row) => row.user_id === owner && row.id === values[1]) };
    if (text.includes("FROM public.reviews r JOIN")) return { rows: reviews.filter((row) => row.user_id === owner).slice(0, Number(values[2])) };
    if (text.includes("FROM public.trades t")) return { rows: trades.filter((row) => row.user_id === owner && row.decision_id === values[1]) };
    return { rows: [] };
  };
  return { calls, db: { query, transaction: async <T>(fn: (q: { query: typeof query }) => Promise<T>) => fn({ query }) } };
}

const get = (path: string) => new Request(`http://localhost:3002${path}`);

test("review list is owner-scoped, bounded, and returns summaries only", async () => {
  const { db, calls } = ownerDb();
  const response = await createListReviewsHandler({ authProvider: authProvider(), db: db as never })(get("/api/reviews?limit=5"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reviews.length, 1);
  assert.deepEqual(body.reviews[0].decisionQuality, { status: "provisional", score: 37.8125, evidenceCoveragePct: 80 });
  assert.equal(body.reviews[0].symbol, "RUNNER");
  assert.equal("observed_metrics" in body.reviews[0], false);
  assert.equal(body.nextCursor, null);
  assert.deepEqual(calls[0].values, [USER_ID, null, 6]);
});

test("review list rejects unknown keys, bad limits, and anonymous callers", async () => {
  const { db } = ownerDb();
  const handler = createListReviewsHandler({ authProvider: authProvider(), db: db as never });
  assert.equal((await handler(get("/api/reviews?userId=x"))).status, 400);
  assert.equal((await handler(get("/api/reviews?limit=51"))).status, 400);
  assert.equal((await handler(get("/api/reviews?limit=abc"))).status, 400);
  assert.equal((await handler(get("/api/reviews?cursor=not-a-uuid"))).status, 400);
  const anonymous = createListReviewsHandler({ authProvider: authProvider(null), db: db as never });
  assert.equal((await anonymous(get("/api/reviews"))).status, 401);
});

test("decision trades return owned trades with their current review", async () => {
  const { db } = ownerDb();
  const handler = createDecisionTradesHandler({ authProvider: authProvider(), db: db as never });
  const response = await handler(get(`/api/decisions/${DECISION_ID}/trades`), { id: DECISION_ID });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.trades.length, 1);
  assert.equal(body.trades[0].quantity, null);
  assert.deepEqual(body.trades[0].currentReview, { id: REVIEW_ID, version: 1, createdAt: "2026-10-01T00:00:00Z" });
});

test("decision trades deny foreign or malformed decisions and anonymous callers", async () => {
  const { db } = ownerDb();
  const handler = createDecisionTradesHandler({ authProvider: authProvider(), db: db as never });
  assert.equal((await handler(get("/x"), { id: FOREIGN_DECISION })).status, 404);
  assert.equal((await handler(get("/x"), { id: "nope" })).status, 400);
  const anonymous = createDecisionTradesHandler({ authProvider: authProvider(null), db: db as never });
  assert.equal((await anonymous(get("/x"), { id: DECISION_ID })).status, 401);
});
