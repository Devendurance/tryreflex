import { AuthNotConfiguredError } from "@/server/auth/context";
import { getNeonAuth } from "@/server/auth/neon";

function unavailable(error: unknown): Response {
  const status = error instanceof AuthNotConfiguredError ? 503 : 503;
  const code = error instanceof AuthNotConfiguredError ? "AUTH_NOT_CONFIGURED" : "AUTH_UNAVAILABLE";
  const message = error instanceof AuthNotConfiguredError ? "authentication provider is not configured" : "authentication provider is unavailable";
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

type AuthRouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: AuthRouteContext): Promise<Response> {
  try {
    return await getNeonAuth().handler().GET(request, context);
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request, context: AuthRouteContext): Promise<Response> {
  try {
    return await getNeonAuth().handler().POST(request, context);
  } catch (error) {
    return unavailable(error);
  }
}
