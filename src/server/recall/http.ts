import type { EmbeddingProvider, LLMProvider } from "../ai/types";
import { JinaEmbeddingProvider } from "../ai/jina";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
  type AuthenticatedDeps,
} from "../http/authenticated";
import { recallInputSchema } from "../recall-policy";
import { recallProposal } from "./service";

export interface RecallDeps extends AuthenticatedDeps {
  embedder?: EmbeddingProvider;
  llm?: LLMProvider;
}

export function createRecallHandler(deps: RecallDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const input = recallInputSchema.parse(await requireJsonBody(request));
      const embedder: EmbeddingProvider = deps.embedder ?? {
        embedQuery: (text) => new JinaEmbeddingProvider().embedQuery(text),
        embedDocument: (text) => new JinaEmbeddingProvider().embedDocument(text),
        embedMany: (texts, mode) => new JinaEmbeddingProvider().embedMany(texts, mode),
      };
      const result = await providerCallLimiter(() => recallProposal({ db, auth, embedder, llm: deps.llm }, input));
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
