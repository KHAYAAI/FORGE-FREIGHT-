import { cookies } from "next/headers";

/**
 * Dev-mode session: a signed-nothing cookie carrying the tenant to scope
 * requests to, standing in for the Keycloak-issued bearer token production
 * expects (AUTH_MODE=jwt). Swapping to real OIDC means replacing this file's
 * read with a verified session/JWT lookup — every call site already goes
 * through `getSession()`, so the surface area is small.
 */
export const SESSION_COOKIE = "ff_session";

export interface Session {
  tenantId: string;
  tenantLabel: string;
  userId: string;
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

export function encodeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}
