import { z } from "zod";
import {
  DECISION_ORIGIN_PROMPT_VERSION,
  DECISION_ORIGIN_SYSTEM_PROMPT,
} from "../decision-origin-prompt";
import { AIError } from "./errors";
import type { GenerationResult, LLMProvider } from "./types";

const decisionOriginSchema = z.strictObject({
  labels: z.array(
    z.enum(["original_research", "borrowed_conviction", "social_confirmation", "pure_impulse"]),
  ),
  explanation: z.string().min(1).max(1000),
  confidence: z.number().finite().min(0).max(1),
  observedInputFacts: z.array(z.string().min(1).max(1000)),
});

export type DecisionOrigin = z.infer<typeof decisionOriginSchema>;

export async function analyzeDecisionOrigin(
  provider: LLMProvider,
  rawInput: string,
): Promise<GenerationResult<DecisionOrigin>> {
  if (typeof rawInput !== "string" || rawInput.trim().length === 0 || rawInput.length > 32768) {
    throw new AIError("SCHEMA");
  }
  return provider.generateStructured<DecisionOrigin>({
    system: DECISION_ORIGIN_SYSTEM_PROMPT,
    input: rawInput,
    pipeline: "decision-origin",
    promptVersion: DECISION_ORIGIN_PROMPT_VERSION,
    schema: decisionOriginSchema,
    schemaName: "decision_origin",
    validate: (value) => {
      const labels = value.labels;
      if (new Set(labels).size !== labels.length) throw new AIError("GROUNDING");
      if (labels.length === 0 && value.confidence !== 0) throw new AIError("GROUNDING");
      if (labels.length > 0 && value.observedInputFacts.length === 0) {
        throw new AIError("GROUNDING");
      }
      for (const quote of value.observedInputFacts) {
        if (!rawInput.includes(quote)) throw new AIError("GROUNDING");
      }
    },
  });
}
