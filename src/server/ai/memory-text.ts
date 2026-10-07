import { z } from "zod";

export const MEMORY_TEXT_VERSION = "memory-text.v1";

const nonemptyLine = z.string().trim().min(1);
const originLabel = z.enum([
  "original_research",
  "borrowed_conviction",
  "social_confirmation",
  "pure_impulse",
]);

const memoryInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("decision"),
    assetSymbol: nonemptyLine.optional(),
    assetClass: z.enum(["crypto", "rtoken", "stock", "other"]).optional(),
    origins: z.array(originLabel).optional(),
    thesis: nonemptyLine.optional(),
    marketContext: nonemptyLine.optional(),
    invalidation: nonemptyLine.optional(),
  }),
  z.strictObject({
    kind: z.literal("review"),
    assetSymbol: nonemptyLine.optional(),
    findings: z.array(nonemptyLine).min(1),
    processClassification: z
      .enum(["earned_win", "good_decision_bad_outcome", "lucky_escape", "deserved_loss"])
      .optional(),
    marketContext: nonemptyLine.optional(),
  }),
  z.strictObject({
    kind: z.literal("pattern"),
    patternKind: nonemptyLine,
    description: nonemptyLine,
    status: nonemptyLine,
    evidenceCount: z.number().int().min(0),
  }),
  z.strictObject({
    kind: z.literal("rule"),
    title: nonemptyLine,
    trigger: nonemptyLine,
    ruleText: nonemptyLine,
    status: nonemptyLine,
    version: z.number().int().positive(),
  }),
]);

export type MemoryInput = z.infer<typeof memoryInputSchema>;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildMemoryText(input: unknown): { text: string; version: string } {
  const parsed = memoryInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid memory input");
  const value = parsed.data;
  const lines: string[] = [];

  if (value.kind === "decision") {
    if (
      !value.assetSymbol &&
      !value.assetClass &&
      (!value.origins || value.origins.length === 0) &&
      !value.thesis &&
      !value.marketContext &&
      !value.invalidation
    ) {
      throw new Error("memory input has no meaningful content");
    }
    lines.push("kind: decision");
    if (value.assetSymbol) lines.push(`asset_symbol: ${normalize(value.assetSymbol)}`);
    if (value.assetClass) lines.push(`asset_class: ${value.assetClass}`);
    if (value.origins && value.origins.length > 0) {
      lines.push(`origins: ${[...new Set(value.origins)].sort().join("|")}`);
    }
    if (value.thesis) lines.push(`thesis: ${normalize(value.thesis)}`);
    if (value.marketContext) lines.push(`market_context: ${normalize(value.marketContext)}`);
    if (value.invalidation) lines.push(`invalidation: ${normalize(value.invalidation)}`);
  } else if (value.kind === "review") {
    lines.push("kind: review");
    if (value.assetSymbol) lines.push(`asset_symbol: ${normalize(value.assetSymbol)}`);
    if (value.processClassification) {
      lines.push(`process_classification: ${value.processClassification}`);
    }
    if (value.marketContext) lines.push(`market_context: ${normalize(value.marketContext)}`);
    for (const finding of value.findings) lines.push(`finding: ${normalize(finding)}`);
  } else if (value.kind === "pattern") {
    lines.push("kind: pattern");
    lines.push(`pattern_kind: ${normalize(value.patternKind)}`);
    lines.push(`status: ${normalize(value.status)}`);
    lines.push(`evidence_count: ${value.evidenceCount}`);
    lines.push(`description: ${normalize(value.description)}`);
  } else {
    lines.push("kind: rule");
    lines.push(`version: ${value.version}`);
    lines.push(`status: ${normalize(value.status)}`);
    lines.push(`title: ${normalize(value.title)}`);
    lines.push(`trigger: ${normalize(value.trigger)}`);
    lines.push(`rule_text: ${normalize(value.ruleText)}`);
  }

  return { text: lines.join("\n"), version: MEMORY_TEXT_VERSION };
}
