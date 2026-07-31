import { ForbiddenException } from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { parties, tenants, type Db } from "@forge-freight/db";

/**
 * Resolves what a CUSTOMER tenant is allowed to see.
 *
 * Everywhere else in this platform a query is scoped by `tenantId = caller`,
 * and that single rule is the whole security model. The portal is the one
 * deliberate exception: a shipper's cargo belongs to the *forwarder's* tenant,
 * so scoping the portal by the caller's own tenant would return nothing at
 * all.
 *
 * The exception is kept as narrow as it can be. Access exists only where a
 * forwarder has explicitly set `parties.customer_tenant_id` on a party row,
 * and every portal query is scoped to that resolved set of party ids — never
 * to a tenant, never to a shipment id supplied by the caller. A customer with
 * no linked parties resolves to an empty set and sees nothing, rather than
 * falling through to an unscoped query.
 */

export interface CustomerScope {
  /** Party rows, across every forwarder tenant, that point at this customer. */
  partyIds: string[];
}

export class NotACustomerTenantError extends ForbiddenException {
  constructor() {
    super("The portal is for customer tenants; use the operator console instead.");
  }
}

/** Throws unless the caller's tenant is of type CUSTOMER. */
export async function assertCustomerTenant(db: Db, tenantId: string): Promise<void> {
  const [tenant] = await db
    .select({ type: tenants.type })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (tenant?.type !== "CUSTOMER") throw new NotACustomerTenantError();
}

export async function resolveCustomerScope(db: Db, tenantId: string): Promise<CustomerScope> {
  const rows = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.customerTenantId, tenantId), isNotNull(parties.customerTenantId)));
  return { partyIds: rows.map((r) => r.id) };
}

/**
 * True when the scope grants access to nothing. Callers must short-circuit on
 * this rather than passing an empty array into an `inArray` — an empty `IN ()`
 * is a SQL error in some drivers and, worse, an easy thing to accidentally
 * optimise away into "no predicate at all".
 */
export function isEmpty(scope: CustomerScope): boolean {
  return scope.partyIds.length === 0;
}
