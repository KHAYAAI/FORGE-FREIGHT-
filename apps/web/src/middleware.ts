import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { discover, refreshTokens, toSessionTokens } from "@/lib/oidc";
import {
  SESSION_COOKIE,
  needsRefresh,
  openSession,
  sealSession,
  sessionCookieOptions,
  type Session,
} from "@/lib/session";

const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/session", "/_next"];
const SESSION_TTL_SECONDS = 60 * 60 * 12;

/**
 * Gate every console route on a session, and refresh the access token here
 * rather than at the point of use.
 *
 * This file must live in `src/` — Next.js looks for middleware next to the
 * `app` directory, so with a `src/app` layout a root-level `middleware.ts` is
 * silently never registered. It sat there unexecuted until this was found;
 * the only thing keeping unauthenticated requests out was the belt-and-braces
 * redirect in the app layout.
 *
 * Refreshing in middleware is not an arbitrary choice: Server Components
 * cannot set cookies, so a refresh discovered during a page render would have
 * nowhere to persist the new tokens and every subsequent render would refresh
 * again. Middleware runs before the render, can write the response cookie,
 * and can rewrite the *request* cookie so the render downstream sees the
 * fresh token in the same pass.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const cfg = authConfig();
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? await openSession(raw) : null;

  if (!session) return toLogin(req);
  if (cfg.mode !== "oidc" || !needsRefresh(session)) return NextResponse.next();

  const refreshToken = session.tokens?.refreshToken;
  if (!refreshToken) return toLogin(req, "session_expired");

  try {
    const endpoints = await discover(cfg);
    const refreshed = await refreshTokens({ cfg, endpoints, refreshToken });
    const next: Session = {
      ...session,
      tokens: toSessionTokens(refreshed, decodeExp(refreshed.access_token)),
    };
    const sealed = await sealSession(next, SESSION_TTL_SECONDS);

    // Hand the fresh cookie to this request's render as well as the browser —
    // otherwise the page below still reads the stale token it was about to
    // send to an API that would reject it.
    const headers = new Headers(req.headers);
    headers.set("cookie", replaceCookie(headers.get("cookie") ?? "", SESSION_COOKIE, sealed));

    const res = NextResponse.next({ request: { headers } });
    res.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(SESSION_TTL_SECONDS));
    return res;
  } catch {
    // Refresh token expired or revoked (an admin ended the session, or the
    // user signed out elsewhere). Nothing to recover — send them to sign in.
    return toLogin(req, "session_expired");
  }
}

function toLogin(req: NextRequest, error?: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  if (error) url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  if (error) res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** Decode `exp` without verifying — the API verifies the signature on use. */
function decodeExp(jwt: string): number | undefined {
  const payload = jwt.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

function replaceCookie(header: string, name: string, value: string): string {
  const others = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(`${name}=`));
  return [...others, `${name}=${value}`].join("; ");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
