import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cargoItems, consignments, tenants, type Db } from "@forge-freight/db";
import { ConsignmentsController } from "../src/modules/consignments/consignments.controller.js";
import { ConsignmentsService } from "../src/modules/consignments/consignments.service.js";
import { createTenantFixture, dropTenantFixture, testDb, type Fixture } from "./harness.js";

/**
 * The consignment is what everything downstream is computed from — chargeable
 * weight sets the price, the DG declaration decides whether the box may move
 * at all. These run against a real database because the totals are stored, and
 * a stored total that disagrees with its own packing list is the failure mode
 * worth catching.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;
let customerTenantId: string;
let controller: ConsignmentsController;

const auth = (tenantId: string) => ({ tenantId, userId: "consignment-test", roles: ["ops"] });

const palletItem = (over: Partial<Record<string, unknown>> = {}) => ({
  description: "Cotton knitted T-shirts, printed",
  packageType: "PALLET" as const,
  pieces: 4,
  grossWeightGrams: 480_000,
  lengthMm: 1200,
  widthMm: 1000,
  heightMm: 1500,
  stackable: true,
  ...over,
});

const base = (over: Partial<Record<string, unknown>> = {}) => ({
  description: "Apparel for retail distribution",
  cargoType: "GENERAL" as const,
  urgency: "STANDARD" as const,
  portOfExit: "ZADUR",
  portOfEntry: "NLRTM",
  items: [palletItem()],
  ...over,
});

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "cons-acme");
  rival = await createTenantFixture(db, "cons-rival");
  const [c] = await db
    .insert(tenants)
    .values({ id: randomUUID(), type: "CUSTOMER", name: `test-cons-cust-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenants.id });
  customerTenantId = c!.id;
  controller = new ConsignmentsController(db, new ConsignmentsService(db));
});

afterAll(async () => {
  for (const t of [acme.tenantId, rival.tenantId]) {
    const rows = await db.select({ id: consignments.id }).from(consignments).where(eq(consignments.tenantId, t));
    for (const r of rows) await db.delete(cargoItems).where(eq(cargoItems.consignmentId, r.id));
    await db.delete(consignments).where(eq(consignments.tenantId, t));
  }
  await db.delete(tenants).where(eq(tenants.id, customerTenantId));
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("capturing a consignment", () => {
  it("stores the packing list and rolls it up", async () => {
    const c = await controller.create(base(), auth(acme.tenantId), "OCEAN");
    expect(c.items).toHaveLength(1);
    expect(c.pieces).toBe(4);
    expect(c.grossWeightGrams).toBe(480_000);
    // 4 pallets × 1.8 m³ = 7.2 m³; ocean deems that 7,200 kg.
    expect(c.volumeCm3).toBe(7_200_000);
    expect(c.chargeableWeightGrams).toBe(7_200_000);
    expect(c.volumetricApplies).toBe(true);
  });

  it("bills dense cargo on its mass instead", async () => {
    const c = await controller.create(
      base({ items: [palletItem({ grossWeightGrams: 9_000_000 })] }),
      auth(acme.tenantId),
      "OCEAN",
    );
    expect(c.chargeableWeightGrams).toBe(9_000_000);
    expect(c.volumetricApplies).toBe(false);
  });

  it("uses the air divisor when the quote is by air", async () => {
    const c = await controller.create(base(), auth(acme.tenantId), "AIR");
    // 7,200,000 cm³ / 6000 = 1200 kg
    expect(c.chargeableWeightGrams).toBe(1_200_000);
  });

  it("normalises the LOCODEs so the lane will actually match a rate", async () => {
    const c = await controller.create(
      base({ portOfExit: " zacpt ", portOfEntry: "brssz" }),
      auth(acme.tenantId),
      "OCEAN",
    );
    expect(c.portOfExit).toBe("ZACPT");
    expect(c.portOfEntry).toBe("BRSSZ");
  });

  it("records where the goods are collected, separately from the port", async () => {
    // Door collection and the port of exit are different places; a forwarder
    // that conflates them sends a truck to the wrong address.
    const c = await controller.create(
      base({
        pickupLocode: "ZAJNB",
        pickupAddress: "Unit 4, Isando Industrial Park, Kempton Park",
        pickupContact: "Sipho Ndlovu +27 82 555 0134",
      }),
      auth(acme.tenantId),
      "OCEAN",
    );
    expect(c.pickupLocode).toBe("ZAJNB");
    expect(c.portOfExit).toBe("ZADUR");
    expect(c.pickupAddress).toContain("Isando");
  });
});

describe("cargo that cannot simply be booked", () => {
  it("refuses dangerous goods with an incomplete declaration", async () => {
    await expect(
      controller.create(
        base({ cargoType: "HAZARDOUS", unNumber: "UN1263" }),
        auth(acme.tenantId),
        "OCEAN",
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("accepts a complete one and carries the declaration", async () => {
    const c = await controller.create(
      base({ cargoType: "HAZARDOUS", unNumber: "un1263", imoClass: "3", packingGroup: "III" }),
      auth(acme.tenantId),
      "OCEAN",
    );
    expect(c.unNumber).toBe("UN1263");
    expect(c.requirements.map((r) => r.code)).toContain("DG_SEGREGATION");
    expect(c.requirements.every((r) => !r.blocking)).toBe(true);
  });

  it("refuses reefer cargo with no temperature range", async () => {
    await expect(
      controller.create(base({ cargoType: "REEFER" }), auth(acme.tenantId), "OCEAN"),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("accepts a reefer setpoint and reports it back", async () => {
    const c = await controller.create(
      base({ cargoType: "REEFER", tempMinDeciC: -180, tempMaxDeciC: -160 }),
      auth(acme.tenantId),
      "OCEAN",
    );
    expect(c.requirements.find((r) => r.code === "TEMP_SETPOINT")!.description).toMatch(/-18.0°C/);
  });

  it("rejects a consignment with no cargo on it", async () => {
    await expect(
      controller.create(base({ items: [] }), auth(acme.tenantId), "OCEAN"),
    ).rejects.toThrow();
  });

  it("rejects a lane that starts where it ends", async () => {
    await expect(
      controller.create(base({ portOfEntry: "ZADUR" }), auth(acme.tenantId), "OCEAN"),
    ).rejects.toThrow();
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's consignment behind a 404", async () => {
    const c = await controller.create(base(), auth(acme.tenantId), "OCEAN");
    await expect(controller.get(c.id, auth(rival.tenantId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.update(c.id, { description: "hijacked" }, auth(rival.tenantId)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await controller.get(c.id, auth(acme.tenantId))).description).not.toBe("hijacked");
  });

  it("never lists another tenant's consignments", async () => {
    const mine = await controller.list(auth(rival.tenantId));
    expect(mine.every((c) => c.tenantId === rival.tenantId)).toBe(true);
  });

  it("refuses a customer tenant outright", async () => {
    await expect(controller.list(auth(customerTenantId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("correcting a consignment", () => {
  it("cannot be edited into an invalid dangerous goods declaration", async () => {
    // A partial update leaves the untouched fields alone, so switching the
    // cargo type without supplying a declaration has to be caught against the
    // merged row rather than against the body.
    const c = await controller.create(base(), auth(acme.tenantId), "OCEAN");
    await expect(
      controller.update(c.id, { cargoType: "HAZARDOUS" }, auth(acme.tenantId)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("keeps the stored totals when descriptive fields change", async () => {
    // The price the customer accepted has to stay explicable from the numbers
    // it was actually computed on.
    const c = await controller.create(base(), auth(acme.tenantId), "OCEAN");
    const after = await controller.update(
      c.id,
      { description: "Apparel — corrected description", urgency: "EXPRESS" },
      auth(acme.tenantId),
    );
    expect(after.chargeableWeightGrams).toBe(c.chargeableWeightGrams);
    expect(after.urgency).toBe("EXPRESS");
  });
});

describe("measure without saving", () => {
  it("prices the packing list before anything is committed", async () => {
    // The console calls this as the form is typed into, so a shipper watches
    // the chargeable weight overtake the actual weight in real time.
    const m = controller.measure({ ...base(), mode: "OCEAN" });
    expect(m.chargeableWeightGrams).toBe(7_200_000);
    expect(m.volumetricApplies).toBe(true);
    const none = await controller.list(auth(acme.tenantId));
    expect(none.every((c) => c.description !== "MEASURED_ONLY")).toBe(true);
  });

  it("reports what would block a booking without refusing the measurement", () => {
    const m = controller.measure({ ...base({ cargoType: "HAZARDOUS" }), mode: "OCEAN" });
    expect(m.requirements.some((r) => r.blocking)).toBe(true);
  });
});
