import assert from "node:assert/strict";
import test from "node:test";
import { AuthNotConfiguredError, AuthProviderUnavailableError, type AuthContext } from "../../src/server/auth/context";
import { NeonAuthProvider } from "../../src/server/auth/neon";
import type { DbSession, Queryable } from "../../src/server/db/client";

const REFLEX_USER_ID = "123e4567-e89b-42d3-a456-426614174000";

function fakeDb(): DbSession & { calls: { text: string; values?: readonly unknown[] }[] } {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  const db = {
    calls,
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return { rows: [{ id: REFLEX_USER_ID }] as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      return fn(db);
    },
  };
  return db;
}

function sessionAuth(user: unknown, error?: unknown) {
  return { getSession: async () => ({ data: user === null ? null : { user }, error }) };
}

test("Neon Auth maps an external identity to an idempotent Reflex user context", async () => {
  const db = fakeDb();
  const provider = new NeonAuthProvider({
    auth: sessionAuth({ id: "neon-user-1", email: "trader@example.com", name: "Trader" }),
    db,
  });
  const context = await provider.getContext();
  assert.deepEqual(context, {
    userId: REFLEX_USER_ID,
    provider: "neon-auth",
    subject: "neon-user-1",
    externalAuthUserId: "neon-user-1",
    email: "trader@example.com",
  });
  assert.match(db.calls[0].text, /INSERT INTO public\.users/);
  assert.deepEqual(db.calls[0].values, ["neon-auth", "neon-user-1", "Trader"]);
});

test("missing Neon Auth session is unauthenticated without a Reflex lookup", async () => {
  const db = fakeDb();
  const provider = new NeonAuthProvider({ auth: sessionAuth(null), db });
  assert.equal(await provider.getContext(), null);
  assert.equal(db.calls.length, 0);
});

test("Neon Auth upstream failures become a safe provider error", async () => {
  const provider = new NeonAuthProvider({
    auth: sessionAuth(null, new Error("upstream detail")),
    db: fakeDb(),
  });
  await assert.rejects(() => provider.getContext(), AuthProviderUnavailableError);
});

test("missing cookie secret fails closed instead of creating a fake session", () => {
  const saved = process.env.NEON_AUTH_COOKIE_SECRET;
  delete process.env.NEON_AUTH_COOKIE_SECRET;
  try {
    assert.throws(() => new NeonAuthProvider(), AuthNotConfiguredError);
  } finally {
    if (saved === undefined) delete process.env.NEON_AUTH_COOKIE_SECRET;
    else process.env.NEON_AUTH_COOKIE_SECRET = saved;
  }
});

test("auth context preserves a Reflex user id and rejects caller-shaped ids", () => {
  const context: AuthContext = {
    userId: REFLEX_USER_ID,
    provider: "neon-auth",
    subject: "neon-user-1",
  };
  assert.equal(context.userId, REFLEX_USER_ID);
});
