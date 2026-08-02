/**
 * Consignment arithmetic: what a carrier actually bills for.
 *
 * Freight is not sold by weight. It is sold by *chargeable* weight — the
 * greater of what the goods weigh and what the space they occupy is deemed to
 * weigh. A pallet of pillows and a pallet of steel plate take the same slot on
 * the deck, and the carrier will not carry the pillows for the price of their
 * mass. Getting this wrong is not a rounding error: on low-density freight the
 * volumetric figure is routinely three or four times the actual weight, so a
 * quote priced on gross weight loses money on every single shipment.
 *
 * Integer grams and cubic centimetres throughout, for the same reason money is
 * integer cents — a float in a chargeable-weight calculation is a dispute with
 * a carrier's invoice waiting to happen.
 */

export type TransportMode = "OCEAN" | "AIR" | "ROAD" | "RAIL";

/**
 * Volumetric divisors, in cm³ per kilogram, as the industry states them.
 *
 * - Air: IATA's 6000 cm³/kg — one cubic metre is deemed 166.67 kg.
 * - Ocean LCL: the freight tonne, 1 m³ = 1000 kg.
 * - Road: 1 m³ ≈ 333 kg is the common Southern African groupage convention.
 * - Rail: follows road for containerised groupage.
 *
 * A carrier contract can and does override these; that is why the divisor is
 * a parameter of the calculation rather than a constant buried inside it.
 */
export const VOLUMETRIC_DIVISOR_CM3_PER_KG: Record<TransportMode, number> = {
  AIR: 6000,
  OCEAN: 1000,
  ROAD: 3000,
  RAIL: 3000,
};

/**
 * One line of a packing list.
 *
 * Note the asymmetry, which is the industry's and not ours: a packing list
 * reads "10 CTNS, 40 × 60 × 40 cm, 250 KGS" — the dimensions are **per piece**
 * and the weight is the **line total**. Reading either one the other way is a
 * ten-fold error in a price, so it is stated here rather than left to be
 * inferred from a column name.
 */
export interface CargoItemInput {
  pieces: number;
  /** Gross weight of the whole line, not of one piece. */
  grossWeightGrams: number;
  /** Dimensions of a single piece. All three are needed before volume means anything. */
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
}

export interface ConsignmentTotals {
  pieces: number;
  grossWeightGrams: number;
  volumeCm3: number;
  volumetricWeightGrams: number;
  chargeableWeightGrams: number;
  /** True when volume, not mass, is what the customer is paying for. */
  volumetricApplies: boolean;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Volume of one line, in cm³. Returns 0 unless all three dimensions are
 * present: two out of three is not a box, and guessing the third would put an
 * invented number into a price.
 */
export function itemVolumeCm3(item: CargoItemInput): number {
  const { lengthMm, widthMm, heightMm, pieces } = item;
  if (!lengthMm || !widthMm || !heightMm) return 0;
  // mm³ → cm³ is a factor of 1000; do the division once, at the end, so the
  // intermediate stays an exact integer.
  return roundHalfUp((lengthMm * widthMm * heightMm * pieces) / 1000);
}

export class CargoMeasurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CargoMeasurementError";
  }
}

/**
 * Roll a packing list up into the figures a rate is applied to.
 *
 * @param divisorOverride cm³ per kg from a carrier contract, when it differs
 *   from the mode's convention.
 */
export function computeConsignmentTotals(
  items: CargoItemInput[],
  mode: TransportMode,
  divisorOverride?: number,
): ConsignmentTotals {
  if (items.length === 0) {
    throw new CargoMeasurementError("A consignment needs at least one cargo item");
  }
  for (const [i, item] of items.entries()) {
    if (!Number.isInteger(item.pieces) || item.pieces < 1) {
      throw new CargoMeasurementError(`Item ${i + 1}: pieces must be a positive whole number`);
    }
    if (!Number.isInteger(item.grossWeightGrams) || item.grossWeightGrams < 1) {
      throw new CargoMeasurementError(`Item ${i + 1}: gross weight must be greater than zero`);
    }
  }

  const divisor = divisorOverride ?? VOLUMETRIC_DIVISOR_CM3_PER_KG[mode];
  if (!divisor || divisor <= 0) {
    throw new CargoMeasurementError("Volumetric divisor must be greater than zero");
  }

  const pieces = items.reduce((n, i) => n + i.pieces, 0);
  const grossWeightGrams = items.reduce((n, i) => n + i.grossWeightGrams, 0);
  const volumeCm3 = items.reduce((n, i) => n + itemVolumeCm3(i), 0);

  // cm³ / (cm³ per kg) = kg, and grams is that times 1000.
  const volumetricWeightGrams = roundHalfUp((volumeCm3 / divisor) * 1000);
  const chargeableWeightGrams = Math.max(grossWeightGrams, volumetricWeightGrams);

  return {
    pieces,
    grossWeightGrams,
    volumeCm3,
    volumetricWeightGrams,
    chargeableWeightGrams,
    volumetricApplies: volumetricWeightGrams > grossWeightGrams,
  };
}

