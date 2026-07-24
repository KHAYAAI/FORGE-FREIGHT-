import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events, shipments, type Db } from "@forge-freight/db";
import { makeEvent, ShipmentBooked, VesselPositionReported } from "@forge-freight/events";
import { appendEvent, appendEventIdempotent } from "../src/modules/db/event-store.js";
import {
  createShipments,
  createTenantFixture,
  dropTenantFixture,
  testDb,
  type Fixture,
} from "./harness.js";

/**
 * The event log is the system of record, and two of its guarantees live in the
 * database rather than in application code: an event is written in the same
 * transaction as the projection it describes, and a redelivered external
 * message does not become a second event. Neither can be verified without a
 * real Postgres — the first depends on transaction semantics, the second on a
 * partial unique index.
 */

let db: Db;
let fixture: Fixture;
let shipmentId: string;

beforeAll(async () => {
  db = testDb();
  fixture = await createTenantFixture(db, "events");
  [shipmentId] = (await createShipments(db, fixture, [
    { origin: "CNSHA", destination: "ZADUR" },
  ])) as [string];
});

afterAll(async () => {
  await dropTenantFixture(db, fixture);
});

function booked() {
  return makeEvent({
    definition: ShipmentBooked,
    tenantId: fixture.tenantId,
    shipmentId,
    actor: { kind: "USER", id: "test", tenantId: fixture.tenantId },
    payload: {
      bookingId: fixture.bookingId,
      quoteId: null,
      customerId: fixture.customerId,
      origin: "CNSHA",
      destination: "ZADUR",
      mode: "OCEAN",
      incoterm: "CIF",
      containers: [{ containerType: "40HC", quantity: 1 }],
      carrierBookingRef: null,
    },
  });
}

async function countEvents(type: string) {
  const rows = await db
    .select({ id: events.eventId })
    .from(events)
    .where(and(eq(events.tenantId, fixture.tenantId), eq(events.type, type)));
  return rows.length;
}

describe("event store", () => {
  it("rolls the event back with the projection it was written alongside", async () => {
    const before = await countEvents(ShipmentBooked.type);

    await expect(
      db.transaction(async (tx) => {
        await appendEvent(tx, booked());
        await tx
          .update(shipments)
          .set({ status: "IN_TRANSIT" })
          .where(eq(shipments.id, shipmentId));
        throw new Error("simulated failure after both writes");
      }),
    ).rejects.toThrow("simulated failure");

    // Neither half may survive: an event describing a state change that never
    // happened is worse than no event, because consumers act on it.
    expect(await countEvents(ShipmentBooked.type)).toBe(before);
    const [row] = await db
      .select({ status: shipments.status })
      .from(shipments)
      .where(eq(shipments.id, shipmentId));
    expect(row!.status).toBe("BOOKED");
  });

  it("commits the event and the projection together on success", async () => {
    const before = await countEvents(ShipmentBooked.type);

    await db.transaction(async (tx) => {
      await appendEvent(tx, booked());
      await tx.update(shipments).set({ status: "IN_TRANSIT" }).where(eq(shipments.id, shipmentId));
    });

    expect(await countEvents(ShipmentBooked.type)).toBe(before + 1);
    const [row] = await db
      .select({ status: shipments.status })
      .from(shipments)
      .where(eq(shipments.id, shipmentId));
    expect(row!.status).toBe("IN_TRANSIT");
  });

  it("drops a redelivered external message rather than duplicating history", async () => {
    // Webhooks and EDI feeds redeliver; carriers resend the same position
    // report. The partial unique index on (type, source_ref) is what stops a
    // duplicate delivery becoming a duplicate fact.
    const sourceRef = `carrier-msg-${randomUUID()}`;
    const legId = randomUUID();
    const position = () =>
      makeEvent({
        definition: VesselPositionReported,
        tenantId: fixture.tenantId,
        shipmentId,
        actor: { kind: "ADAPTER", id: "ais", tenantId: fixture.tenantId },
        sourceRef,
        payload: {
          legId,
          vesselImo: "9321483",
          lat: -29.87,
          lon: 31.03,
          speedKnots: 12.4,
          heading: 210,
        },
      });

    expect(await appendEventIdempotent(db, position())).toBe(true);
    expect(await appendEventIdempotent(db, position())).toBe(false);
    expect(await countEvents(VesselPositionReported.type)).toBe(1);
  });
});
