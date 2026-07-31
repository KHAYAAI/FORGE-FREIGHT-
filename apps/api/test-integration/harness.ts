import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  bookings,
  createDb,
  events,
  parties,
  shipmentExceptions,
  shipments,
  tenants,
  type Db,
} from "@forge-freight/db";

/**
 * Fixtures for tests that run against a real Postgres.
 *
 * Every fixture hangs off a freshly created tenant with a random id, so test
 * files never collide and nothing has to truncate shared tables — the
 * teardown deletes exactly what it made. That also means these tests can run
 * against a database that already has data in it, including a developer's own
 * dev database, without eating it.
 */

export function testDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Integration tests need DATABASE_URL pointing at a Postgres you are willing to write to.",
    );
  }
  return createDb(url);
}

export interface Fixture {
  tenantId: string;
  customerId: string;
  bookingId: string;
}

/** A tenant with a customer and a booking, ready to hang shipments off. */
export async function createTenantFixture(db: Db, name: string): Promise<Fixture> {
  const [tenant] = await db
    .insert(tenants)
    .values({ id: randomUUID(), type: "OPERATOR", name: `test-${name}-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenants.id });

  const [customer] = await db
    .insert(parties)
    .values({ id: randomUUID(), tenantId: tenant!.id, name: `${name} customer` })
    .returning({ id: parties.id });

  const [booking] = await db
    .insert(bookings)
    .values({ id: randomUUID(), tenantId: tenant!.id, customerId: customer!.id })
    .returning({ id: bookings.id });

  return { tenantId: tenant!.id, customerId: customer!.id, bookingId: booking!.id };
}

export interface ShipmentSpec {
  origin: string;
  destination: string;
  status?: "BOOKED" | "IN_TRANSIT" | "CUSTOMS" | "DELIVERED" | "CANCELLED";
  createdAt?: Date;
}

export async function createShipments(
  db: Db,
  fixture: Fixture,
  specs: ShipmentSpec[],
): Promise<string[]> {
  const rows = specs.map((spec, i) => ({
    id: randomUUID(),
    tenantId: fixture.tenantId,
    bookingId: fixture.bookingId,
    reference: `TEST-${randomUUID().slice(0, 12)}-${i}`,
    status: (spec.status ?? "BOOKED") as never,
    origin: spec.origin,
    destination: spec.destination,
    incoterm: "CIF" as const,
    createdAt: spec.createdAt ?? new Date(),
  }));
  await db.insert(shipments).values(rows);
  return rows.map((r) => r.id);
}

/**
 * A CUSTOMER tenant, linked to the fixture's customer party so the portal can
 * resolve a scope for it. Mirrors what an operator does via
 * `POST /parties/:id/customer-tenant`.
 */
export async function linkCustomerTenant(db: Db, fixture: Fixture, name: string): Promise<string> {
  const [tenant] = await db
    .insert(tenants)
    .values({ id: randomUUID(), type: "CUSTOMER", name: `test-${name}-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenants.id });

  await db
    .update(parties)
    .set({ customerTenantId: tenant!.id })
    .where(eq(parties.id, fixture.customerId));

  return tenant!.id;
}

export async function raiseException(db: Db, fixture: Fixture, shipmentId: string) {
  await db.insert(shipmentExceptions).values({
    id: randomUUID(),
    tenantId: fixture.tenantId,
    shipmentId,
    code: "CUSTOMS_QUERY",
    detail: "integration fixture",
    raisedAt: new Date(),
  });
}

/** Deletes in FK order. Safe to call on a partially built fixture. */
export async function dropCustomerTenant(db: Db, tenantId: string) {
  await db.update(parties).set({ customerTenantId: null }).where(eq(parties.customerTenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

export async function dropTenantFixture(db: Db, fixture: Fixture) {
  const ids = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.tenantId, fixture.tenantId));
  const shipmentIds = ids.map((r) => r.id);

  if (shipmentIds.length > 0) {
    await db.delete(shipmentExceptions).where(inArray(shipmentExceptions.shipmentId, shipmentIds));
  }
  await db.delete(events).where(eq(events.tenantId, fixture.tenantId));
  await db.delete(shipments).where(eq(shipments.tenantId, fixture.tenantId));
  await db.delete(bookings).where(eq(bookings.tenantId, fixture.tenantId));
  await db.delete(parties).where(eq(parties.tenantId, fixture.tenantId));
  await db.delete(tenants).where(eq(tenants.id, fixture.tenantId));
}

/** The auth context a controller sees once the JWT guard has run. */
export function authFor(fixture: Fixture) {
  return { tenantId: fixture.tenantId, userId: "integration-test", roles: ["ops"] };
}
