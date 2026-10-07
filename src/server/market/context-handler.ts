import { marketContextLimiter, type Limiter } from "./concurrency";
import { marketContextResponseSchema, marketRequestSchema, type MarketRequest } from "./schemas";
import { getMarketContext, type MarketContextResult } from "./service";
import { SAFE_MESSAGES } from "../integrations/bitget/errors";

const MAX_BODY_BYTES = 4096;

const RESPONSE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

async function readBodyBytes(request: Request, limit: number): Promise<{ ok: true; text: string } | { ok: false }> {
  if (request.body === null) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export interface PostHandlerDeps {
  service?: (request: MarketRequest) => Promise<MarketContextResult>;
  limiter?: Limiter;
}

export function createPostHandler(deps: PostHandlerDeps = {}) {
  const service = deps.service ?? getMarketContext;
  const limiter = deps.limiter ?? marketContextLimiter;

  return async function POST(request: Request): Promise<Response> {
    const mediaType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return jsonResponse(415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" } });
    }

    let body: { ok: true; text: string } | { ok: false };
    try {
      body = await readBodyBytes(request, MAX_BODY_BYTES);
    } catch {
      return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "Request body could not be read" } });
    }
    if (!body.ok) {
      return jsonResponse(413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 4 KiB" } });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return jsonResponse(400, { error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    }

    const validated = marketRequestSchema.safeParse(parsed);
    if (!validated.success) {
      return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "Request failed validation" } });
    }

    const release = limiter.tryAcquire();
    if (!release) {
      return jsonResponse(429, { error: { code: "TOO_MANY_REQUESTS", message: "Server is busy, retry shortly" } });
    }

    try {
      const result = await service(validated.data);
      const checked = marketContextResponseSchema.safeParse(result);
      if (!checked.success) {
        return jsonResponse(503, {
          error: { code: "INVALID_PROVIDER_RESPONSE", message: SAFE_MESSAGES.INVALID_PROVIDER_RESPONSE },
        });
      }
      return jsonResponse(checked.data.status === "unavailable" ? 503 : 200, checked.data);
    } catch {
      return jsonResponse(503, {
        error: { code: "UPSTREAM_UNAVAILABLE", message: SAFE_MESSAGES.UPSTREAM_UNAVAILABLE },
      });
    } finally {
      release();
    }
  };
}
