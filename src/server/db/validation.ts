import { createHash } from "node:crypto";
import { z } from "zod";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./config";
import { decimalUnits } from "../review-policy";

const MAX_JSON_DEPTH = 20;

function isJsonValue(value: unknown, seen: Set<unknown>, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (t !== "object" || value === undefined) return false;
  if (seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    seen.add(value);
    const ok = value.every((item) => isJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return ok;
  }
  if (proto !== Object.prototype && proto !== null) return false;
  seen.add(value);
  const ok = Object.values(value as Record<string, unknown>).every((item) =>
    isJsonValue(item, seen, depth + 1),
  );
  seen.delete(value);
  return ok;
}

export const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => isJsonValue(value, new Set(), 0), {
    message: "must be a plain JSON-serializable object",
  });

export const jsonValueSchema = z.unknown().refine((value) => isJsonValue(value, new Set(), 0), {
  message: "must be a JSON-serializable value",
});

const uuidSchema = z.string().uuid();

export const httpUrlSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL without embedded credentials" },
);

const finiteNumber = z.number().finite();

export const draftDecisionSchema = z.strictObject({
  rawInput: z.string().refine((v) => v.trim().length > 0, { message: "raw input must not be empty" }),
  structuredInference: jsonObjectSchema.optional(),
  assetSymbol: z.string().min(1).optional(),
  assetClass: z.enum(["crypto", "rtoken", "stock", "other"]).optional(),
  side: z.enum(["long", "short", "watch"]).optional(),
});

export const decisionSnapshotSourceSchema = z.strictObject({
  sourceType: z.enum(["news", "x", "telegram", "discord", "analyst", "friend", "research", "other"]),
  label: z.string(),
  url: httpUrlSchema.optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().optional(),
});

export const decisionSnapshotSchema = z.strictObject({
  assetSymbol: z.string().min(1),
  assetClass: z.enum(["crypto", "rtoken", "stock", "other"]),
  side: z.enum(["long", "short", "watch"]),
  thesis: z.string().optional(),
  catalyst: z.string().optional(),
  confidence: finiteNumber.min(0).max(1).optional(),
  intendedEntry: finiteNumber.positive().optional(),
  intendedTakeProfitMarketCap: z
    .string()
    .regex(/^\d{1,18}(\.\d{1,12})?$/)
    .refine((v) => /^\d{1,18}(\.\d{1,12})?$/.test(v) && decimalUnits(v) > BigInt(0))
    .optional(),
  marketCapCurrency: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,11}$/)
    .optional(),
  knowledgeBasis: z.enum(["contemporaneous_record", "retrospective_recollection", "unknown"]).optional(),
  invalidation: z.string().optional(),
  intendedRiskPct: finiteNumber.min(0).max(100).optional(),
  timeframe: z.string().optional(),
  origins: z
    .array(z.enum(["original_research", "borrowed_conviction", "social_confirmation", "pure_impulse"]))
    .min(1),
  sources: z.array(decisionSnapshotSourceSchema),
});

export const appendRevisionSchema = z.strictObject({
  snapshot: decisionSnapshotSchema,
  reason: z.string().min(1),
});

export const appendOriginSchema = z.strictObject({
  decisionId: uuidSchema,
  label: z.enum(["original_research", "borrowed_conviction", "social_confirmation", "pure_impulse"]),
  explanation: z.string(),
  confidence: finiteNumber.min(0).max(1).optional(),
  basis: z.enum(["inference", "user_confirmed"]),
});

export const appendSourceSchema = z.strictObject({
  decisionId: uuidSchema,
  sourceType: z.enum(["news", "x", "telegram", "discord", "analyst", "friend", "research", "other"]),
  label: z.string(),
  url: httpUrlSchema.optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().optional(),
});

export const appendMarketSnapshotSchema = z.strictObject({
  decisionId: uuidSchema,
  capturedAt: z.iso.datetime({ offset: true }),
  provider: z.string().min(1),
  observedFacts: jsonObjectSchema,
  aiInference: jsonObjectSchema.optional(),
  provenance: jsonObjectSchema,
  nativeMarketState: z.enum(["open", "closed", "unknown"]).optional(),
  regime: z.string().optional(),
});

const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,12})?$/;

function decimalMagnitude(value: string): bigint {
  return BigInt(value.replace("-", "").replace(".", ""));
}

const decimalString = z.string().regex(DECIMAL_PATTERN, "must be a decimal string within numeric(30,12)");
const positiveDecimal = decimalString.refine(
  (v) => !DECIMAL_PATTERN.test(v) || (!v.startsWith("-") && decimalMagnitude(v) > BigInt(0)),
  { message: "must be a positive decimal string" },
);
const nonnegativeDecimal = decimalString.refine(
  (v) => !DECIMAL_PATTERN.test(v) || !v.startsWith("-"),
  { message: "must be a nonnegative decimal string" },
);

