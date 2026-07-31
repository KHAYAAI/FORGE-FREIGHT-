import type { NextRequest } from "next/server";

/**
 * Short-lived state for an in-flight authorization-code exchange: the PKCE
 * verifier, the CSRF state value, and where to land afterwards. Kept in its
 * own cookie rather than the session cookie because it exists only between
 * the redirect out to Keycloak and the redirect back.
 */
export const FLOW_COOKIE = "ff_auth_flow";

export interface FlowState {
  state: string;
  verifier: string;
  next: string;
}

export function flowCookieOptions() {
  return {
    httpOnly: true,
    // `lax` still sends the cookie on the top-level GET that Keycloak
    // redirects back to; `strict` would not, and the callback would have
    // nothing to verify the state against.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
}

export function parseFlowState(raw: string | undefined): FlowState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FlowState>;
    if (!parsed.state || !parsed.verifier) return null;
    return { state: parsed.state, verifier: parsed.verifier, next: safeNextPath(parsed.next) };
  } catch {
    return null;
  }
}

/**
 * Only same-site absolute paths survive. An unchecked `next` is an open
 * redirect: an attacker sends `/api/auth/login?next=https://evil.example`,
 * the user authenticates for real, and lands on the attacker's page still
 * believing they are in the console. Protocol-relative `//host` is rejected
 * for the same reason — the browser reads it as another origin.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * The redirect URI registered with Keycloak. Derived from the incoming
 * request so preview deployments work, but pinned by `AUTH_REDIRECT_URI`
 * where the public origin differs from what the app sees behind a proxy.
 */
export function redirectUriFor(req: NextRequest): string {
  const configured = process.env.AUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/auth/callback", publicOrigin(req)).toString();
}

export function publicOrigin(req: NextRequest): string {
  const configured = process.env.AUTH_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}
