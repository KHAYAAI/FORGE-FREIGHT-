/**
 * Console auth configuration.
 *
 * Two modes, mirroring the API's own `AUTH_MODE`:
 *
 * - `oidc` — real Keycloak sign-in. The console runs the authorization-code
 *   flow with PKCE, keeps the resulting tokens in an encrypted cookie, and
 *   forwards the access token to the API as a bearer. This is the only mode
 *   the API accepts in production (`apps/api/src/config.ts` refuses to boot
 *   with `AUTH_MODE=dev` when `NODE_ENV=production`).
 * - `dev` — the local shortcut: type a tenant id, get a session, and the
 *   proxy sends `x-dev-*` headers the API's dev guard trusts. No credential
 *   is checked, so this must never be reachable from the internet.
 *
 * Mode is chosen by `AUTH_MODE`, defaulting to `oidc` whenever an issuer is
 * configured. The failure this ordering prevents: a production deploy that
 * forgets to set `AUTH_MODE` and silently falls back to header auth.
 */

export type AuthMode = "oidc" | "dev";

export interface OidcConfig {
  mode: "oidc";
  issuer: string;
  clientId: string;
  /** Omitted for a public client — PKCE carries the proof instead. */
  clientSecret: string | null;
  /** Claim on the access token that carries the tenant id. */
  tenantClaim: string;
  /** Extra scopes beyond `openid profile email`. */
  scopes: string[];
  /** Encrypts the session cookie. Never leaves the server. */
  sessionSecret: string;
}

export interface DevConfig {
  mode: "dev";
}

export type AuthConfig = OidcConfig | DevConfig;

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/**
 * Reads config from an env bag so tests don't have to mutate `process.env`.
 * Typed as a plain record rather than `NodeJS.ProcessEnv` so a literal is a
 * valid argument — every field it reads is an optional string either way.
 */
export type EnvBag = Record<string, string | undefined>;

export function readAuthConfig(env: EnvBag = process.env): AuthConfig {
  const issuer = env.AUTH_ISSUER?.trim() ?? "";
  const declared = env.AUTH_MODE?.trim().toLowerCase();

  if (declared && declared !== "oidc" && declared !== "dev" && declared !== "jwt") {
    throw new AuthConfigError(`AUTH_MODE must be 'oidc' or 'dev', got '${declared}'`);
  }
  // `jwt` is the API's spelling of the same thing; accept it so one shared
  // env file can drive both services without a second variable to keep in sync.
  const mode: AuthMode = declared === "dev" ? "dev" : declared ? "oidc" : issuer ? "oidc" : "dev";

  if (mode === "dev") {
    if (env.NODE_ENV === "production") {
      throw new AuthConfigError(
        "AUTH_MODE=dev is refused in production — the console would accept any tenant id " +
          "with no credential. Configure AUTH_ISSUER and Keycloak instead.",
      );
    }
    return { mode: "dev" };
  }

  if (!issuer) {
    throw new AuthConfigError("AUTH_ISSUER is required when AUTH_MODE=oidc");
  }
  const clientId = env.AUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new AuthConfigError("AUTH_CLIENT_ID is required when AUTH_MODE=oidc");
  }
  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new AuthConfigError(
      "SESSION_SECRET is required when AUTH_MODE=oidc and must be at least 32 characters — " +
        "it encrypts the session cookie holding the user's tokens.",
    );
  }

  return {
    mode: "oidc",
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret: env.AUTH_CLIENT_SECRET?.trim() || null,
    tenantClaim: env.AUTH_TENANT_CLAIM?.trim() || "tenant_id",
    scopes: (env.AUTH_SCOPES?.trim() || "").split(/[\s,]+/).filter(Boolean),
    sessionSecret,
  };
}

let cached: AuthConfig | null = null;

/** Process-wide config, resolved once. Throws on invalid configuration. */
export function authConfig(): AuthConfig {
  cached ??= readAuthConfig();
  return cached;
}

/** Test seam — forget the memoised config. */
export function resetAuthConfig(): void {
  cached = null;
}
