import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { createSession, type DbSession } from "../db/client";
import {
  AuthNotConfiguredError,
  AuthProviderUnavailableError,
  validateAuthContext,
  type AuthContext,
  type AuthProvider,
} from "./context";

type SessionUser = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
};

export interface SessionAuthClient {
  getSession(): Promise<{
    data?: { user?: SessionUser | null } | null;
    error?: unknown;
  }>;
}

let authInstance: NeonAuth | undefined;

function getAuthConfig(): { baseUrl: string; cookieSecret: string } {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret || cookieSecret.length < 32) throw new AuthNotConfiguredError();
  try {
    const parsed = new URL(baseUrl);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
      throw new Error("invalid auth URL");
    }
  } catch {
    throw new AuthNotConfiguredError();
  }
  return { baseUrl, cookieSecret };
}

export function getNeonAuth(): NeonAuth {
  if (!authInstance) {
    const config = getAuthConfig();
    authInstance = createNeonAuth({
      baseUrl: config.baseUrl,
      cookies: { secret: config.cookieSecret },
      logLevel: "silent",
    });
  }
  return authInstance;
}

async function resolveReflexUser(db: DbSession, externalUser: SessionUser): Promise<string> {
  const externalId = externalUser.id;
  if (typeof externalId !== "string" || externalId.trim().length === 0) {
    throw new AuthProviderUnavailableError();
  }
  const displayName = typeof externalUser.name === "string" && externalUser.name.trim().length > 0 ? externalUser.name : null;
  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO public.users (auth_provider,auth_subject,display_name) VALUES($1,$2,$3) ON CONFLICT (auth_provider,auth_subject) DO UPDATE SET display_name=COALESCE(public.users.display_name,EXCLUDED.display_name) RETURNING id`,
      ["neon-auth", externalId, displayName],
    );
    const reflexUserId = result.rows[0]?.id;
    if (typeof reflexUserId !== "string") throw new Error("missing Reflex user id");
    return reflexUserId;
  } catch {
    throw new AuthProviderUnavailableError();
  }
}

export interface NeonAuthProviderOptions {
  auth?: SessionAuthClient;
  db?: DbSession;
}

export class NeonAuthProvider implements AuthProvider {
  private readonly auth: SessionAuthClient;
  private readonly db: DbSession;

  constructor(options: NeonAuthProviderOptions = {}) {
    this.auth = options.auth ?? (getNeonAuth() as unknown as SessionAuthClient);
    this.db = options.db ?? createSession();
  }

  async getContext(): Promise<AuthContext | null> {
    let result: Awaited<ReturnType<SessionAuthClient["getSession"]>>;
    try {
      result = await this.auth.getSession();
    } catch {
      throw new AuthProviderUnavailableError();
    }
    if (result.error) throw new AuthProviderUnavailableError();
    const user = result.data?.user;
    if (!user) return null;
    const reflexUserId = await resolveReflexUser(this.db, user);
    const email = typeof user.email === "string" && user.email.trim().length > 0 ? user.email : undefined;
    return validateAuthContext({
      userId: reflexUserId,
      provider: "neon-auth",
      subject: String(user.id),
      externalAuthUserId: String(user.id),
      ...(email === undefined ? {} : { email }),
    });
  }
}

export function resetNeonAuthForTests(): void {
  authInstance = undefined;
}
