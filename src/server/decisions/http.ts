import { z } from "zod";
import { AIError } from "../ai/errors";
import type { LLMProvider } from "../ai/types";
import {
  AuthNotConfiguredError,
  AuthProviderUnavailableError,
  requireAuth,
  UnauthenticatedError,
  type AuthProvider,
} from "../auth/context";
import { NeonAuthProvider } from "../auth/neon";
import type { DbSession } from "../db/client";
import { createSession } from "../db/client";
import { RepositoryError, createRepositories } from "../db/repositories";
import { GroqLLMProvider } from "../ai/groq";
import { marketContextResponseSchema, marketRequestSchema, type MarketRequest } from "../market/schemas";
import { getMarketContext, type MarketContextResult } from "../market/service";
import {
  getDecisionContext,
  secondaryEvidenceEntries,
} from "../context/service";
import type { SecondaryContextQuery, SecondaryContextResult } from "../context/schemas";
import { decisionSnapshotSchema } from "../db/validation";
import { buildDecisionView, marketRequestForDecision, parseDecision } from "./service";

const MAX_PARSE_BODY_BYTES = 40000;
const MAX_CONFIRM_BODY_BYTES = 20000;
const MAX_CONTEXT_BODY_BYTES = 4096;
const UUID_SCHEMA = z.string().uuid();
const contextBodySchema = z.strictObject({
  startTime: z.number().safe().int().nonnegative().optional(),
  endTime: z.number().safe().int().nonnegative().optional(),
  enrichment: z.boolean().optional(),
});

export interface DecisionRouteDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
  llm?: LLMProvider;
  market?: (request: MarketRequest) => Promise<MarketContextResult>;
  secondary?: (
    query: SecondaryContextQuery,
    role: "fallback" | "enrichment",
  ) => Promise<SecondaryContextResult>;
}

type RouteContext = {
  repos: ReturnType<typeof createRepositories>;
  llm: LLMProvider;
  market: (request: MarketRequest) => Promise<MarketContextResult>;
};

export class RequestBodyTooLargeError extends Error {}

