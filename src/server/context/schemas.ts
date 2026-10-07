import { z } from "zod";

const urlWithoutCredentials = z
  .string()
  .url()
  .refine((value) => {
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
  });

export const secondaryContextQuerySchema = z.strictObject({
  assetSymbol: z.string().min(1).max(64),
  contractAddress: z.string().min(1).max(200).optional(),
  chain: z.string().min(1).max(100).optional(),
});

export const secondaryContextItemSchema = z.strictObject({
  kind: z.literal("external_context"),
  text: z
    .string()
    .min(1)
    .max(12000)
    .refine((value) => value.trim().length > 0),
  underlyingSource: z.string().min(1).max(200),
  originalId: z.string().min(1).max(200).nullable(),
  url: urlWithoutCredentials.nullable(),
  retrievedAt: z.iso.datetime({ offset: true }),
  query: secondaryContextQuerySchema,
  provider: z.literal("agentkey"),
  role: z.enum(["fallback", "enrichment"]),
});

export const secondaryContextResultSchema = z
  .strictObject({
    provider: z.literal("agentkey"),
    status: z.enum(["available", "unavailable", "not_configured"]),
    items: z.array(secondaryContextItemSchema),
    error: z
      .strictObject({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(500),
      })
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "available") {
      if (value.items.length === 0 || value.error !== null) {
        ctx.addIssue({ code: "custom", message: "available requires items and no error" });
      }
    } else if (value.items.length !== 0 || value.error === null) {
      ctx.addIssue({ code: "custom", message: "unavailable requires an error and no items" });
    }
  });

export type SecondaryContextQuery = z.infer<typeof secondaryContextQuerySchema>;
export type SecondaryContextItem = z.infer<typeof secondaryContextItemSchema>;
export type SecondaryContextResult = z.infer<typeof secondaryContextResultSchema>;