// ---------------------------------------------------------------------------
// Handling that changes the price
// ---------------------------------------------------------------------------

export type CargoType =
  | "GENERAL"
  | "HAZARDOUS"
  | "REEFER"
  | "PERISHABLE"
  | "OVERSIZED"
  | "VALUABLE"
  | "LIVE_ANIMALS";

export type Urgency = "ECONOMY" | "STANDARD" | "EXPRESS" | "CRITICAL";

/**
 * Handling uplift on the freight buy, in basis points.
 *
 * These are the operator's defaults, applied when a rate card carries no
 * explicit surcharge for the cargo type. Real numbers from real tariffs:
 * dangerous goods carry a declaration, segregation and often a dedicated slot;
 * a reefer draws power and is monitored; live animals need an attendant.
 */
export const CARGO_TYPE_UPLIFT_BPS: Record<CargoType, number> = {
  GENERAL: 0,
  HAZARDOUS: 3500,
  REEFER: 2500,
  PERISHABLE: 1200,
  OVERSIZED: 4000,
  VALUABLE: 1500,
  LIVE_ANIMALS: 5000,
};

/**
 * Service uplift and the transit ceiling each level implies.
 *
 * The ceiling is the point of this: quoting a 34-day sailing against a request
 * marked EXPRESS is selling the customer something they did not ask for, and
 * the engine refuses rather than silently returning it.
 */
export const URGENCY_PROFILE: Record<
  Urgency,
  { upliftBps: number; maxTransitDays: number | null; label: string }
> = {
  ECONOMY: { upliftBps: 0, maxTransitDays: null, label: "Economy — cheapest routing" },
  STANDARD: { upliftBps: 0, maxTransitDays: null, label: "Standard — best value" },
  EXPRESS: { upliftBps: 1800, maxTransitDays: 21, label: "Express — priority space" },
  CRITICAL: { upliftBps: 4500, maxTransitDays: 10, label: "Critical — first available" },
};

export interface HandlingRequirement {
  code: string;
  description: string;
  /** Blocking requirements stop a booking; advisory ones are shown and logged. */
  blocking: boolean;
}

export interface ConsignmentCompliance {
  cargoType: CargoType;
  unNumber?: string | null;
  imoClass?: string | null;
  packingGroup?: string | null;
  tempMinDeciC?: number | null;
  tempMaxDeciC?: number | null;
}

/**
 * What this cargo needs before it can be booked.
 *
 * Declaring dangerous goods without a UN number is the single most common way
 * a container is rejected at the terminal gate, so the check is blocking and
 * happens at quote time — the cheapest possible moment to find out.
 */
export function handlingRequirements(c: ConsignmentCompliance): HandlingRequirement[] {
  const out: HandlingRequirement[] = [];

  if (c.cargoType === "HAZARDOUS") {
    const missing = [
      !c.unNumber && "UN number",
      !c.imoClass && "IMO class",
      !c.packingGroup && "packing group",
    ].filter(Boolean);
    out.push({
      code: "DG_DECLARATION",
      description: missing.length
        ? `Dangerous goods declaration is incomplete — missing ${missing.join(", ")}.`
        : `Dangerous goods declaration required (UN ${c.unNumber}, IMO class ${c.imoClass}, PG ${c.packingGroup}).`,
      blocking: missing.length > 0,
    });
    out.push({
      code: "DG_SEGREGATION",
      description: "Terminal segregation and a booked DG slot are required.",
      blocking: false,
    });
  }

  if (c.cargoType === "REEFER" || c.cargoType === "PERISHABLE") {
    const hasRange = c.tempMinDeciC != null && c.tempMaxDeciC != null;
    out.push({
      code: "TEMP_SETPOINT",
      description: hasRange
        ? `Maintain ${(c.tempMinDeciC! / 10).toFixed(1)}°C to ${(c.tempMaxDeciC! / 10).toFixed(1)}°C in transit.`
        : "A temperature range is required before reefer equipment can be booked.",
      blocking: c.cargoType === "REEFER" && !hasRange,
    });
    if (hasRange && c.tempMinDeciC! > c.tempMaxDeciC!) {
      out.push({
        code: "TEMP_RANGE",
        description: "The minimum temperature is above the maximum.",
        blocking: true,
      });
    }
  }

  if (c.cargoType === "OVERSIZED") {
    out.push({
      code: "OOG_SURVEY",
      description: "Out-of-gauge cargo needs a lashing survey and a flat-rack booking.",
      blocking: false,
    });
  }
  if (c.cargoType === "VALUABLE") {
    out.push({
      code: "HIGH_VALUE",
      description: "Declare value to the carrier and confirm all-risk cover before departure.",
      blocking: false,
    });
  }
  if (c.cargoType === "LIVE_ANIMALS") {
    out.push({
      code: "LIVE_ANIMALS",
      description: "Veterinary certificate and an attendant are required for carriage.",
      blocking: false,
    });
  }

  return out;
}

/** Requirements that must be resolved before a booking may be made. */
export function blockingRequirements(c: ConsignmentCompliance): HandlingRequirement[] {
  return handlingRequirements(c).filter((r) => r.blocking);
}
