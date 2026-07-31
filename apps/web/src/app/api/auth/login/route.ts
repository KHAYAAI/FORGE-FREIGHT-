import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { authorizationUrl, discover, randomToken } from "@/lib/oidc";
import { FLOW_COOKIE, flowCookieOptions, redirectUriFor, safeNextPath } from "@/lib/auth-flow";

/**
 * Starts the authorization-code flow: mints the PKCE verifier and CSRF state,
 * stashes both in a short-lived cookie, and hands the browser to Keycloak.
 */
export async function GET(req: NextRequest) {
  const cfg = authConfig();
  if (cfg.mode !== "oidc") {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const redirectUri = redirectUriFor(req);

  const endpoints = await discover(cfg);
  const url = await authorizationUrl({ cfg, endpoints, redirectUri, state, verifier });

  const res = NextResponse.redirect(url);
  res.cookies.set(FLOW_COOKIE, JSON.stringify({ state, verifier, next }), flowCookieOptions());
  return res;
}
