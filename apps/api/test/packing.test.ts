import { describe, expect, it } from "vitest";
import {
  CARGO_TYPE_UPLIFT_BPS,
  CargoMeasurementError,
  URGENCY_PROFILE,
  blockingRequirements,
  computeConsignmentTotals,
  handlingRequirements,
  itemVolumeCm3,
} from "../src/modules/consignments/packing.js";

/**
 * A standard 1.2 × 1.0 m pallet, 1.5 m high. `kg` is the line total, matching
 * how a packing list is actually written — dimensions per piece, weight for
 * the line.
 */
const pallet = (pieces: number, kg: number) => ({
  pieces,
  grossWeightGrams: kg * 1000,
  lengthMm: 1200,
  widthMm: 1000,
  heightMm: 1500,
});

describe("volume", () => {
  it("measures a pallet in cubic centimetres", () => {
    // 1.2 × 1.0 × 1.5 m = 1.8 m³ = 1,800,000 cm³
    expect(itemVolumeCm3(pallet(1, 300))).toBe(1_800_000);
  });

  it("scales by the piece count", () => {
    expect(itemVolumeCm3(pallet(4, 300))).toBe(7_200_000);
  });

  it("refuses to guess a missing dimension", () => {
    // Two out of three is not a box, and inventing the third would put a made
    // up number straight into a price.
    expect(itemVolumeCm3({ pieces: 1, grossWeightGrams: 1000, lengthMm: 1200, widthMm: 1000 })).toBe(0);
    expect(itemVolumeCm3({ pieces: 1, grossWeightGrams: 1000 })).toBe(0);
  });
});

