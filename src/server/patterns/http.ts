import { z } from "zod";
import type { EmbeddingProvider } from "../ai/types";
import { JinaEmbeddingProvider } from "../ai/jina";
import type { AuthProvider } from "../auth/context";
import type { DbSession } from "../db/client";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
} from "../http/authenticated";
import { createPatternsRepository } from "./repository";

export interface PatternRouteDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
  embedder?: EmbeddingProvider;
}

const recomputeBodySchema = z.strictObject({});

export function createRecomputePatternsHandler(deps: PatternRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      recomputeBodySchema.parse(await requireJsonBody(request));
      const repo = createPatternsRepository(db, auth);
      const embedder = deps.embedder ?? new JinaEmbeddingProvider();
      const result = await providerCallLimiter(() => repo.recomputeDNA(embedder));
      return jsonResponse(200, {
        eventsLoaded: result.eventsLoaded,
        evidenceStats: result.evidenceStats,
        patterns: result.candidates.map((candidate, index) => ({
          id: result.saved[index]?.id ?? null,
          fingerprint: candidate.fingerprint,
          category: candidate.category,
          status: candidate.status,
          description: candidate.description,
          evidenceCount: candidate.evidenceCount,
          confidence: candidate.confidence,
          evidenceRefs: candidate.evidenceRefs,
        })),
        retiredCount: result.retiredIds.length,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createDNAHandler(deps: PatternRouteDeps = {}) {
  return async function GET(): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const repo = createPatternsRepository(db, auth);
      return jsonResponse(200, await repo.getDNA());
    } catch (error) {
      return errorResponse(error);
    }
  };
}
