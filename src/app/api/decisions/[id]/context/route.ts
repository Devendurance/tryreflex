import { createContextHandler } from "@/server/decisions/http";

const handler = createContextHandler();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
