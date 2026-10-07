import { createGetHandler } from "@/server/decisions/http";

const handler = createGetHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
