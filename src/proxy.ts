import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth } from "@/server/auth/neon";

export async function proxy(request: NextRequest) {
  try {
    return await getNeonAuth().middleware({ loginUrl: "/sign-in" })(request);
  } catch {
    return NextResponse.redirect(new URL("/sign-in?status=unavailable", request.url));
  }
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
