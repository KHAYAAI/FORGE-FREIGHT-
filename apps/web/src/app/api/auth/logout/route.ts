import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { discover, endSessionUrl } from "@/lib/oidc";
import { publicOrigin } from "@/lib/auth-flow";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Clears the console session and, under OIDC, also ends the Keycloak session
 * so "sign out" doesn't leave a single click away from being signed straight
 * back in on a shared machine.
 */
async function signOut(req: NextRequest) {
  const cfg = authConfig();
  const origin = publicOrigin(req);
  let target = new URL("/login", origin).toString();

  if (cfg.mode === "oidc") {
    const endpoints = await discover(cfg);
    target =
      endSessionUrl({
        endpoints,
        // The ID token isn't retained (it is not needed to call the API, and
        // keeping it would bloat the cookie), so log out by client id.
        idToken: null,
        redirectUri: new URL("/login", origin).toString(),
        clientId: cfg.clientId,
      }) ?? target;
  }

  const res = NextResponse.redirect(target);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  return signOut(req);
}

export async function POST(req: NextRequest) {
  return signOut(req);
}
