import { createGetReviewHandler } from "@/server/reviews/http";

const handler = createGetReviewHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
