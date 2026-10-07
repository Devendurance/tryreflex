import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDecisionOrigin } from "../../src/server/ai/decision-origin";
import { AIError } from "../../src/server/ai/errors";
import { assertGroundedEvidence } from "../../src/server/ai/grounding";
import type { LLMProvider, StructuredGenerationRequest } from "../../src/server/ai/types";
import {
  DECISION_ORIGIN_PROMPT_VERSION,
  DECISION_ORIGIN_SYSTEM_PROMPT,
} from "../../src/server/decision-origin-prompt";

const INPUT = "I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.";

function fakeLlm(value: unknown, captured?: { request?: StructuredGenerationRequest<unknown> }): LLMProvider {
  return {
    async generateText() {
      throw new Error("unused");
    },
    async generateStructured<T>(request: StructuredGenerationRequest<T>) {
      if (captured) captured.request = request as StructuredGenerationRequest<unknown>;
      const result = request.schema.safeParse(value);
      if (!result.success) throw new AIError("SCHEMA");
      assertGroundedEvidence(result.data, request.allowedEvidenceIds ?? []);
      request.validate?.(result.data);
      return {
        value: result.data,
        provider: "fake",
        model: "fake-model",
        promptVersion: request.promptVersion,
        runId: "run-1",
        attempts: 1,
      };
    },
  };
}

test("request uses authored prompt, version, pipeline, and schema name", async () => {
  const captured: { request?: StructuredGenerationRequest<unknown> } = {};
  await analyzeDecisionOrigin(
    fakeLlm(
      {
        labels: ["borrowed_conviction"],
        explanation: "Followed a group call.",
        confidence: 0.8,
        observedInputFacts: ["someone in my Telegram group called it"],
      },
      captured,
    ),
    INPUT,
  );
  const request = captured.request;
  assert.ok(request);
  assert.equal(request.system, DECISION_ORIGIN_SYSTEM_PROMPT);
  assert.equal(request.promptVersion, DECISION_ORIGIN_PROMPT_VERSION);
  assert.equal(request.pipeline, "decision-origin");
  assert.equal(request.schemaName, "decision_origin");
  assert.equal(request.input, INPUT);
});

test("multi-label result with exact quotes passes through", async () => {
  const result = await analyzeDecisionOrigin(
    fakeLlm({
      labels: ["borrowed_conviction", "social_confirmation"],
      explanation: "Borrowed idea, then crowd agreement.",
      confidence: 0.9,
      observedInputFacts: ["someone in my Telegram group called it", "everyone looked bullish"],
    }),
    INPUT,
  );
  assert.deepEqual(result.value.labels, ["borrowed_conviction", "social_confirmation"]);
  assert.equal(result.runId, "run-1");
  assert.equal(result.model, "fake-model");
  assert.equal(result.attempts, 1);
});

test("invented quote, duplicate labels, and bad abstention rejected", async () => {
  await assert.rejects(
    () =>
      analyzeDecisionOrigin(
        fakeLlm({
          labels: ["borrowed_conviction"],
          explanation: "ok",
          confidence: 0.5,
          observedInputFacts: ["this quote was never said"],
        }),
        INPUT,
      ),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  await assert.rejects(
    () =>
      analyzeDecisionOrigin(
        fakeLlm({
          labels: ["borrowed_conviction", "borrowed_conviction"],
          explanation: "ok",
          confidence: 0.5,
          observedInputFacts: ["Telegram"],
        }),
        INPUT,
      ),
    AIError,
  );
  await assert.rejects(
    () =>
      analyzeDecisionOrigin(
        fakeLlm({ labels: [], explanation: "abstain", confidence: 0.5, observedInputFacts: [] }),
        INPUT,
      ),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
  await assert.rejects(
    () =>
      analyzeDecisionOrigin(
        fakeLlm({
          labels: ["pure_impulse"],
          explanation: "ok",
          confidence: 0.9,
          observedInputFacts: [],
        }),
        INPUT,
      ),
    (e) => e instanceof AIError && e.code === "GROUNDING",
  );
});

test("empty labels with zero confidence abstains, empty input rejected", async () => {
  const result = await analyzeDecisionOrigin(
    fakeLlm({ labels: [], explanation: "insufficient signal", confidence: 0, observedInputFacts: [] }),
    INPUT,
  );
  assert.deepEqual(result.value.labels, []);
  await assert.rejects(() => analyzeDecisionOrigin(fakeLlm({}), "   "), (e) => e instanceof AIError && e.code === "SCHEMA");
  await assert.rejects(() => analyzeDecisionOrigin(fakeLlm({}), "x".repeat(32769)), AIError);
});
