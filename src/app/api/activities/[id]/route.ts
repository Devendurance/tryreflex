import { createSpotActivityHandler } from "@/server/imports/bitget-classic/http";

const handler = createSpotActivityHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