const RESPONSE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.body === null) throw new Error("invalid request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
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
    throw new Error("invalid JSON");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestBodyTooLargeError) {
    return jsonResponse(413, { error: { code: "PAYLOAD_TOO_LARGE", message: "request body is too large" } });
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
  if (error instanceof RepositoryError) {
    const response =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : error.code === "CONFIGURATION" ? 503 : 400;
    return jsonResponse(response, {
      error: {
        code: error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "CONFLICT" ? "CONFLICT" : "INVALID_REQUEST",
        message:
          error.code === "NOT_FOUND"
            ? "decision not found"
            : error.code === "CONFLICT"
              ? "decision state does not allow this operation"
              : error.code === "CONFIGURATION"
                ? "persistence is not configured"
                : "request failed validation",
      },
    });
  }
  if (error instanceof AIError) {
    const response = error.code === "SCHEMA" ? 400 : error.code === "GROUNDING" ? 422 : 503;
    return jsonResponse(response, {
      error: {
        code: error.code === "SCHEMA" ? "INVALID_REQUEST" : error.code === "GROUNDING" ? "UNSUPPORTED_INFERENCE" : "AI_UNAVAILABLE",
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

async function getRouteContext(deps: DecisionRouteDeps, useLlm: boolean): Promise<RouteContext> {
  const auth = await requireAuth(deps.authProvider ?? new NeonAuthProvider({ db: deps.db }));
  const db = deps.db ?? createSession();
  const repos = createRepositories(db, auth);
  await repos.users.provision();
  return {
    repos,
    llm: deps.llm ?? (useLlm ? new GroqLLMProvider({ recorder: repos.aiRuns }) : (undefined as never)),
    market: deps.market ?? getMarketContext,
  };
}

export function createParseHandler(deps: DecisionRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const body = await readJson(request, MAX_PARSE_BODY_BYTES);
      const context = await getRouteContext(deps, true);
      return jsonResponse(201, await parseDecision(context.repos, context.llm, body));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createConfirmHandler(deps: DecisionRouteDeps = {}) {
  return async function POST(request: Request, params: { id: string }): Promise<Response> {
    try {
      const id = UUID_SCHEMA.parse(params.id);
      const body = await readJson(request, MAX_CONFIRM_BODY_BYTES);
      const snapshot = decisionSnapshotSchema.parse(body);
      const { repos } = await getRouteContext(deps, false);
      const decision = await repos.decisions.confirm(id, snapshot);
      return jsonResponse(200, {
        decision: {
          id: decision.id,
          status: decision.status,
          rawInput: decision.raw_input,
          confirmedSnapshot: decision.confirmed_snapshot ?? snapshot,
          revision: decision.revision ?? null,
          idempotent: decision.idempotent ?? false,
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createGetHandler(deps: DecisionRouteDeps = {}) {
  return async function GET(_request: Request, params: { id: string }): Promise<Response> {
    try {
      const id = UUID_SCHEMA.parse(params.id);
      const { repos } = await getRouteContext(deps, false);
      const decision = await repos.decisions.get(id);
      if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
      const [revisions, origins, sources, contexts] = await Promise.all([
        repos.decisionRevisions.listForDecision(id),
        repos.decisionOrigins.listForDecision(id),
        repos.decisionSources.listForDecision(id),
        repos.marketContextSnapshots.listForDecision(id),
      ]);
      return jsonResponse(200, {
        decision: buildDecisionView(decision, revisions),
        origins,
        sources,
        marketContextSnapshots: contexts,
        revisions: revisions.map((revision) => ({ id: revision.id, version: revision.version, createdAt: revision.created_at })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const listQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const EXCERPT_LENGTH = 180;

/** Owner-scoped recent decisions. Summaries only; the full record stays behind GET /api/decisions/[id]. */
export function createListHandler(deps: DecisionRouteDeps = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const { limit } = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      const { repos } = await getRouteContext(deps, false);
      const rows = await repos.decisions.list(limit + 1);
      return jsonResponse(200, {
        decisions: rows.slice(0, limit).map((row) => {
          const raw = typeof row.raw_input === "string" ? row.raw_input : "";
          return {
            id: row.id,
            status: row.status,
            assetSymbol: row.asset_symbol ?? null,
            assetClass: row.asset_class ?? null,
            side: row.side ?? null,
            createdAt: row.created_at,
            confirmedAt: row.confirmed_at ?? null,
            excerpt: raw.length > EXCERPT_LENGTH ? `${raw.slice(0, EXCERPT_LENGTH).trimEnd()}…` : raw,
          };
        }),
        hasMore: rows.length > limit,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function contextFacts(result: MarketContextResult): { observedFacts: Record<string, unknown>; provenance: Record<string, unknown>; evidenceLabels: string[]; providers: string[] } {
  const observedComponents: Record<string, unknown> = {};
  const provenanceComponents: Record<string, unknown> = {};
  const primaryFailures: Record<string, unknown> = {};
  const evidenceLabels: string[] = [];
  const providers = new Set<string>();
  for (const [name, component] of Object.entries(result.components)) {
    if (component.status !== "available") {
      primaryFailures[name] = { code: component.code, message: component.message };
      continue;
    }
    observedComponents[name] = component.data;
    const { evidenceId: serviceCorrelationId, ...rest } = component.provenance;
    provenanceComponents[name] = { ...rest, serviceCorrelationId };
    providers.add(component.provenance.provider);
    evidenceLabels.push(`${name}:${component.provenance.provider}:${component.provenance.tool}`);
  }
  return {
    observedFacts: { assetClass: result.assetClass, ...(result.symbol === undefined ? {} : { symbol: result.symbol }), capturedAt: result.capturedAt, status: result.status, components: observedComponents, primaryFailures },
    provenance: { provider: [...providers], components: provenanceComponents },
    evidenceLabels,
    providers: [...providers],
  };
}

function secondaryFacts(secondary: SecondaryContextResult | null): {
  observedFacts: Record<string, unknown> | null;
  provenance: Record<string, unknown>[] | null;
  labels: string[];
} {
  const entries = secondaryEvidenceEntries(secondary);
  if (entries.items.length === 0) return { observedFacts: null, provenance: null, labels: [] };
  return {
    observedFacts: {
      secondary: entries.items.map((item) => ({
        kind: item.kind,
        text: item.text,
        role: item.role,
        retrievedAt: item.retrievedAt,
      })),
    },
    provenance: entries.provenance,
    labels: entries.labels,
  };
}

export function createContextHandler(deps: DecisionRouteDeps = {}) {
  return async function POST(request: Request, params: { id: string }): Promise<Response> {
    try {
      const id = UUID_SCHEMA.parse(params.id);
      const body = contextBodySchema.parse(await readJson(request, MAX_CONTEXT_BODY_BYTES));
      const { repos, market } = await getRouteContext(deps, false);
      const decision = await repos.decisions.get(id);
      if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
      if (decision.status !== "confirmed" && decision.status !== "closed") {
        throw new RepositoryError("decision must be confirmed before context capture", "CONFLICT");
      }
      const marketRequest = marketRequestSchema.parse(marketRequestForDecision(decision, body));
      const secondaryQuery =
        typeof decision.asset_symbol === "string" && decision.asset_symbol.trim().length > 0
          ? { assetSymbol: decision.asset_symbol.trim().toUpperCase() }
          : undefined;
      const combined = await getDecisionContext(
        {
          ...marketRequest,
          enrichment: body.enrichment === true,
          ...(secondaryQuery === undefined ? {} : { secondaryQuery }),
        },
        { primary: market, ...(deps.secondary === undefined ? {} : { secondary: deps.secondary }) },
      );
      const result = marketContextResponseSchema.parse(combined.primary);
      if (combined.status === "unavailable") {
        return jsonResponse(503, {
          error: { code: "UPSTREAM_UNAVAILABLE", message: "market provider is unavailable" },
          primary: { status: result.status },
          secondary:
            combined.secondary === null
              ? null
              : {
                  provider: combined.secondary.provider,
                  code: combined.secondary.error?.code ?? null,
                },
        });
      }
      const facts = contextFacts(result);
      const secondary = secondaryFacts(combined.secondary);
      const providers = [...facts.providers, ...(secondary.provenance === null ? [] : ["agentkey"])];
      const persisted = await repos.marketContextSnapshots.appendWithEvidence({
        snapshot: {
          decisionId: id,
          capturedAt: combined.capturedAt,
          provider: providers.join(","),
          observedFacts: {
            ...facts.observedFacts,
            capturedAt: combined.capturedAt,
            status: combined.status,
            primaryStatus: result.status,
            ...(secondary.observedFacts === null ? {} : secondary.observedFacts),
          },
          provenance: {
            ...facts.provenance,
            ...(secondary.provenance === null ? {} : { secondary: secondary.provenance }),
          },
        },
        evidenceLabels: [...facts.evidenceLabels, ...secondary.labels],
      });
      return jsonResponse(201, { snapshot: persisted.snapshot, evidence: persisted.evidence, status: combined.status });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
