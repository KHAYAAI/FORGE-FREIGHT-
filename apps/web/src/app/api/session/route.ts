import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth-config";
import { SESSION_COOKIE, sealSession, sessionCookieOptions, type Session } from "@/lib/session";
import { fetchTenant, TenantLookupError } from "@/lib/tenant-lookup";

const DEV_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The API rejects a non-uuid tenant at the guard, so minting a session for
  // one would hand back a cookie that 401s on every subsequent page.
  if (!UUID.test(body.tenantId)) {
    return NextResponse.json({ error: "tenantId must be a uuid" }, { status: 400 });
  }

  const userId = body.userId ?? "dev";
  let tenant;
  try {
    tenant = await fetchTenant({ "x-dev-tenant-id": body.tenantId, "x-dev-user-id": userId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof TenantLookupError ? err.message : "Tenant lookup failed" },
      { status: 400 },
    );
  }

  const session: Session = {
    tenantId: body.tenantId,
    tenantLabel: tenant.name || body.tenantLabel || body.tenantId,
    userId,
    tenantType: tenant.type,
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
