import { z } from "zod";

/** UN/LOCODE, normalised on the way in — the lane match is string equality. */
const Locode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, "Must be a 5-character UN/LOCODE, e.g. ZADUR");

export const PackageTypeEnum = z.enum([
  "PALLET",
  "CARTON",
  "CRATE",
  "DRUM",
  "BAG",
  "BALE",
  "ROLL",
  "IBC",
  "BULK",
  "LOOSE",
]);

export const CargoTypeEnum = z.enum([
  "GENERAL",
  "HAZARDOUS",
  "REEFER",
  "PERISHABLE",
  "OVERSIZED",
  "VALUABLE",
  "LIVE_ANIMALS",
]);

export const UrgencyEnum = z.enum(["ECONOMY", "STANDARD", "EXPRESS", "CRITICAL"]);

/**
 * A packing-list line.
 *
 * Weight is entered in grams and dimensions in millimetres so nothing in this
 * path is ever a float. The console converts from kilograms and centimetres,
 * which is what a shipper actually reads off a packing list.
 */
export const CargoItemDto = z.object({
  description: z.string().trim().min(1).max(300),
  packageType: PackageTypeEnum,
  pieces: z.number().int().min(1).max(100_000),
  /** Gross weight of the whole line, not one piece — see `packing.ts`. */
  grossWeightGrams: z.number().int().min(1).max(50_000_000_000),
  lengthMm: z.number().int().min(1).max(30_000).nullish(),
  widthMm: z.number().int().min(1).max(30_000).nullish(),
  heightMm: z.number().int().min(1).max(30_000).nullish(),
  stackable: z.boolean().default(true),
  marksAndNumbers: z.string().trim().max(200).nullish(),
  hsCode: z.string().trim().max(20).nullish(),
});

const consignmentShape = {
  description: z.string().trim().min(1).max(500),
  cargoType: CargoTypeEnum.default("GENERAL"),
  urgency: UrgencyEnum.default("STANDARD"),

  pickupLocode: Locode.nullish(),
  pickupAddress: z.string().trim().max(500).nullish(),
  pickupContact: z.string().trim().max(200).nullish(),
  pickupFrom: z.coerce.date().nullish(),
  pickupTo: z.coerce.date().nullish(),

  portOfExit: Locode,
  portOfEntry: Locode,

  unNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^UN\d{4}$/, "A UN number looks like UN1263")
    .nullish(),
  imoClass: z
    .string()
    .trim()
    .regex(/^[1-9](\.[1-6])?$/, "An IMO class looks like 3 or 5.1")
    .nullish(),
  packingGroup: z.enum(["I", "II", "III"]).nullish(),

  /** Tenths of a degree Celsius: −25.0 °C is −250. Reefer setpoints are not integers. */
  tempMinDeciC: z.number().int().min(-600).max(600).nullish(),
  tempMaxDeciC: z.number().int().min(-600).max(600).nullish(),
};

export const CreateConsignmentDto = z
  .object({
    ...consignmentShape,
    items: z.array(CargoItemDto).min(1).max(200),
  })
  .refine((v) => v.portOfExit !== v.portOfEntry, {
    message: "The port of exit and the port of entry must differ",
    path: ["portOfEntry"],
  })
  .refine((v) => !v.pickupFrom || !v.pickupTo || v.pickupFrom <= v.pickupTo, {
    message: "The collection window starts after it ends",
    path: ["pickupTo"],
  })
  .refine(
    (v) => v.tempMinDeciC == null || v.tempMaxDeciC == null || v.tempMinDeciC <= v.tempMaxDeciC,
    { message: "The minimum temperature is above the maximum", path: ["tempMaxDeciC"] },
  );

export const UpdateConsignmentDto = z
  .object(consignmentShape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateConsignment = z.infer<typeof CreateConsignmentDto>;
export type UpdateConsignment = z.infer<typeof UpdateConsignmentDto>;
export type CargoItemPayload = z.infer<typeof CargoItemDto>;
