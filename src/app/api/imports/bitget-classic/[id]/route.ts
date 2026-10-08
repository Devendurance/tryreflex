import { createClassicCSVImportHandler } from "@/server/imports/bitget-classic/http";

const handler = createClassicCSVImportHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