describe("chargeable weight", () => {
  it("bills dense freight on its actual weight", () => {
    // 1.8 m³ of steel plate at 2,500 kg. Ocean deems the space 1,800 kg, so
    // the mass wins and the customer pays for what it weighs.
    const t = computeConsignmentTotals([pallet(1, 2500)], "OCEAN");
    expect(t.grossWeightGrams).toBe(2_500_000);
    expect(t.volumetricWeightGrams).toBe(1_800_000);
    expect(t.chargeableWeightGrams).toBe(2_500_000);
    expect(t.volumetricApplies).toBe(false);
  });

  it("bills light bulky freight on its volume", () => {
    // A pallet of pillows: 1.8 m³, 120 kg. Ocean deems it 1800 kg, and the
    // carrier will not move the slot for the price of the mass.
    const t = computeConsignmentTotals([pallet(1, 120)], "OCEAN");
    expect(t.volumetricWeightGrams).toBe(1_800_000);
    expect(t.chargeableWeightGrams).toBe(1_800_000);
    expect(t.volumetricApplies).toBe(true);
  });

  it("applies IATA's 6000 divisor for air", () => {
    // 1,800,000 cm³ / 6000 = 300 kg
    const t = computeConsignmentTotals([pallet(1, 120)], "AIR");
    expect(t.volumetricWeightGrams).toBe(300_000);
    expect(t.chargeableWeightGrams).toBe(300_000);
  });

  it("honours a carrier's contractual divisor over the mode default", () => {
    const t = computeConsignmentTotals([pallet(1, 120)], "AIR", 5000);
    expect(t.volumetricWeightGrams).toBe(360_000);
  });

  it("sums a mixed packing list", () => {
    // Weights are line totals; dimensions are per piece. 2 pallets at 400 kg
    // for the line, plus 10 cartons at 25 kg for the line.
    const t = computeConsignmentTotals(
      [pallet(2, 400), { pieces: 10, grossWeightGrams: 25_000, lengthMm: 600, widthMm: 400, heightMm: 400 }],
      "OCEAN",
    );
    expect(t.pieces).toBe(12);
    expect(t.grossWeightGrams).toBe(400_000 + 25_000);
    // 2 pallets × 1,800,000 cm³ = 3,600,000; 10 cartons × 96,000 = 960,000
    expect(t.volumeCm3).toBe(4_560_000);
    // Volume dominates by a long way on this load.
    expect(t.chargeableWeightGrams).toBe(4_560_000);
  });

  it("falls back to gross weight when nothing was measured", () => {
    // Unmeasured cargo is not free cargo — it is billed on what it weighs
    // until someone puts a tape measure on it.
    const t = computeConsignmentTotals([{ pieces: 3, grossWeightGrams: 500_000 }], "OCEAN");
    expect(t.volumeCm3).toBe(0);
    expect(t.chargeableWeightGrams).toBe(500_000);
  });

  it("rejects an empty or nonsensical packing list", () => {
    expect(() => computeConsignmentTotals([], "OCEAN")).toThrow(CargoMeasurementError);
    expect(() => computeConsignmentTotals([{ pieces: 0, grossWeightGrams: 100 }], "OCEAN")).toThrow(
      /pieces/,
    );
    expect(() => computeConsignmentTotals([{ pieces: 1, grossWeightGrams: 0 }], "OCEAN")).toThrow(
      /gross weight/,
    );
  });

  it("keeps every figure an integer", () => {
    const t = computeConsignmentTotals(
      [{ pieces: 7, grossWeightGrams: 33_333, lengthMm: 333, widthMm: 333, heightMm: 333 }],
      "AIR",
    );
    for (const v of [t.pieces, t.grossWeightGrams, t.volumeCm3, t.volumetricWeightGrams, t.chargeableWeightGrams]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("handling requirements", () => {
  it("blocks dangerous goods with an incomplete declaration", () => {
    // The most common reason a box is turned away at the terminal gate, so it
    // is caught at quote time rather than at the port.
    const reqs = blockingRequirements({ cargoType: "HAZARDOUS", unNumber: "UN1263" });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.description).toMatch(/IMO class, packing group/);
  });

  it("passes a complete dangerous goods declaration", () => {
    expect(
      blockingRequirements({
        cargoType: "HAZARDOUS",
        unNumber: "UN1263",
        imoClass: "3",
        packingGroup: "III",
      }),
    ).toEqual([]);
  });

  it("still advises on segregation once the declaration is complete", () => {
    const all = handlingRequirements({
      cargoType: "HAZARDOUS",
      unNumber: "UN1263",
      imoClass: "3",
      packingGroup: "III",
    });
    expect(all.map((r) => r.code)).toContain("DG_SEGREGATION");
  });

  it("blocks reefer cargo with no temperature range", () => {
    expect(blockingRequirements({ cargoType: "REEFER" })).toHaveLength(1);
    expect(
      blockingRequirements({ cargoType: "REEFER", tempMinDeciC: -180, tempMaxDeciC: -160 }),
    ).toEqual([]);
  });

  it("catches an inverted temperature range", () => {
    const reqs = blockingRequirements({ cargoType: "REEFER", tempMinDeciC: 50, tempMaxDeciC: -180 });
    expect(reqs.map((r) => r.code)).toContain("TEMP_RANGE");
  });

  it("advises but does not block perishables without a setpoint", () => {
    // Perishable is not necessarily reefer — a shipper may accept ambient.
    expect(blockingRequirements({ cargoType: "PERISHABLE" })).toEqual([]);
    expect(handlingRequirements({ cargoType: "PERISHABLE" })).toHaveLength(1);
  });

  it("asks nothing of general cargo", () => {
    expect(handlingRequirements({ cargoType: "GENERAL" })).toEqual([]);
  });
});

describe("commercial profiles", () => {
  it("prices handling above general cargo for everything that needs it", () => {
    expect(CARGO_TYPE_UPLIFT_BPS.GENERAL).toBe(0);
    for (const t of ["HAZARDOUS", "REEFER", "OVERSIZED", "LIVE_ANIMALS"] as const) {
      expect(CARGO_TYPE_UPLIFT_BPS[t]).toBeGreaterThan(0);
    }
  });

  it("makes faster service cost more and cap transit", () => {
    expect(URGENCY_PROFILE.STANDARD.upliftBps).toBe(0);
    expect(URGENCY_PROFILE.EXPRESS.upliftBps).toBeGreaterThan(0);
    expect(URGENCY_PROFILE.CRITICAL.upliftBps).toBeGreaterThan(URGENCY_PROFILE.EXPRESS.upliftBps);
    expect(URGENCY_PROFILE.CRITICAL.maxTransitDays!).toBeLessThan(
      URGENCY_PROFILE.EXPRESS.maxTransitDays!,
    );
    expect(URGENCY_PROFILE.ECONOMY.maxTransitDays).toBeNull();
  });
});
