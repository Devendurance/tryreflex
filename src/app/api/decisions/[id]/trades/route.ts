import { createDecisionTradesHandler } from "@/server/reviews/http";

const handler = createDecisionTradesHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
