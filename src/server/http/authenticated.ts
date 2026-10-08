import { z } from "zod";
import { AIError } from "../ai/errors";
import {
  AuthNotConfiguredError,
  AuthProviderUnavailableError,
  requireAuth,
  UnauthenticatedError,
  type AuthContext,
  type AuthProvider,
} from "../auth/context";
import { NeonAuthProvider } from "../auth/neon";
import { createSession, type DbSession } from "../db/client";
import {
  PersistenceError,
  PersistenceUnavailableError,
  RepositoryError,
} from "../db/repositories";
import { TradeError } from "../trades/errors";

const MAX_BODY_BYTES = 16 * 1024;
const BODY_DEADLINE_MS = 5000;

const RESPONSE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

export class RequestBodyTooLargeError extends Error {}
export class RequestBodyTimeoutError extends Error {}
export class RequestValidationError extends Error {}
export class ForbiddenOriginError extends Error {}
export class UnsupportedMediaTypeError extends Error {}
export class ConcurrencySaturatedError extends Error {}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  if (contentType === null || contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeError();
  }
  if (request.body === null) throw new RequestValidationError();
  const reader = request.body.getReader();
  const deadline = Date.now() + BODY_DEADLINE_MS;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reader.cancel().catch(() => {});
        throw new RequestBodyTimeoutError();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new RequestBodyTimeoutError()), remaining);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {}
  }
  if (chunks.length === 0) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestValidationError();
  }
}

export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new ForbiddenOriginError();
  const origin = request.headers.get("origin");
  if (origin === null) return;
  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new ForbiddenOriginError();
  }
  if (suppliedOrigin !== new URL(request.url).origin) throw new ForbiddenOriginError();
}

export interface AuthenticatedDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
}

export interface AuthenticatedContext {
  auth: AuthContext;
  db: DbSession;
}

export async function requireJsonBody(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  return readJson(request);
}

export async function requireAuthenticated(deps: AuthenticatedDeps): Promise<AuthenticatedContext> {
  const db = deps.db ?? createSession();
  const auth = await requireAuth(deps.authProvider ?? new NeonAuthProvider({ db }));
  return { auth, db };
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ConcurrencySaturatedError) {
    return jsonResponse(429, { error: { code: "CONCURRENCY_LIMIT", message: "too many concurrent provider calls" } });
  }
  if (error instanceof RequestValidationError) {
    return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "request failed validation" } });
  }
  if (error instanceof PersistenceUnavailableError || error instanceof PersistenceError) {
    return jsonResponse(503, {
      error: {
        code: error instanceof PersistenceError ? "PERSISTENCE" : "PERSISTENCE_UNAVAILABLE",
        message: error instanceof PersistenceError ? "the record could not be saved" : "persistence is unavailable",
      },
    });
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return jsonResponse(415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "request body must be application/json" } });
  }
  if (error instanceof ForbiddenOriginError) {
    return jsonResponse(403, { error: { code: "FORBIDDEN_ORIGIN", message: "request origin is not allowed" } });
  }
  if (error instanceof RequestBodyTooLargeError) {
    return jsonResponse(413, { error: { code: "PAYLOAD_TOO_LARGE", message: "request body is too large" } });
  }
  if (error instanceof RequestBodyTimeoutError) {
    return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "request failed validation" } });
  }
  if (error instanceof z.ZodError) {
    return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "request failed validation" } });
  }
  if (error instanceof UnauthenticatedError) {
    return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "authentication is required" } });
  }
  if (error instanceof AuthNotConfiguredError) {
    return jsonResponse(503, { error: { code: "AUTH_NOT_CONFIGURED", message: "authentication provider is not configured" } });
  }
  if (error instanceof AuthProviderUnavailableError) {
    return jsonResponse(503, { error: { code: "AUTH_UNAVAILABLE", message: "authentication provider is unavailable" } });
  }
  if (error instanceof TradeError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "INVALID_INPUT"
            ? 400
            : error.code === "UNSUPPORTED"
              ? 422
              : error.code === "PRIVATE_ACCOUNT_FORBIDDEN"
                ? 403
                : 503;
    return jsonResponse(status, { error: { code: error.code, message: error.message } });
  }
  if (error instanceof RepositoryError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : error.code === "CONFIGURATION" ? 503 : 400;
    return jsonResponse(status, {
      error: {
        code:
          error.code === "NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "CONFLICT"
              ? "CONFLICT"
              : error.code === "CONFIGURATION"
                ? "PERSISTENCE_UNAVAILABLE"
                : "INVALID_REQUEST",
        message:
          error.code === "NOT_FOUND"
            ? "the requested record was not found"
            : error.code === "CONFLICT"
              ? "the record conflicts with existing state"
              : "request failed validation",
      },
    });
  }
  if (error instanceof AIError) {
    const status = error.code === "SCHEMA" ? 400 : error.code === "GROUNDING" ? 422 : 503;
    return jsonResponse(status, {
      error: {
        code:
          error.code === "SCHEMA"
            ? "INVALID_REQUEST"
            : error.code === "GROUNDING"
              ? "UNSUPPORTED_INFERENCE"
              : error.code === "PERSISTENCE"
                ? "PERSISTENCE_UNAVAILABLE"
                : "AI_UNAVAILABLE",
        message:
          error.code === "SCHEMA"
            ? "request failed validation"
            : error.code === "GROUNDING"
              ? "inference was not grounded in the supplied input"
              : "AI provider is unavailable",
      },
    });
  }
  return jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "request could not be completed" } });
}

export function createConcurrencyLimiter(limit: number) {
  let active = 0;
  return async function bounded<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) throw new ConcurrencySaturatedError();
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
    }
  };
}

export const providerCallLimiter = createConcurrencyLimiter(4);
