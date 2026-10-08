import type { LLMProvider } from "../ai/types";
import type { AuthProvider } from "../auth/context";
import type { DbSession } from "../db/client";
import { createRepositories } from "../db/repositories";
import { GroqLLMProvider } from "../ai/groq";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
  RequestValidationError,
} from "../http/authenticated";
import { createReviewRepository } from "./repository";
import { generateReview, getReview } from "./service";

export interface ReviewRouteDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
  llm?: LLMProvider;
}

export function createGenerateReviewHandler(deps: ReviewRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const body = await requireJsonBody(request);
      const repo = createReviewRepository(db, auth);
      const llm = deps.llm ?? new GroqLLMProvider({ recorder: createRepositories(db, auth).aiRuns, maxCompletionTokens: 8192 });
      const result = await providerCallLimiter(() => generateReview(repo, llm, body));
      return jsonResponse(201, {
        review: result.review,
        dimensions: result.dimensions,
        decisionQuality: result.decisionQuality,
        classification: result.classification,
        planDrift: result.planDrift,
        runId: result.runId,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createListReviewsHandler(deps: ReviewRouteDeps = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const url = new URL(request.url);
      for (const key of url.searchParams.keys()) {
        if (key !== "limit" && key !== "cursor") throw new RequestValidationError();
      }
      const limit = url.searchParams.get("limit");
      if (limit !== null && !/^\d{1,3}$/.test(limit)) throw new RequestValidationError();
      return jsonResponse(200, await createReviewRepository(db, auth).listReviews(limit === null ? 20 : Number(limit), url.searchParams.get("cursor")));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createDecisionTradesHandler(deps: ReviewRouteDeps = {}) {
  return async function GET(_request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      return jsonResponse(200, await createReviewRepository(db, auth).listDecisionTrades(params.id));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createGetReviewHandler(deps: ReviewRouteDeps = {}) {
  return async function GET(_request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const repo = createReviewRepository(db, auth);
      return jsonResponse(200, { review: await getReview(repo, params.id) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
