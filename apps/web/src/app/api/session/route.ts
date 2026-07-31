import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { SESSION_COOKIE, sealSession, sessionCookieOptions, type Session } from "@/lib/session";

const DEV_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Dev-mode sign-in: take a tenant id on trust and mint a session.
 *
 * There is no credential here by design — it stands in for Keycloak while
 * developing locally. It is refused outright under `AUTH_MODE=oidc`, so a
 * deployment configured for real auth cannot be talked into issuing one of
 * these by posting to the endpoint directly.
 */
export async function POST(req: Request) {
  const cfg = authConfig();
  if (cfg.mode !== "dev") {
    return NextResponse.json(
      { error: "Dev sign-in is disabled; this deployment uses OIDC." },
      { status: 404 },
    );
  }

  const body = (await req.json()) as Partial<Session>;
  if (!body.tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const session: Session = {
    tenantId: body.tenantId,
    tenantLabel: body.tenantLabel ?? body.tenantId,
    userId: body.userId ?? "dev",
    mode: "dev",
  };

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    await sealSession(session, DEV_SESSION_TTL_SECONDS),
    sessionCookieOptions(DEV_SESSION_TTL_SECONDS),
  );
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
