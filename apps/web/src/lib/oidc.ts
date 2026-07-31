import { decodeJwt } from "jose";
import type { OidcConfig } from "./auth-config";
import type { Session, SessionTokens } from "./session";

/**
 * Authorization-code flow with PKCE against Keycloak.
 *
 * Written directly against the OIDC endpoints rather than pulling in an auth
 * framework: the console needs exactly three operations (start, exchange,
 * refresh), the token shape is already understood by the API's verifier, and
 * a framework would own the session format this app has its own opinions
 * about. PKCE is used even when a client secret is configured — it costs one
 * hash and closes code interception regardless of client type.
 */

export interface Endpoints {
  authorization: string;
  token: string;
  endSession: string | null;
}

interface DiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  end_session_endpoint?: string;
}

const discoveryCache = new Map<string, { at: number; endpoints: Endpoints }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export class OidcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "OidcError";
    if (options?.cause) this.cause = options.cause;
  }
}

/**
 * Resolves endpoints from the issuer's discovery document, cached briefly so a
 * page render doesn't add a round trip. Falls back to Keycloak's conventional
 * paths if discovery is unreachable — a Keycloak restart shouldn't lock every
 * user out of a console whose endpoints haven't actually moved.
 */
export async function discover(cfg: OidcConfig, fetchImpl: typeof fetch = fetch): Promise<Endpoints> {
  const cached = discoveryCache.get(cfg.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.endpoints;

  const fallback = conventionalEndpoints(cfg.issuer);
  try {
    const res = await fetchImpl(`${cfg.issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const doc = (await res.json()) as DiscoveryDocument;
    const endpoints: Endpoints = {
      authorization: doc.authorization_endpoint ?? fallback.authorization,
      token: doc.token_endpoint ?? fallback.token,
      endSession: doc.end_session_endpoint ?? fallback.endSession,
    };
    discoveryCache.set(cfg.issuer, { at: Date.now(), endpoints });
    return endpoints;
  } catch {
    return fallback;
  }
}

export function conventionalEndpoints(issuer: string): Endpoints {
  const base = `${issuer.replace(/\/$/, "")}/protocol/openid-connect`;
  return {
    authorization: `${base}/auth`,
    token: `${base}/token`,
    endSession: `${base}/logout`,
  };
}

// --- PKCE -----------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// --- flow -----------------------------------------------------------------

export async function authorizationUrl(params: {
  cfg: OidcConfig;
  endpoints: Endpoints;
  redirectUri: string;
  state: string;
  verifier: string;
}): Promise<string> {
  const scopes = ["openid", "profile", "email", ...params.cfg.scopes];
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.cfg.clientId,
    redirect_uri: params.redirectUri,
    scope: [...new Set(scopes)].join(" "),
    state: params.state,
    code_challenge: await codeChallenge(params.verifier),
    code_challenge_method: "S256",
  });
  return `${params.endpoints.authorization}?${query.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

async function postToken(
  cfg: OidcConfig,
  endpoints: Endpoints,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  body.set("client_id", cfg.clientId);
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);

  const res = await fetchImpl(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    // Keycloak returns {error, error_description}; surface the code but not
    // the raw body, which can echo back the submitted code or refresh token.
    let code = `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) code = parsed.error;
    } catch {
      /* non-JSON error body — the status is all we have */
    }
    throw new OidcError(`Token endpoint rejected the request (${code})`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(params: {
  cfg: OidcConfig;
  endpoints: Endpoints;
  code: string;
  redirectUri: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    params.cfg,
    params.endpoints,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
    }),
    params.fetchImpl ?? fetch,
  );
}

export async function refreshTokens(params: {
  cfg: OidcConfig;
  endpoints: Endpoints;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    params.cfg,
    params.endpoints,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: params.refreshToken }),
    params.fetchImpl ?? fetch,
  );
}

export function endSessionUrl(params: {
  endpoints: Endpoints;
  idToken: string | null;
  redirectUri: string;
  clientId: string;
}): string | null {
  if (!params.endpoints.endSession) return null;
  const query = new URLSearchParams({ post_logout_redirect_uri: params.redirectUri });
  if (params.idToken) query.set("id_token_hint", params.idToken);
  else query.set("client_id", params.clientId);
  return `${params.endpoints.endSession}?${query.toString()}`;
}

// --- claims ---------------------------------------------------------------

export class MissingTenantClaimError extends OidcError {
  constructor(claim: string) {
    super(
      `Signed in, but the access token carries no '${claim}' claim. Add a Keycloak mapper ` +
        "that puts the tenant id on the token — without it the API cannot scope a single query.",
    );
    this.name = "MissingTenantClaimError";
  }
}

/**
 * Builds the session from the token response.
 *
 * The tenant and subject are read from the **access** token, because that is
 * the token the API verifies — reading them from the ID token instead would
 * let the console believe a tenant the API will never agree with. The token is
 * decoded, not verified, here: it was just received over TLS directly from the
 * token endpoint, and the API verifies its signature on every call.
 */
/**
 * Everything the access token can tell us about the session. Tenant *type* is
 * not in that set — it comes from the platform's own records, so the caller
 * completes the session with {@link fetchTenant}.
 */
export function sessionFromTokens(
  cfg: OidcConfig,
  tokens: TokenResponse,
): Omit<Session, "tenantType"> {
  const claims = decodeJwt(tokens.access_token);

  const tenantId = claims[cfg.tenantClaim];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new MissingTenantClaimError(cfg.tenantClaim);
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new OidcError("Access token is missing the 'sub' claim");
  }

  const label =
    (typeof claims["tenant_name"] === "string" && claims["tenant_name"]) ||
    (typeof claims["preferred_username"] === "string" && claims["preferred_username"]) ||
    tenantId;

  return {
    tenantId,
    tenantLabel: label,
    userId: claims.sub,
    mode: "oidc",
    tokens: toSessionTokens(tokens, claims.exp),
  };
}

export function toSessionTokens(tokens: TokenResponse, tokenExp?: number): SessionTokens {
  // Prefer the token's own `exp` over `expires_in`, which is relative to a
  // clock we don't share with the issuer.
  const expiresAt =
    typeof tokenExp === "number"
      ? tokenExp
      : Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 300);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt,
  };
}
