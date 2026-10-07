const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthContext {
  readonly userId: string;
  readonly provider: string;
  readonly subject: string;
}

export interface AuthProvider {
  getContext(): Promise<AuthContext | null>;
}

export class AuthNotConfiguredError extends Error {
  constructor() {
    super("no auth provider is configured for this application");
    this.name = "AuthNotConfiguredError";
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("request is not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export function validateAuthContext(context: AuthContext): AuthContext {
  if (
    typeof context.userId !== "string" ||
    !UUID_PATTERN.test(context.userId) ||
    typeof context.provider !== "string" ||
    context.provider.trim().length === 0 ||
    typeof context.subject !== "string" ||
    context.subject.trim().length === 0
  ) {
    throw new UnauthenticatedError();
  }
  return Object.freeze({ userId: context.userId, provider: context.provider, subject: context.subject });
}

export async function requireAuth(provider?: AuthProvider): Promise<AuthContext> {
  if (provider === undefined) throw new AuthNotConfiguredError();
  const context = await provider.getContext();
  if (context === null) throw new UnauthenticatedError();
  return validateAuthContext(context);
}
