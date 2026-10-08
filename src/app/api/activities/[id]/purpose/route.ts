import { createSpotActivityPurposeHandler } from "@/server/imports/bitget-classic/http";

const handler = createSpotActivityPurposeHandler();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
