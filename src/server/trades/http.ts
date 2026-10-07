import type { AuthProvider } from "../auth/context";
import type { DbSession } from "../db/client";
import {
  errorResponse,
  jsonResponse,
  providerCallLimiter,
  requireAuthenticated,
  requireJsonBody,
} from "../http/authenticated";
import { BitgetTradeProvider, type TradeProvider } from "./provider";
import { createTradeRepository } from "./repository";
import { assertPrivateAccountBinding, attachManualTrade, importSelectedTrades } from "./service";

export interface TradeRouteDeps {
  authProvider?: AuthProvider;
  db?: DbSession;
  provider?: TradeProvider;
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
