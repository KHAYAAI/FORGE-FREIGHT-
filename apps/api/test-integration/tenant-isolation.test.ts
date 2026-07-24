import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeEvent, ShipmentBooked } from "@forge-freight/events";
import type { Db } from "@forge-freight/db";
import { ShipmentsController } from "../src/modules/shipments/shipments.controller.js";
import { appendEvent } from "../src/modules/db/event-store.js";
import {
  authFor,
  createShipments,
  createTenantFixture,
  dropTenantFixture,
  raiseException,
  testDb,
  type Fixture,
} from "./harness.js";

/**
 * The entire security model of this platform is "a tenant sees its own rows
 * and nothing else", enforced by a `tenantId` predicate on every query rather
 * than by anything the application layer decides. That claim is only worth
 * something if it is checked against a real database — a mocked query builder
 * returns whatever the mock was told to return, so the unit suite would pass
 * just as happily with the predicate deleted.
 *
 * Every test here therefore builds two tenants with overlapping-looking data
 * and asserts that neither can see the other's.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "acme");
  rival = await createTenantFixture(db, "rival");
});

afterAll(async () => {
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("tenant isolation", () => {
  it("lists only the caller's shipments", async () => {
    await createShipments(db, acme, [
      { origin: "CNSHA", destination: "ZADUR" },
      { origin: "DEHAM", destination: "ZADUR" },
    ]);
    await createShipments(db, rival, [{ origin: "CNSHA", destination: "ZADUR" }]);

    const controller = new ShipmentsController(db);
    const mine = await controller.list(authFor(acme));
    const theirs = await controller.list(authFor(rival));

    expect(mine.total).toBe(2);
    expect(theirs.total).toBe(1);
    expect(mine.rows.every((r) => r.tenantId === acme.tenantId)).toBe(true);
    expect(theirs.rows.every((r) => r.tenantId === rival.tenantId)).toBe(true);
  });

  it("refuses to widen the window when handed another tenant's cursor", async () => {
    // Enough rival rows that their first page definitely has a next one.
    await createShipments(db, rival, [
      { origin: "SGSIN", destination: "ZADUR" },
      { origin: "SGSIN", destination: "ZACPT" },
    ]);

    const controller = new ShipmentsController(db);
    // A cursor is a position, not a capability. Paging with one minted against
    // a different tenant's data must still only ever return your own rows.
    const theirPage = await controller.list(authFor(rival), undefined, undefined, "1");
    expect(theirPage.nextCursor).not.toBeNull();

    const mine = await controller.list(authFor(acme), undefined, theirPage.nextCursor!);
    expect(mine.rows.every((r) => r.tenantId === acme.tenantId)).toBe(true);
  });

  it("keeps another tenant's exceptions off the ops board", async () => {
    const [mineId] = await createShipments(db, acme, [{ origin: "ZADUR", destination: "ZAJNB" }]);
    const [theirsId] = await createShipments(db, rival, [{ origin: "ZADUR", destination: "ZAJNB" }]);
    await raiseException(db, acme, mineId!);
    await raiseException(db, rival, theirsId!);

    const controller = new ShipmentsController(db);
    const mine = await controller.openExceptions(authFor(acme));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.shipmentId).toBe(mineId);
  });

  it("keeps another tenant's events out of a shipment timeline", async () => {
    const [shipmentId] = await createShipments(db, acme, [
      { origin: "CNSHA", destination: "ZACPT" },
    ]);

    await appendEvent(
      db,
      makeEvent({
        definition: ShipmentBooked,
        tenantId: acme.tenantId,
        shipmentId,
        actor: { kind: "USER", id: "test", tenantId: acme.tenantId },
        payload: {
          bookingId: acme.bookingId,
          quoteId: null,
          customerId: acme.customerId,
          origin: "CNSHA",
          destination: "ZACPT",
          mode: "OCEAN",
          incoterm: "CIF",
          containers: [{ containerType: "40HC", quantity: 1 }],
          carrierBookingRef: null,
        },
      }),
    );

    const controller = new ShipmentsController(db);
    // The shipment id is real and the event exists — only the tenant differs.
    expect(await controller.timeline(shipmentId!, authFor(acme))).toHaveLength(1);
    expect(await controller.timeline(shipmentId!, authFor(rival))).toHaveLength(0);
  });

  it("aggregates corridors within the tenant only", async () => {
    const solo = await createTenantFixture(db, "solo");
    try {
      await createShipments(db, solo, [
        { origin: "CNSHA", destination: "ZADUR" },
        { origin: "CNSHA", destination: "ZADUR" },
        { origin: "ZADUR", destination: "ZAJNB" },
      ]);
      // Another tenant moving the same lane must not inflate solo's count.
      await createShipments(db, rival, [
        { origin: "CNSHA", destination: "ZADUR" },
        { origin: "CNSHA", destination: "ZADUR" },
      ]);

      const corridors = await new ShipmentsController(db).corridors(authFor(solo));
      const shanghai = corridors.find((c) => c.origin === "CNSHA" && c.destination === "ZADUR");
      expect(shanghai?.n).toBe(2);
      expect(corridors.reduce((sum, c) => sum + c.n, 0)).toBe(3);
    } finally {
      await dropTenantFixture(db, solo);
    }
  });

  it("does not leak rows to a tenant id that doesn't exist", async () => {
    const ghost = { tenantId: randomUUID(), userId: "nobody", roles: ["ops"] };
    const page = await new ShipmentsController(db).list(ghost);
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});
