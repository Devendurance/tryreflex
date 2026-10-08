import { createPlaybookDecisionHandler } from "@/server/playbook/http";

const handler = createPlaybookDecisionHandler();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handler(request, await context.params);
}
