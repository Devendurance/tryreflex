"use client";

import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();

export type AuthAction = "sign-in" | "sign-up" | "reset" | "request-reset";

/**
 * Maps SDK failures (returned or thrown AuthApiError) to fixed, honest copy. Provider bodies are never shown raw.
 * Errors without an HTTP status are treated as network failures.
 */
export function authErrorMessage(error: unknown, action: AuthAction): string {
  const shape = (typeof error === "object" && error !== null ? error : {}) as { status?: unknown; code?: unknown };
  const status = typeof shape.status === "number" ? shape.status : 0;
  const code = (typeof shape.code === "string" ? shape.code : "").toUpperCase();
  if (status === 503) return "Account access is unavailable because authentication isn't configured on this server.";
  if (status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (code.includes("EMAIL_NOT_VERIFIED")) return "Verify your email address first. Check your inbox for the verification link.";
  if (code.includes("USER_ALREADY_EXISTS") || code.includes("ALREADY_EXIST")) return "An account with this email already exists. Sign in instead.";
  if (code.includes("PASSWORD_TOO_SHORT")) return "Use a password with at least 8 characters.";
  if (code.includes("PASSWORD_TOO_LONG")) return "That password is too long. Use 128 characters or fewer.";
  if (code.includes("INVALID_EMAIL") && !code.includes("PASSWORD")) return "Enter a valid email address.";
  if (code.includes("INVALID_TOKEN") || code.includes("EXPIRED")) return "This reset link is invalid or has expired. Request a new one.";
  if (action === "sign-in" && (status === 401 || code.includes("INVALID_EMAIL_OR_PASSWORD"))) return "Email or password is incorrect.";
  if (action === "request-reset" && (status === 404 || status === 400)) return "Password reset by email isn't enabled for this workspace yet.";
  if (status === 0) return "Couldn't reach the account service. Check your connection and try again.";
  return "Something went wrong on the account service. Try again in a moment.";
}
