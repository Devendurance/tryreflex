import { isDeepStrictEqual } from "node:util";
import { getMarketContext, type MarketContextResult } from "../market/service";
import { marketContextResponseSchema, type MarketRequest } from "../market/schemas";
import { AgentKeyError, createAgentKeyClient, type AgentKeyClient } from "../integrations/agentkey/client";
import {
  secondaryContextResultSchema,
  type SecondaryContextItem,
  type SecondaryContextQuery,
  type SecondaryContextResult,
} from "./schemas";

export type DecisionContextRequest = MarketRequest & {
  enrichment?: boolean;
  secondaryQuery?: SecondaryContextQuery;
};

export interface DecisionContextResult {
  status: "available" | "partial" | "unavailable";
  capturedAt: string;
  primary: MarketContextResult;
  secondary: SecondaryContextResult | null;
}

export interface DecisionContextDeps {
  primary?: (request: MarketRequest) => Promise<MarketContextResult>;
  secondary?: (
    query: SecondaryContextQuery,
    role: "fallback" | "enrichment",
  ) => Promise<SecondaryContextResult>;
}

function secondaryFailure(code: string, message: string): SecondaryContextResult {
  return {
    provider: "agentkey",
    status: "unavailable",
    items: [],
    error: { code, message },
  };
}

let cachedClient: AgentKeyClient | null = null;

async function defaultSecondaryProvider(): Promise<SecondaryContextResult> {
  try {
    cachedClient ??= createAgentKeyClient();
    await cachedClient.listCapabilities();
    return secondaryFailure(
      "CAPABILITY_NOT_VERIFIED",
      "no verified secondary context plan is configured",
    );
  } catch (error) {
    if (error instanceof AgentKeyError) {
      return secondaryFailure(error.code, "secondary context unavailable");
    }
    return secondaryFailure("UNAVAILABLE", "secondary context unavailable");
  }
}

function unavailablePrimary(request: MarketRequest, capturedAt: string): MarketContextResult {
  const failure = {
    status: "unavailable" as const,
    code: "INVALID_PROVIDER_RESPONSE" as const,
    message: "primary market response failed validation",
  };
  if (request.assetClass === "crypto") {
    return {
      assetClass: "crypto",
      capturedAt,
      status: "unavailable",
      components: { sentiment: failure },
    };
  }
  return {
    assetClass: "stock",
    symbol: request.symbol,
    capturedAt,
    status: "unavailable",
    components: { quote: failure, history: failure },
  };
}

export async function getDecisionContext(
  request: DecisionContextRequest,
  deps: DecisionContextDeps = {},
): Promise<DecisionContextResult> {
  const primaryFn = deps.primary ?? getMarketContext;
  const secondaryFn = deps.secondary ?? defaultSecondaryProvider;

  let primary: MarketContextResult;
  try {
    const raw = await primaryFn(request);
    const checked = marketContextResponseSchema.safeParse(raw);
    primary = checked.success ? raw : unavailablePrimary(request, new Date().toISOString());
  } catch {
    primary = unavailablePrimary(request, new Date().toISOString());
  }

  const role = primary.status === "available" ? "enrichment" : "fallback";
  const wantsSecondary = primary.status !== "available" || request.enrichment === true;

  let secondary: SecondaryContextResult | null = null;
  if (wantsSecondary) {
    if (request.secondaryQuery === undefined) {
      secondary = secondaryFailure(
        "CAPABILITY_NOT_VERIFIED",
        "secondary context requires an owned asset reference",
      );
    } else {
      try {
        const result = await secondaryFn(request.secondaryQuery, role);
        const parsed = secondaryContextResultSchema.safeParse(result);
        if (!parsed.success) {
          secondary = secondaryFailure(
            "INVALID_PROVIDER_RESPONSE",
            "secondary payload failed validation",
          );
        } else {
          const mismatch = parsed.data.items.some(
            (item) =>
              item.role !== role || !isDeepStrictEqual(item.query, request.secondaryQuery),
          );
          secondary = mismatch
            ? secondaryFailure(
                "INVALID_PROVIDER_RESPONSE",
                "secondary items do not match the requested query",
              )
            : parsed.data;
        }
      } catch (error) {
        secondary =
          error instanceof AgentKeyError
            ? secondaryFailure(error.code, "secondary context unavailable")
            : secondaryFailure("UNAVAILABLE", "secondary context unavailable");
      }
    }
  }

  const capturedAt = new Date().toISOString();
  const secondaryAvailable = secondary !== null && secondary.status === "available";
  let status: DecisionContextResult["status"];
  if (secondaryAvailable) {
    status = primary.status === "available" ? "available" : "partial";
  } else {
    status = primary.status;
  }

  return { status, capturedAt, primary, secondary };
}

export function secondaryEvidenceEntries(secondary: SecondaryContextResult | null): {
  items: SecondaryContextItem[];
  labels: string[];
  provenance: Record<string, unknown>[];
} {
  if (secondary === null || secondary.status !== "available") {
    return { items: [], labels: [], provenance: [] };
  }
  const labels: string[] = [];
  const provenance: Record<string, unknown>[] = [];
  secondary.items.forEach((item, index) => {
    labels.push(`external_context:${item.provider}:${item.underlyingSource}:${index}`);
    provenance.push({
      provider: item.provider,
      role: item.role,
      underlyingSource: item.underlyingSource,
      originalId: item.originalId,
      url: item.url,
      retrievedAt: item.retrievedAt,
      query: item.query,
      timing: "post_decision_capture",
    });
  });
  return { items: secondary.items, labels, provenance };
}
