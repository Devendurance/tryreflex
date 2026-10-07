import { z } from "zod";
import { getEmbeddingConfig } from "../db/config";
import { computeSourceHash, validateEmbedding } from "../db/validation";
import { AIError } from "./errors";
import { boundedPost } from "./http";
import type { EmbeddingProvider, EmbeddingResult } from "./types";

const JINA_ENDPOINT = "https://api.jina.ai/v1/embeddings";
const PROVIDER_NAME = "jina";
const DEFAULT_TIMEOUT_MS = 45000;
const MAX_TIMEOUT_MS = 90000;
const MAX_CHARS = 32768;
const MAX_BATCH = 64;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const jinaEnvelopeSchema = z.looseObject({
  model: z.string(),
  data: z.array(
    z.looseObject({
      index: z.number().int(),
      embedding: z.array(z.number()),
    }),
  ),
  usage: z
    .looseObject({
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface JinaEmbeddingProviderOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class JinaEmbeddingProvider implements EmbeddingProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(options: JinaEmbeddingProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > MAX_TIMEOUT_MS) {
      throw new AIError("CONFIGURATION");
    }
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey || !apiKey.trim()) throw new AIError("CONFIGURATION");
    let config: { model: string; dimensions: number };
    try {
      config = getEmbeddingConfig();
    } catch {
      throw new AIError("CONFIGURATION");
    }
    this.apiKey = apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions;
  }

  embedDocument(text: string): Promise<EmbeddingResult> {
    return this.embedMany([text], "document").then((results) => results[0]);
  }

  embedQuery(text: string): Promise<EmbeddingResult> {
    return this.embedMany([text], "query").then((results) => results[0]);
  }

  async embedMany(texts: readonly string[], mode: "document" | "query"): Promise<EmbeddingResult[]> {
    if (mode !== "document" && mode !== "query") throw new AIError("SCHEMA");
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_BATCH) {
      throw new AIError("SCHEMA");
    }
    for (const text of texts) {
      if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_CHARS) {
        throw new AIError("SCHEMA");
      }
    }
    const task = mode === "query" ? "retrieval.query" : "retrieval.passage";
    const payload = {
      model: this.model,
      input: [...texts],
      task,
      dimensions: this.dimensions,
      embedding_type: "float",
      normalized: true,
      truncate: false,
    };
    const text = await boundedPost({
      fetchImpl: this.fetchImpl,
      url: JINA_ENDPOINT,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      payload,
      deadline: Date.now() + this.timeoutMs,
      maxBytes: MAX_BODY_BYTES,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AIError("SCHEMA");
    }
    const parsed = jinaEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new AIError("SCHEMA");
    const envelope = parsed.data;

    if (envelope.model !== this.model) throw new AIError("PROVIDER");
    if (envelope.data.length !== texts.length) throw new AIError("SCHEMA");
    const seen = new Set<number>();
    for (const item of envelope.data) {
      if (item.index < 0 || item.index >= texts.length || seen.has(item.index)) {
        throw new AIError("SCHEMA");
      }
      seen.add(item.index);
    }
    const sorted = [...envelope.data].sort((a, b) => a.index - b.index);
    const results: EmbeddingResult[] = [];
    for (const item of sorted) {
      const sourceText = texts[item.index];
      if (item.embedding.length !== this.dimensions) throw new AIError("SCHEMA");
      const check = validateEmbedding(item.embedding);
      if (!check.valid) throw new AIError("SCHEMA");
      const metadata: Record<string, unknown> = {
        provider: PROVIDER_NAME,
        task,
        retrievedAt: new Date().toISOString(),
      };
      if (envelope.usage?.total_tokens !== undefined) {
        metadata.usage = { totalTokens: envelope.usage.total_tokens };
      }
      results.push({
        vector: item.embedding,
        model: this.model,
        dimensions: this.dimensions,
        sourceText,
        sourceHash: computeSourceHash(sourceText),
        metadata,
      });
    }
    return results;
  }
}
