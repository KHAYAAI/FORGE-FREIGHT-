import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { tenants, type Db } from "@forge-freight/db";
import { PortalController } from "../src/modules/portal/portal.controller.js";
import {
  createShipments,
  createTenantFixture,
  dropCustomerTenant,
  dropTenantFixture,
  linkCustomerTenant,
  testDb,
  type Fixture,
} from "./harness.js";

/**
 * The portal is the one place in the platform where data crosses a tenant
 * boundary: a shipper reads shipments that belong to its forwarder's tenant.
 * That makes it the highest-risk surface here, and the reason these tests run
 * against a real database rather than a mocked query builder — the scoping
 * rule is a join and an `IN`, and only Postgres can tell you whether it holds.
 *
 * Two forwarders, each with a linked customer, plus an unlinked customer, so
 * every leak has somewhere to leak *from*.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;
let acmeCustomer: string;
let rivalCustomer: string;
let controller: PortalController;

const auth = (tenantId: string) => ({ tenantId, userId: "portal-test", roles: [] });

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "portal-acme");
  rival = await createTenantFixture(db, "portal-rival");
  acmeCustomer = await linkCustomerTenant(db, acme, "acme-shipper");
  rivalCustomer = await linkCustomerTenant(db, rival, "rival-shipper");
  controller = new PortalController(db);

  await createShipments(db, acme, [
    { origin: "CNSHA", destination: "ZADUR" },
    { origin: "DEHAM", destination: "ZADUR", status: "IN_TRANSIT" },
  ]);
  await createShipments(db, rival, [{ origin: "SGSIN", destination: "ZACPT" }]);
});

afterAll(async () => {
  await dropCustomerTenant(db, acmeCustomer);
  await dropCustomerTenant(db, rivalCustomer);
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("portal scoping", () => {
  it("shows a customer the shipments booked for it", async () => {
    const page = await controller.shipments(auth(acmeCustomer));
    expect(page.total).toBe(2);
    expect(page.rows.every((r) => r.tenantId === acme.tenantId)).toBe(true);
  });

  it("never shows another customer's cargo", async () => {
    const mine = await controller.shipments(auth(acmeCustomer));
    const theirs = await controller.shipments(auth(rivalCustomer));
    expect(theirs.total).toBe(1);

    const mineIds = new Set(mine.rows.map((r) => r.id));
    expect(theirs.rows.some((r) => mineIds.has(r.id))).toBe(false);
  });

  it("refuses a tenant id that does not exist", async () => {
    await expect(controller.shipments(auth(randomUUID()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("returns an empty page for a customer tenant no forwarder has linked", async () => {
    // The dangerous failure would be an empty scope falling through to an
    // unscoped query and returning the whole platform's freight, so assert on
    // the empty result rather than only on the happy path.
    const [unlinked] = await db
      .insert(tenants)
      .values({ id: randomUUID(), type: "CUSTOMER", name: `test-unlinked-${randomUUID().slice(0, 8)}` })
      .returning({ id: tenants.id });
    try {
      const page = await controller.shipments(auth(unlinked!.id));
      expect(page.rows).toHaveLength(0);
      expect(page.total).toBe(0);
    } finally {
      await db.delete(tenants).where(eq(tenants.id, unlinked!.id));
    }
  });

  it("refuses an operator tenant — the portal is not a second way into the console", async () => {
    await expect(controller.shipments(auth(acme.tenantId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("filters by status like the operator list does", async () => {
    const page = await controller.shipments(auth(acmeCustomer), "IN_TRANSIT");
    expect(page.total).toBe(1);
    expect(page.rows[0]!.status).toBe("IN_TRANSIT");
  });

  it("paginates without leaking across the boundary", async () => {
    const first = await controller.shipments(auth(acmeCustomer), undefined, undefined, "1");
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await controller.shipments(auth(acmeCustomer), undefined, first.nextCursor!, "1");
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
    expect(second.rows.every((r) => r.tenantId === acme.tenantId)).toBe(true);
  });
});

describe("portal shipment detail", () => {
  it("returns a shipment the customer owns", async () => {
    const page = await controller.shipments(auth(acmeCustomer));
    const target = page.rows[0]!;
    const found = await controller.shipment(target.id, auth(acmeCustomer));
    expect(found?.id).toBe(target.id);
  });

  it("hides another customer's shipment behind the same 'not found' as a bad id", async () => {
    // A probing caller must not be able to distinguish "exists, not yours"
    // from "does not exist" — that difference is itself a disclosure.
    const theirs = (await controller.shipments(auth(rivalCustomer))).rows[0]!;
    expect(await controller.shipment(theirs.id, auth(acmeCustomer))).toBeNull();
    expect(await controller.shipment(randomUUID(), auth(acmeCustomer))).toBeNull();
  });

  it("returns an empty timeline for a shipment the customer does not own", async () => {
    const theirs = (await controller.shipments(auth(rivalCustomer))).rows[0]!;
    expect(await controller.timeline(theirs.id, auth(acmeCustomer))).toHaveLength(0);
  });
});
