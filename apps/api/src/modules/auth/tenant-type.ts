import { ForbiddenException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { tenants, type Db } from "@forge-freight/db";

export type TenantType = (typeof tenants.type.enumValues)[number];

/**
 * The tenants that run a book of freight: a forwarder and the partner agents
 * operating on its rails. Both price lanes, book cargo and invoice customers,
 * so both need the commercial surfaces — a partner that cannot maintain its
 * own rate cards is not really running its own business.
 */
export const COMMERCIAL_TENANTS: readonly TenantType[] = ["OPERATOR", "PARTNER_AGENT"];

/**
 * Refuse a caller whose tenant is the wrong kind for this surface.
 *
 * Tenant *isolation* is enforced by the `tenantId` predicate on every query;
 * this is the separate question of whether a tenant of this kind should see
 * the surface at all. Keeping it in one helper means the answer cannot drift
 * between controllers.
 */
export async function requireTenantType(
  db: Db,
  tenantId: string,
  allowed: readonly TenantType[],
  message: string,
): Promise<TenantType> {
  const [caller] = await db
    .select({ type: tenants.type })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!caller || !allowed.includes(caller.type)) throw new ForbiddenException(message);
  return caller.type;
}
