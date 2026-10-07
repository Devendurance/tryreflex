import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthNotConfiguredError,
  UnauthenticatedError,
  requireAuth,
  type AuthContext,
  type AuthProvider,
} from "../../src/server/auth/context";

const validContext: AuthContext = {
  userId: "123e4567-e89b-42d3-a456-426614174000",
  provider: "test",
  subject: "sub-1",
};

test("requireAuth without provider throws AuthNotConfiguredError", async () => {
  await assert.rejects(() => requireAuth(), AuthNotConfiguredError);
});

test("requireAuth with null context throws UnauthenticatedError", async () => {
  const provider: AuthProvider = { getContext: async () => null };
  await assert.rejects(() => requireAuth(provider), UnauthenticatedError);
});

test("requireAuth rejects malformed userId", async () => {
  const provider: AuthProvider = {
    getContext: async () => ({ userId: "not-a-uuid", provider: "test", subject: "sub-1" }),
  };
  await assert.rejects(() => requireAuth(provider), UnauthenticatedError);
});

test("requireAuth rejects empty provider/subject", async () => {
  const provider: AuthProvider = {
    getContext: async () => ({ userId: validContext.userId, provider: "", subject: "sub-1" }),
  };
  await assert.rejects(() => requireAuth(provider), UnauthenticatedError);
});

test("requireAuth returns validated immutable context", async () => {
  const provider: AuthProvider = { getContext: async () => ({ ...validContext }) };
  const context = await requireAuth(provider);
  assert.equal(context.userId, validContext.userId);
  assert.equal(context.provider, "test");
  assert.equal(context.subject, "sub-1");
  assert.ok(Object.isFrozen(context));
});
