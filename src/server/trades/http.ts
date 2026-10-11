import type { AuthContext, AuthProvider } from "../auth/context";
import type { DbSession } from "../db/client";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
} from "../http/authenticated";
import { TradeError } from "./errors";
import { BitgetTradeProvider, tradeHistoryQuerySchema, type TradeHistoryQuery, type TradeProvider } from "./provider";
import { createTradeRepository } from "./repository";
import { assertPrivateAccountBinding, attachManualTrade, importSelectedTrades } from "./service";

export interface TradeRouteDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
  provider?: TradeProvider;
}

export function createPreviewTradesHandler(deps: TradeRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    let auth: AuthContext;
    let query: TradeHistoryQuery;
    try {
      const authenticated = await requireAuthenticated(deps);
      auth = authenticated.auth;
      const body = await requireJsonBody(request);
      const parsed = tradeHistoryQuerySchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(new TradeError("INVALID_INPUT"));
      }
      query = parsed.data;
    } catch (error) {
      return errorResponse(error);
    }
    try {
      assertPrivateAccountBinding(auth);
    } catch (error) {
      return errorResponse(error);
    }
    try {
      const provider = deps.provider ?? new BitgetTradeProvider();
      const result = await providerCallLimiter(() => provider.listTrades(query));
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error, { includeDiagnosis: true });
    }
  };
}

export function createBitgetAvailabilityHandler(deps: TradeRouteDeps = {}) {
  return async function GET(): Promise<Response> {
    try {
      const { auth } = await requireAuthenticated(deps);
      assertPrivateAccountBinding(auth);
      return jsonResponse(200, { available: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createManualTradeHandler(deps: TradeRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const body = await requireJsonBody(request);
      const repo = createTradeRepository(db, auth);
      const result = await providerCallLimiter(() => attachManualTrade(repo, body));
      return jsonResponse(201, {
        trade: result.trade,
        created: result.created,
        event: result.event,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createImportTradesHandler(deps: TradeRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const body = await requireJsonBody(request);
      const repo = createTradeRepository(db, auth);
      assertPrivateAccountBinding(auth);
      const provider = deps.provider ?? new BitgetTradeProvider();
      const result = await providerCallLimiter(() => importSelectedTrades(repo, provider, auth, body));
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
