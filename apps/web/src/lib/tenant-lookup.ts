import type { Tenant } from "./types";

/**
 * Resolve who the caller's tenant actually is, at sign-in.
 *
 * Deliberately not read from a token claim: the tenant *id* comes from the
 * identity provider, but what kind of tenant it is belongs to this platform's
 * own records. An IdP admin who could set a `tenant_type` claim could
 * otherwise promote a customer to an operator without touching our database.
 *
 * Standalone rather than part of `lib/api.ts` because it runs before the
 * session cookie exists, so it takes the auth headers directly instead of
 * reading them back out of a cookie that has not been set yet.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class TenantLookupError extends Error {
  constructor(status: number, detail: string) {
    super(`Could not resolve the signed-in tenant (${status}): ${detail}`);
    this.name = "TenantLookupError";
  }
}

export async function fetchTenant(authHeaders: Record<string, string>): Promise<Tenant> {
  const res = await fetch(`${API_URL}/tenants/me`, {
    headers: authHeaders,
    cache: "no-store",
  });
  if (!res.ok) throw new TenantLookupError(res.status, await res.text());

  // An unknown tenant id comes back as 200 with an empty body, not as a 404,
  // so parse defensively rather than letting a SyntaxError escape as
  // something unrelated to the actual problem.
  const body = await res.text();
  const tenant = body ? (JSON.parse(body) as Tenant | null) : null;
  if (!tenant?.type) {
    throw new TenantLookupError(
      404,
      "the API has no tenant with this id — the identity provider issued a tenant claim " +
        "that does not exist on this deployment",
    );
  }
  return tenant;
}
