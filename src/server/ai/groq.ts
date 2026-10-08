import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AIError } from "./errors";
import { assertGroundedEvidence } from "./grounding";
import { boundedPost } from "./http";
import type {
  AiRunRecorder,
  GenerationRequest,
  GenerationResult,
  GenerationUsage,
  LLMProvider,
  StructuredGenerationRequest,
} from "./types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const PROVIDER_NAME = "groq";
const DEFAULT_TIMEOUT_MS = 45000;
const MAX_TIMEOUT_MS = 90000;
const MAX_CHARS = 32768;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_COMPLETION_TOKENS = 2048;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const groqEnvelopeSchema = z.looseObject({
  model: z.string(),
  choices: z.array(
    z.looseObject({
      finish_reason: z.string().optional(),
      message: z
        .looseObject({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        })
        .optional(),
    }),
  ),
  usage: z
    .looseObject({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface GroqLLMProviderOptions {
  recorder: AiRunRecorder;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxCompletionTokens?: number;
}

function assertStrictJsonSchema(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) assertStrictJsonSchema(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object") {
    if (obj.additionalProperties !== false) throw new AIError("SCHEMA");
    const properties = obj.properties;
    const required = Array.isArray(obj.required) ? obj.required : [];
    if (properties && typeof properties === "object") {
      for (const key of Object.keys(properties as Record<string, unknown>)) {
        if (!required.includes(key)) throw new AIError("SCHEMA");
      }
    }
  }
  for (const key of ["properties", "$defs", "definitions", "patternProperties"]) {
    const child = obj[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      for (const sub of Object.values(child as Record<string, unknown>)) assertStrictJsonSchema(sub);
    }
  }
  for (const key of ["items", "additionalProperties", "contains", "propertyNames"]) {
    if (obj[key] && typeof obj[key] === "object") assertStrictJsonSchema(obj[key]);
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    if (Array.isArray(obj[key])) for (const sub of obj[key] as unknown[]) assertStrictJsonSchema(sub);
  }
}

function normalizeError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Error && error.name === "AbortError") return new AIError("TIMEOUT");
  return new AIError("TRANSPORT");
}

function isRetryable(error: AIError): boolean {
  if (error.code === "TRANSPORT" || error.code === "TIMEOUT" || error.code === "SCHEMA") return true;
  if (error.code === "PROVIDER" && error.status !== undefined && RETRYABLE_STATUSES.has(error.status)) {
    return true;
  }
  return false;
}

export class GroqLLMProvider implements LLMProvider {
  private readonly recorder: AiRunRecorder;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxCompletionTokens: number;

  constructor(options: GroqLLMProviderOptions) {
    this.recorder = options.recorder;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > MAX_TIMEOUT_MS) {
      throw new AIError("CONFIGURATION");
    }
    this.maxCompletionTokens = options.maxCompletionTokens ?? MAX_COMPLETION_TOKENS;
    if (!Number.isInteger(this.maxCompletionTokens) || this.maxCompletionTokens < 1 || this.maxCompletionTokens > 16384) {
      throw new AIError("CONFIGURATION");
    }
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL;
    if (!apiKey || !apiKey.trim() || !model || !model.trim()) throw new AIError("CONFIGURATION");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateText(request: GenerationRequest): Promise<GenerationResult<string>> {
    this.assertRequest(request);
    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.input },
      ],
      max_completion_tokens: this.maxCompletionTokens,
      stream: false,
    };
    return this.execute(request, payload, async (content) => content);
  }

  async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<GenerationResult<T>> {
    this.assertRequest(request);
    if (typeof request.schemaName !== "string" || !SCHEMA_NAME_PATTERN.test(request.schemaName)) {
      throw new AIError("SCHEMA");
    }
    let jsonSchema: unknown;
    try {
      jsonSchema = z.toJSONSchema(request.schema);
    } catch {
      throw new AIError("SCHEMA");
    }
    assertStrictJsonSchema(jsonSchema);
    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.input },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, strict: true, schema: jsonSchema },
      },
      max_completion_tokens: this.maxCompletionTokens,
      stream: false,
    };
    return this.execute(request, payload, async (content) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new AIError("SCHEMA");
      }
      const result = request.schema.safeParse(parsed);
      if (!result.success) throw new AIError("SCHEMA");
      if (!isDeepStrictEqual(parsed, result.data)) throw new AIError("SCHEMA");
      assertGroundedEvidence(result.data, request.allowedEvidenceIds ?? []);
      if (request.validate) {
        try {
          request.validate(result.data);
        } catch (error) {
          if (error instanceof AIError) throw error;
          throw new AIError("GROUNDING");
        }
      }
      return result.data;
    });
  }

  private assertRequest(request: GenerationRequest): void {
    if (
      typeof request.system !== "string" ||
      request.system.trim().length === 0 ||
      request.system.length > MAX_CHARS ||
      typeof request.input !== "string" ||
      request.input.trim().length === 0 ||
      request.input.length > MAX_CHARS ||
      typeof request.pipeline !== "string" ||
      request.pipeline.trim().length === 0 ||
      typeof request.promptVersion !== "string" ||
      request.promptVersion.trim().length === 0
    ) {
      throw new AIError("SCHEMA");
    }
    if (
      request.inputEntityIds !== undefined &&
      (!Array.isArray(request.inputEntityIds) ||
        request.inputEntityIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)))
    ) {
      throw new AIError("SCHEMA");
    }
  }

  private async execute<T>(
    request: GenerationRequest,
    payload: Record<string, unknown>,
    transform: (content: string) => Promise<T>,
  ): Promise<GenerationResult<T>> {
    const startedAt = new Date().toISOString();
    const deadline = Date.now() + this.timeoutMs;
    let lastError: AIError = new AIError("PROVIDER");
    let attempts = 0;
    let outcome: { value: T; usage?: GenerationUsage } | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        lastError = new AIError("TIMEOUT");
        break;
      }
      attempts = attempt;
      try {
        const text = await boundedPost({
          fetchImpl: this.fetchImpl,
          url: GROQ_ENDPOINT,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          payload,
          deadline,
          maxBytes: MAX_BODY_BYTES,
        });
        let envelope: unknown;
        try {
          envelope = JSON.parse(text);
        } catch {
          throw new AIError("SCHEMA");
        }
        const parsed = groqEnvelopeSchema.safeParse(envelope);
        if (!parsed.success) throw new AIError("SCHEMA");
        const body = parsed.data;
        if (body.model !== this.model) throw new AIError("PROVIDER");
        const choice = body.choices[0];
        if (!choice || !choice.message) throw new AIError("PROVIDER");
        if (choice.message.refusal) throw new AIError("PROVIDER");
        if (choice.finish_reason !== "stop") throw new AIError("PROVIDER");
        const content = choice.message.content;
        if (typeof content !== "string" || content.length === 0) throw new AIError("PROVIDER");
        const value = await transform(content);
        const usage: GenerationUsage = {};
        if (body.usage) {
          if (body.usage.prompt_tokens !== undefined) usage.inputTokens = body.usage.prompt_tokens;
          if (body.usage.completion_tokens !== undefined) usage.outputTokens = body.usage.completion_tokens;
          if (body.usage.total_tokens !== undefined) usage.totalTokens = body.usage.total_tokens;
        }
        outcome = { value, usage: body.usage ? usage : undefined };
        break;
      } catch (error) {
        const normalized = normalizeError(error);
        lastError = normalized;
        if (attempt < MAX_ATTEMPTS && isRetryable(normalized)) {
          const wait = Math.min(RETRY_DELAY_MS, Math.max(0, deadline - Date.now()));
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        break;
      }
    }

    const completedAt = new Date().toISOString();
    const runId = await this.record(
      request,
      outcome ? "success" : "failed",
      startedAt,
      completedAt,
      attempts,
      {
        usage: outcome?.usage ?? {},
        run: { provider: PROVIDER_NAME, startedAt, completedAt, attempts },
      },
      outcome ? undefined : lastError,
    );
    if (!outcome) throw lastError;
    return {
      value: outcome.value,
      provider: PROVIDER_NAME,
      model: this.model,
      promptVersion: request.promptVersion,
      runId,
      attempts,
      usage: outcome.usage,
    };
  }

  private async record(
    request: GenerationRequest,
    status: "success" | "failed",
    startedAt: string,
    completedAt: string,
    attempts: number,
    tokenUsage: Record<string, unknown>,
    error?: AIError,
  ): Promise<string> {
    try {
      const run = await this.recorder.record({
        pipeline: request.pipeline,
        model: this.model,
        promptVersion: request.promptVersion,
        inputEntityIds: request.inputEntityIds,
        status,
        latencyMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        tokenUsage,
        validationErrors: error ? [{ category: error.code, ...(error.grounding ? { grounding: error.grounding } : {}) }] : undefined,
      });
      const runId = run.id;
      if (typeof runId !== "string" || runId.length === 0) throw new Error("missing run id");
      return runId;
    } catch {
      throw new AIError("PERSISTENCE");
    }
  }
}
