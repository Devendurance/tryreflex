import { createConfirmHandler } from "@/server/decisions/http";

const handler = createConfirmHandler();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
