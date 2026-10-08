import { z } from "zod";
import { JinaEmbeddingProvider } from "../ai/jina";
import type { EmbeddingProvider } from "../ai/types";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
  type AuthenticatedDeps,
} from "../http/authenticated";
import { playbookDecisionSchema } from "../playbook-policy";
import { createPlaybookRepository } from "./repository";

export interface PlaybookDeps extends AuthenticatedDeps {
  embedder?: EmbeddingProvider;
}

const emptyBodySchema = z.strictObject({});

function lazyEmbedder(embedder?: EmbeddingProvider): EmbeddingProvider {
  return (
    embedder ?? {
      embedQuery: (text) => new JinaEmbeddingProvider().embedQuery(text),
      embedDocument: (text) => new JinaEmbeddingProvider().embedDocument(text),
      embedMany: (texts, mode) => new JinaEmbeddingProvider().embedMany(texts, mode),
    }
  );
}

export function createPlaybookHandler(deps: PlaybookDeps = {}) {
  return async function GET(): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      return jsonResponse(200, await createPlaybookRepository(db, auth).getPlaybook());
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createProposePlaybookHandler(deps: PlaybookDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      emptyBodySchema.parse(await requireJsonBody(request));
      return jsonResponse(200, await createPlaybookRepository(db, auth).propose());
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createPlaybookDecisionHandler(deps: PlaybookDeps = {}) {
  return async function POST(request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const { action } = playbookDecisionSchema.parse(await requireJsonBody(request));
      const repo = createPlaybookRepository(db, auth);
      const result =
        action === "accept"
          ? await providerCallLimiter(() => repo.decide(params.id, action, lazyEmbedder(deps.embedder)))
          : await repo.decide(params.id, action, lazyEmbedder(deps.embedder));
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
