import { z } from "zod";
import { RepositoryError, type createRepositories } from "../db/repositories";
import {
  assertNonSecretConfig,
  computeSourceHash,
  jsonValueSchema,
} from "../db/validation";
import { AIError } from "./errors";
import type { EmbeddingProvider } from "./types";

type Repositories = ReturnType<typeof createRepositories>;

const MAX_CHARS = 32768;

const storeDocumentSchema = z.strictObject({
  entityType: z.enum(["decision", "review", "pattern", "rule"]),
  entityId: z.string().uuid(),
  sourceText: z.string().max(MAX_CHARS).refine((value) => value.trim().length > 0),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

const ENTITY_GETTERS = {
  decision: (repos: Repositories) => repos.decisions,
  review: (repos: Repositories) => repos.reviews,
  pattern: (repos: Repositories) => repos.patterns,
  rule: (repos: Repositories) => repos.playbookRules,
} as const;

function toPersistence(error: unknown): never {
  if (error instanceof AIError || error instanceof RepositoryError) throw error;
  throw new AIError("PERSISTENCE");
}

export function createMemoryStore(repos: Repositories, embedder: EmbeddingProvider) {
  async function storeDocument(input: unknown): Promise<Record<string, unknown>> {
    const parsed = storeDocumentSchema.safeParse(input);
    if (!parsed.success) throw new AIError("SCHEMA");
    const { entityType, entityId, sourceText, metadata } = parsed.data;
    if (metadata !== undefined) {
      try {
        assertNonSecretConfig(metadata);
      } catch {
        throw new AIError("SCHEMA");
      }
    }

    const getter = ENTITY_GETTERS[entityType](repos);
    let entity: Record<string, unknown> | null;
    try {
      entity = await getter.get(entityId);
    } catch (error) {
      toPersistence(error);
    }
    if (!entity) throw new RepositoryError("referenced entity not found", "NOT_FOUND");

    let existing: Record<string, unknown> | null;
    try {
      existing = await repos.memoryEmbeddings.findBySource({ entityType, entityId, sourceText });
    } catch (error) {
      toPersistence(error);
    }
    if (existing) return existing;

    const embedded = await embedder.embedDocument(sourceText);
    if (embedded.sourceText !== sourceText) throw new AIError("PROVIDER");
    if (embedded.sourceHash !== computeSourceHash(sourceText)) throw new AIError("PROVIDER");
    const merged = { ...(metadata ?? {}), ...embedded.metadata };
    try {
      return await repos.memoryEmbeddings.storeValidatedEmbedding({
        entityType,
        entityId,
        embedding: embedded.vector,
        model: embedded.model,
        dimensions: embedded.dimensions,
        sourceText: embedded.sourceText,
        metadata: merged,
      });
    } catch (error) {
      toPersistence(error);
    }
  }

  async function search(query: string, limit?: number): Promise<Record<string, unknown>[]> {
    if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_CHARS) {
      throw new AIError("SCHEMA");
    }
    const embedded = await embedder.embedQuery(query);
    try {
      return await repos.memoryEmbeddings.searchByVector({
        embedding: embedded.vector,
        model: embedded.model,
        dimensions: embedded.dimensions,
        limit,
      });
    } catch (error) {
      toPersistence(error);
    }
  }

  return { storeDocument, search };
}
