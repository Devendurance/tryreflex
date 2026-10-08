import type { z } from "zod";

export interface AiRunRecorder {
  record(input: unknown): Promise<Record<string, unknown>>;
}

export interface GenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GenerationRequest {
  system: string;
  input: string;
  pipeline: string;
  promptVersion: string;
  inputEntityIds?: readonly string[];
  singleAttempt?: true;
}

export interface StructuredGenerationRequest<T> extends GenerationRequest {
  schema: z.ZodType<T>;
  schemaName: string;
  allowedEvidenceIds?: readonly string[];
  validate?: (value: T) => void;
}

export interface GenerationResult<T> {
  value: T;
  provider: string;
  model: string;
  promptVersion: string;
  runId: string;
  attempts: number;
  usage?: GenerationUsage;
}

export interface LLMProvider {
  generateText(request: GenerationRequest): Promise<GenerationResult<string>>;
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<GenerationResult<T>>;
}

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dimensions: number;
  sourceText: string;
  sourceHash: string;
  metadata: Record<string, unknown>;
}

export interface EmbeddingProvider {
  embedDocument(text: string): Promise<EmbeddingResult>;
  embedQuery(text: string): Promise<EmbeddingResult>;
  embedMany(texts: readonly string[], mode: "document" | "query"): Promise<EmbeddingResult[]>;
}
