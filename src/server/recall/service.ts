import type { AuthContext } from "../auth/context";
import type { DbSession } from "../db/client";
import { createRepositories } from "../db/repositories";
import { AIError } from "../ai/errors";
import { GroqLLMProvider } from "../ai/groq";
import type { EmbeddingProvider, LLMProvider } from "../ai/types";
import {
  buildRecall,
  RECALL_POLICY_VERSION,
  RECALL_SELECTION_PROMPT,
  selectionSchema,
  validateSelection,
  type RecallInput,
  type RecallItem,
  type RecallSelection,
} from "../recall-policy";
import { createRecallRepository } from "./repository";

export interface RecallServiceDeps {
  db: DbSession;
  auth: AuthContext;
  embedder: EmbeddingProvider;
  llm?: LLMProvider;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reorderSelected(items: RecallItem[], selectedIds: readonly string[]): RecallItem[] {
  const selected = new Set(selectedIds);
  const first = selectedIds.flatMap((id) => items.filter((item) => item.id === id));
  return [...first, ...items.filter((item) => !selected.has(item.id))];
}

export async function recallProposal(deps: RecallServiceDeps, input: RecallInput): Promise<Record<string, unknown>> {
  const repo = createRecallRepository(deps.db, deps.auth);
  const data = await repo.recall(input, deps.embedder);
  const base = buildRecall(input, data);
  const basis = "server_authored_facts_and_questions";
  if (base.watchpoints.length === 0 || base.questions.length === 0) {
    return {
      ...base,
      explanation: {
        mode: "deterministic_empty_or_no_relevant_history",
        basis,
        reason: "no eligible retrieved memory for this proposal",
        newHistoricalClaimsGenerated: false,
      },
    };
  }
  const select = selectionSchema(base.watchpoints, base.questions);
  try {
    const llm =
      deps.llm ??
      new GroqLLMProvider({
        maxCompletionTokens: 1024,
        timeoutMs: 10000,
        recorder: createRepositories(deps.db, deps.auth).aiRuns,
      });
    const result = await llm.generateStructured<RecallSelection>({
      system: RECALL_SELECTION_PROMPT,
      input: JSON.stringify({
        proposedTrade: base.proposedTrade,
        watchpoints: base.watchpoints,
        questions: base.questions,
        historySummary: base.summary,
      }),
      pipeline: "pre-trade-recall",
      promptVersion: RECALL_POLICY_VERSION,
      inputEntityIds: [...new Set(data.sources.map((source) => source.entityId))].filter((id) => UUID.test(id)).slice(0, 20),
      schema: select,
      schemaName: "recall_selection",
      allowedEvidenceIds: [],
      validate: validateSelection,
      singleAttempt: true,
    });
    const selection = select.parse(result.value);
    validateSelection(selection);
    return {
      ...base,
      watchpoints: reorderSelected(base.watchpoints, selection.watchpointIds),
      questions: reorderSelected(base.questions, selection.questionIds),
      explanation: {
        mode: "model_selected",
        basis,
        selection,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        runId: result.runId,
        attempts: result.attempts,
        newHistoricalClaimsGenerated: false,
      },
    };
  } catch (error) {
    return {
      ...base,
      explanation: {
        mode: "deterministic_fallback",
        basis,
        failureCategory: error instanceof AIError ? error.code : "SCHEMA_OR_SELECTION_FAILURE",
        newHistoricalClaimsGenerated: false,
      },
    };
  }
}
