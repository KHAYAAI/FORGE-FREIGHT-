import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { authConfig, type AuthConfig } from "./auth-config";

/**
 * The console session.
 *
 * In `oidc` mode this carries the Keycloak tokens, so the cookie is encrypted
 * (JWE, A256GCM) rather than merely signed — a signed cookie would leave a
 * usable bearer token readable by anything that can see the cookie value: a
 * proxy log, a browser extension with host permissions, an errant
 * `document.cookie` read if the `httpOnly` flag were ever dropped. Encryption
 * makes the cookie opaque to everything except this process.
 *
 * In `dev` mode there are no tokens — just the tenant the operator typed —
 * but it uses the same sealed format so there is exactly one decode path to
 * reason about.
 */
export const SESSION_COOKIE = "ff_session";

/** Refresh this far ahead of expiry so a request never races the clock. */
export const REFRESH_SKEW_SECONDS = 60;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export interface Session {
  tenantId: string;
  tenantLabel: string;
  userId: string;
  /** Which auth mode minted this session — a dev cookie must never be honoured under oidc. */
  mode: "oidc" | "dev";
  tokens?: SessionTokens;
}

/**
 * Cookies cap at 4 KB. Keycloak access tokens grow with every claim mapper and
 * group membership, so a realm configured with generous mappers can push the
 * sealed session past the limit — at which point the browser silently drops
 * it and the user bounces back to the login page with no error anywhere.
 * Fail loudly at the point of sealing instead.
 */
const MAX_COOKIE_BYTES = 3800;

export class SessionTooLargeError extends Error {
  constructor(size: number) {
    super(
      `Sealed session is ${size} bytes, over the ${MAX_COOKIE_BYTES}-byte budget. ` +
        "Trim the Keycloak client's claim mappers (group and role mappers are the usual cause) " +
        "so the access token carries only what the API needs.",
    );
    this.name = "SessionTooLargeError";
  }
}

/**
 * Dev mode has no configured secret and no secret to protect — the cookie's
 * contents are a tenant id the user typed in a form with no credential. The
 * constant key keeps one code path rather than branching the seal/open logic.
 */
const DEV_KEY_MATERIAL = "forge-freight-dev-session-key-not-a-secret";

async function keyFor(cfg: AuthConfig): Promise<Uint8Array> {
  const material = cfg.mode === "oidc" ? cfg.sessionSecret : DEV_KEY_MATERIAL;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return new Uint8Array(digest);
}

export async function sealSession(session: Session, ttlSeconds: number): Promise<string> {
  const cfg = authConfig();
  const sealed = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(await keyFor(cfg));

  if (sealed.length > MAX_COOKIE_BYTES) throw new SessionTooLargeError(sealed.length);
  return sealed;
}

export async function openSession(sealed: string): Promise<Session | null> {
  const cfg = authConfig();
  try {
    const { payload } = await jwtDecrypt(sealed, await keyFor(cfg));
    const session = payload as unknown as Session;
    if (!session.tenantId || !session.userId) return null;
    // A cookie minted under dev mode must not authenticate anything once the
    // deployment has been switched to oidc, and vice versa.
    if (session.mode !== cfg.mode) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return openSession(raw);
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** True when the access token is expired or close enough that it may expire mid-flight. */
export function needsRefresh(session: Session, now = Date.now()): boolean {
  if (session.mode !== "oidc" || !session.tokens) return false;
  return session.tokens.expiresAt - REFRESH_SKEW_SECONDS <= Math.floor(now / 1000);
}

/**
 * Auth headers for a call to the API, in whichever mode is configured.
 * One helper so the server-side client and the browser proxy can't drift.
 */
export function authHeaders(session: Session | null): Record<string, string> {
  if (!session) return {};
  if (session.mode === "oidc") {
    return session.tokens ? { authorization: `Bearer ${session.tokens.accessToken}` } : {};
  }
  return { "x-dev-tenant-id": session.tenantId, "x-dev-user-id": session.userId };
}
