import { z } from "zod";
import {
  normalizedHistorySchema,
  normalizedQuoteSchema,
  normalizedSentimentSchema,
} from "./normalize";

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,14}$/;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const symbolSchema = z.string().trim().toUpperCase().regex(SYMBOL_RE);

const unixMsSchema = z.number().refine((v) => Number.isSafeInteger(v) && v >= 0, {
  message: "must be a nonnegative safe integer",
});

export const stockRequestSchema = z
  .strictObject({
    assetClass: z.literal("stock"),
    symbol: symbolSchema,
    startTime: unixMsSchema.optional(),
    endTime: unixMsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const now = Date.now();
    if (v.startTime !== undefined && v.startTime > now) {
      ctx.addIssue({ code: "custom", message: "startTime must not be in the future" });
    }
    if (v.endTime !== undefined && v.endTime > now) {
      ctx.addIssue({ code: "custom", message: "endTime must not be in the future" });
    }
    if (v.startTime !== undefined && v.endTime !== undefined) {
      if (v.startTime > v.endTime) {
        ctx.addIssue({ code: "custom", message: "startTime must be <= endTime" });
      }
      if (v.endTime - v.startTime > MAX_RANGE_MS) {
        ctx.addIssue({ code: "custom", message: "time range must not exceed 366 days" });
      }
    }
  });

export const cryptoRequestSchema = z.strictObject({
  assetClass: z.literal("crypto"),
});

export const marketRequestSchema = z.discriminatedUnion("assetClass", [stockRequestSchema, cryptoRequestSchema]);

export type MarketRequest = z.infer<typeof marketRequestSchema>;

const provenanceSchema = z.strictObject({
  evidenceId: z.uuid(),
  provider: z.enum(["bitget-stock-mcp", "bitget-signal"]),
  tool: z.string().min(1),
  sourceUrl: z.string().min(1),
  fetchedAt: z.iso.datetime(),
});

const failureCodeSchema = z.enum(["UPSTREAM_UNAVAILABLE", "INVALID_PROVIDER_RESPONSE", "TIMEOUT"]);

const statusSchema = z.enum(["available", "partial", "unavailable"]);

function componentSchema<D extends z.ZodType>(data: D) {
  return z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("available"), data, provenance: provenanceSchema }),
    z.strictObject({ status: z.literal("unavailable"), code: failureCodeSchema, message: z.string().min(1) }),
  ]);
}

const stockContextSchema = z.strictObject({
  assetClass: z.literal("stock"),
  symbol: z.string().min(1),
  capturedAt: z.iso.datetime(),
  status: statusSchema,
  components: z.strictObject({
    quote: componentSchema(normalizedQuoteSchema),
    history: componentSchema(normalizedHistorySchema),
  }),
});

const cryptoContextSchema = z.strictObject({
  assetClass: z.literal("crypto"),
  capturedAt: z.iso.datetime(),
  status: statusSchema,
  components: z.strictObject({
    sentiment: componentSchema(normalizedSentimentSchema),
  }),
});

export const marketContextResponseSchema = z
  .discriminatedUnion("assetClass", [stockContextSchema, cryptoContextSchema])
  .superRefine((value, ctx) => {
    const statuses = Object.values(value.components).map((c) => c.status);
    const okCount = statuses.filter((s) => s === "available").length;
    const expected = okCount === 0 ? "unavailable" : okCount === statuses.length ? "available" : "partial";
    if (value.status !== expected) {
      ctx.addIssue({ code: "custom", message: "status inconsistent with component statuses" });
    }
  });
