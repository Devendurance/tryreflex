import { AIError } from "./errors";

export interface BoundedPostOptions {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  payload: unknown;
  deadline: number;
  maxBytes: number;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(cleanup);
  });
}

async function readBoundedBody(
  response: Response,
  controller: AbortController,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await raceAbort(response.text(), controller.signal);
    if (new TextEncoder().encode(text).length > maxBytes) {
      controller.abort();
      throw new AIError("PROVIDER");
    }
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), controller.signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        reader.cancel().catch(() => {});
        throw new AIError("PROVIDER");
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {}
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function boundedPost(options: BoundedPostOptions): Promise<string> {
  const remaining = options.deadline - Date.now();
  if (remaining <= 0) throw new AIError("TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await raceAbort(
      options.fetchImpl(options.url, {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(options.payload),
        signal: controller.signal,
      }),
      controller.signal,
    );
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new AIError("PROVIDER", response.status);
    }
    return await readBoundedBody(response, controller, options.maxBytes);
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AIError("TIMEOUT");
    throw new AIError("TRANSPORT");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
