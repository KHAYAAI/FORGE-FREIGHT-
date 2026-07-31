export interface AuthContext {
  /** FORGE Freight tenant this request is scoped to. Never trust the body for this. */
  tenantId: string;
  userId: string;
  roles: string[];
}

export const AUTH_CONTEXT_KEY = "forgeAuth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant ids are uuids in every query predicate in the system. A caller who
 * presents a tenant identifier of some other shape must be rejected at the
 * door: if it reaches the query layer, Postgres raises a cast error and the
 * request becomes a 500, which reads as a server fault rather than the bad
 * credential it is.
 */
export function isTenantId(value: string): boolean {
  return UUID.test(value);
}