export const recordTradeSchema = z
  .strictObject({
    decisionId: uuidSchema.optional(),
    provider: z.enum(["bitget", "manual"]),
    externalId: z.string().min(1).optional(),
    symbol: z.string().min(1),
    side: z.enum(["long", "short"]),
    quantity: positiveDecimal,
    entryPrice: positiveDecimal,
    exitPrice: positiveDecimal.optional(),
    fees: nonnegativeDecimal.optional(),
    realizedPnl: decimalString.optional(),
    openedAt: z.iso.datetime({ offset: true }),
    closedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.closedAt === undefined || Date.parse(v.closedAt) >= Date.parse(v.openedAt), {
    message: "closed_at must not precede opened_at",
  });

export const appendTradeEventSchema = z.strictObject({
  tradeId: uuidSchema,
  eventType: z.enum(["entry", "exit", "add", "reduce", "fee", "other"]),
  occurredAt: z.iso.datetime({ offset: true }),
  facts: jsonObjectSchema,
});

export const appendReviewSchema = z.strictObject({
  decisionId: uuidSchema,
  tradeId: uuidSchema,
  version: z.number().int().positive(),
  isCurrent: z.boolean().optional(),
  processClassification: z
    .enum(["earned_win", "good_decision_bad_outcome", "lucky_escape", "deserved_loss"])
    .optional(),
  observedMetrics: jsonObjectSchema,
  aiInference: jsonObjectSchema.optional(),
});

export const appendReviewDimensionSchema = z.strictObject({
  reviewId: uuidSchema,
  dimension: z.enum([
    "research_quality",
    "context_awareness",
    "risk_discipline",
    "execution_quality",
    "behavioral_control",
  ]),
  score: finiteNumber.min(0).max(100).optional(),
  explanation: z.string().optional(),
  confidence: finiteNumber.min(0).max(1).optional(),
});

export const recordPatternSchema = z.strictObject({
  kind: z.enum(["edge", "leak", "influence", "regime", "timing", "execution"]),
  status: z.enum(["observation", "emerging", "established"]),
  description: z.string(),
  observedStatistics: jsonObjectSchema,
  aiInference: jsonObjectSchema.optional(),
  evidenceCount: z.number().int().min(0),
  confidence: finiteNumber.min(0).max(1).optional(),
});

export const ruleContentSchema = z.strictObject({
  previousRuleId: uuidSchema.optional(),
  sourcePatternId: uuidSchema.optional(),
  title: z.string().min(1),
  trigger: z.string().min(1),
  ruleText: z.string().min(1),
  rationale: z.string(),
});

export const ruleDecisionSchema = ruleContentSchema.extend({
  userDecision: z.enum(["accepted", "rejected", "deferred"]),
});

export const recordEvidenceSchema = z.strictObject({
  kind: z.enum([
    "user_input",
    "market_data",
    "trade_data",
    "source",
    "prior_decision",
    "prior_review",
    "playbook_rule",
  ]),
  decisionId: uuidSchema.optional(),
  contextSnapshotId: uuidSchema.optional(),
  tradeId: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
  reviewId: uuidSchema.optional(),
  ruleId: uuidSchema.optional(),
  label: z.string().optional(),
  observedAt: z.iso.datetime({ offset: true }).optional(),
});

export const storeEmbeddingSchema = z.strictObject({
  entityType: z.enum(["decision", "review", "pattern", "rule"]),
  entityId: uuidSchema,
  decisionId: uuidSchema.optional(),
  reviewId: uuidSchema.optional(),
  patternId: uuidSchema.optional(),
  ruleId: uuidSchema.optional(),
  embedding: z.array(finiteNumber),
  model: z.literal(EMBEDDING_MODEL),
  dimensions: z.literal(EMBEDDING_DIMENSIONS),
  sourceText: z.string().min(1),
  metadata: jsonObjectSchema.optional(),
});

export const recordProviderConnectionSchema = z.strictObject({
  provider: z.enum(["bitget", "groq", "jina", "agentkey"]),
  externalSubject: z.string().optional(),
  status: z.enum(["configured", "connected", "unavailable", "revoked"]),
  config: jsonObjectSchema.optional(),
});

export const recordAiRunSchema = z.strictObject({
  pipeline: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  inputEntityIds: z.array(uuidSchema).optional(),
  status: z.enum(["pending", "success", "failed"]),
  latencyMs: z.number().int().min(0).optional(),
  tokenUsage: jsonObjectSchema.optional(),
  validationErrors: jsonValueSchema.optional(),
});

export const linkPatternEvidenceSchema = z.strictObject({
  patternId: uuidSchema,
  evidenceId: uuidSchema,
});
export const linkRuleEvidenceSchema = z.strictObject({
  ruleId: uuidSchema,
  evidenceId: uuidSchema,
});
export const linkDimensionEvidenceSchema = z.strictObject({
  dimensionId: uuidSchema,
  evidenceId: uuidSchema,
});

const SECRET_KEY_PATTERN = /key|secret|token|password|passphrase|credential/i;

export function assertNonSecretConfig(config: Record<string, unknown>): void {
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) {
      throw new Error("provider connection config exceeds maximum nesting depth");
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (value !== null && typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(key)) {
          throw new Error("provider connection config must not contain secret material");
        }
        visit(nested, depth + 1);
      }
    }
  };
  visit(config, 0);
}

export function computeSourceHash(sourceText: string): string {
  return createHash("sha256").update(sourceText, "utf8").digest("hex");
}

export function validateEmbedding(values: number[]): { valid: true } | { valid: false; reason: string } {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    return { valid: false, reason: `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}` };
  }
  let norm = 0;
  for (const value of values) {
    const f32 = Math.fround(value);
    if (!Number.isFinite(f32)) {
      return { valid: false, reason: "embedding contains values that do not fit finite float32" };
    }
    norm += f32 * f32;
    if (!Number.isFinite(norm)) {
      return { valid: false, reason: "embedding norm overflows" };
    }
  }
  if (norm === 0) {
    return { valid: false, reason: "embedding has zero cosine norm" };
  }
  return { valid: true };
}
