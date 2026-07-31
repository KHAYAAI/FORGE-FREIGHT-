import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { discover, exchangeCode, sessionFromTokens, OidcError } from "@/lib/oidc";
import { FLOW_COOKIE, parseFlowState, publicOrigin, redirectUriFor } from "@/lib/auth-flow";
import { SESSION_COOKIE, sealSession, sessionCookieOptions } from "@/lib/session";

/** Session cookie lifetime. Refreshes extend the tokens inside it, not this. */
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function failure(req: NextRequest, reason: string) {
  const url = new URL("/login", publicOrigin(req));
  url.searchParams.set("error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(FLOW_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const cfg = authConfig();
  if (cfg.mode !== "oidc") return failure(req, "not_configured");

  const params = req.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) return failure(req, providerError);

  const flow = parseFlowState(req.cookies.get(FLOW_COOKIE)?.value);
  if (!flow) return failure(req, "expired");

  // Constant work either way; the comparison itself is not secret-dependent
  // beyond equality, and a mismatch means someone else initiated this flow.
  const state = params.get("state");
  if (!state || state !== flow.state) return failure(req, "state_mismatch");

  const code = params.get("code");
  if (!code) return failure(req, "no_code");

  try {
    const endpoints = await discover(cfg);
    const tokens = await exchangeCode({
      cfg,
      endpoints,
      code,
      redirectUri: redirectUriFor(req),
      verifier: flow.verifier,
    });
    const session = sessionFromTokens(cfg, tokens);
    const sealed = await sealSession(session, SESSION_TTL_SECONDS);

    const res = NextResponse.redirect(new URL(flow.next, publicOrigin(req)));
    res.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(SESSION_TTL_SECONDS));
    res.cookies.delete(FLOW_COOKIE);
    return res;
  } catch (err) {
    // The message is safe to surface — it names the misconfiguration (a
    // missing tenant claim, most often) without echoing tokens.
    const reason = err instanceof OidcError ? err.message : "exchange_failed";
    return failure(req, reason);
  }
}
