import { AIError } from "../ai/errors";
import type { LLMProvider } from "../ai/types";
import { RepositoryError, type createRepositories } from "../db/repositories";
import {
  DECISION_PARSE_PROMPT_VERSION,
  decisionInferenceSchema,
  decisionParseInputSchema,
  decisionParseSystemPrompt,
  type DecisionInference,
} from "./schemas";

type Repositories = ReturnType<typeof createRepositories>;

function validateInference(rawInput: string, inference: DecisionInference): void {
  const labels = inference.origins.map((origin) => origin.label);
  if (new Set(labels).size !== labels.length) throw new AIError("GROUNDING");
  for (const origin of inference.origins) {
    if (origin.observedInputFacts.length === 0 || origin.observedInputFacts.some((quote) => !rawInput.includes(quote))) {
      throw new AIError("GROUNDING");
    }
  }
  for (const evidence of inference.evidence) {
    if (!rawInput.includes(evidence.quote)) throw new AIError("GROUNDING");
  }
}

export async function parseDecision(
  repos: Repositories,
  provider: LLMProvider,
  input: unknown,
): Promise<Record<string, unknown>> {
  const parsed = decisionParseInputSchema.safeParse(input);
  if (!parsed.success) throw new AIError("SCHEMA");
  const rawInput = parsed.data.text;
  const draft = await repos.decisions.createDraft({ rawInput });
  const decisionId = draft.id;
  if (typeof decisionId !== "string") throw new RepositoryError("decision could not be created", "CONFLICT");
  const result = await provider.generateStructured({
    system: decisionParseSystemPrompt,
    input: rawInput,
    pipeline: "decision-parse",
    promptVersion: DECISION_PARSE_PROMPT_VERSION,
    inputEntityIds: [decisionId],
    schema: decisionInferenceSchema,
    schemaName: "decision_inference",
    validate: (value) => validateInference(rawInput, value),
  });
  const inference = result.value;
  const saved = await repos.decisions.applyInference(decisionId, {
    structuredInference: inference,
    assetSymbol: inference.assetSymbol === null ? null : inference.assetSymbol.trim().toUpperCase(),
    assetClass: inference.assetClass,
    side: inference.side,
    origins: inference.origins,
    evidenceQuotes: inference.evidence.map((evidence) => evidence.quote),
    sources: inference.evidence.map((evidence) => ({
      sourceType: evidence.sourceType,
      label: evidence.label,
      url: evidence.url,
      note: evidence.quote,
    })),
  });
  return {
    decision: saved,
    inference,
    ai: {
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      runId: result.runId,
      attempts: result.attempts,
      usage: result.usage,
    },
  };
}

export function buildDecisionView(
  decision: Record<string, unknown>,
  revisions: Record<string, unknown>[],
): Record<string, unknown> {
  const latestRevision = revisions[revisions.length - 1];
  return {
    id: decision.id,
    rawInput: decision.raw_input,
    status: decision.status,
    createdAt: decision.created_at,
    confirmedAt: decision.confirmed_at,
    structuredView: latestRevision?.snapshot ?? decision.structured_inference,
    confirmedSnapshot: decision.confirmed_snapshot,
    currentRevision: latestRevision
      ? { id: latestRevision.id, version: latestRevision.version, createdAt: latestRevision.created_at }
      : null,
  };
}

export function marketRequestForDecision(
  decision: Record<string, unknown>,
  bounds: { startTime?: number; endTime?: number },
): { assetClass: "stock"; symbol: string; startTime?: number; endTime?: number } | { assetClass: "crypto" } {
  const assetClass = decision.asset_class;
  if (assetClass === "crypto") return { assetClass: "crypto" };
  if (assetClass !== "stock" && assetClass !== "rtoken") throw new RepositoryError("decision asset class is not supported", "INVALID_INPUT");
  if (typeof decision.asset_symbol !== "string" || decision.asset_symbol.trim().length === 0) {
    throw new RepositoryError("decision symbol is missing", "INVALID_INPUT");
  }
  return {
    assetClass: "stock",
    symbol: decision.asset_symbol.trim().toUpperCase(),
    ...(bounds.startTime === undefined ? {} : { startTime: bounds.startTime }),
    ...(bounds.endTime === undefined ? {} : { endTime: bounds.endTime }),
  };
}
