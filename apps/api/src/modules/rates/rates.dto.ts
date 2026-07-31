import { z } from "zod";

/**
 * UN/LOCODE: two-letter country + three-character location, upper case.
 * Normalised rather than merely validated — the quote engine matches lanes by
 * exact string equality, so a card filed as `zadur` would be invisible to
 * every quote for `ZADUR` and look like a missing rate rather than a typo.
 */
const Locode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, "Must be a 5-character UN/LOCODE, e.g. ZADUR");

const Currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 currency code");

const Mode = z.enum(["OCEAN", "AIR", "ROAD", "RAIL"]);
const ContainerType = z.enum(["20GP", "40GP", "40HC", "45HC", "20RF", "40RF", "LCL"]);
const SurchargeBasis = z.enum([
  "PER_CONTAINER",
  "PER_SHIPMENT",
  "PER_BL",
  "PERCENT_OF_FREIGHT",
]);

/**
 * `amountCents` carries basis points when the basis is `PERCENT_OF_FREIGHT` —
 * the column is reused, which is a wart worth guarding rather than hiding. A
 * 15% BAF filed as `1500` is right; filed as `150000` because someone thought
 * in cents it would silently bill 1,500% of freight.
 */
export const SurchargeDto = z
  .object({
    code: z.string().trim().min(1).max(16).toUpperCase(),
    description: z.string().trim().min(1).max(200),
    basis: SurchargeBasis,
    amountCents: z.number().int().min(0),
    currency: Currency,
  })
  .refine((s) => s.basis !== "PERCENT_OF_FREIGHT" || s.amountCents <= 10_000, {
    message: "A PERCENT_OF_FREIGHT surcharge is basis points; 10000 (100%) is the ceiling",
    path: ["amountCents"],
  });

const rateCardShape = {
  kind: z.enum(["CONTRACT", "SPOT"]),
  carrierId: z.string().uuid().nullish(),
  carrierName: z.string().trim().min(1).max(200),
  mode: Mode,
  origin: Locode,
  destination: Locode,
  /** Null means the rate is per shipment rather than per box — road FTL, air. */
  containerType: ContainerType.nullish(),
  buyAmountCents: z.number().int().min(0),
  currency: Currency,
  transitDays: z.number().int().min(0).max(400).nullish(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
};

const validityWindow = <T extends { validFrom?: Date; validTo?: Date }>(v: T) =>
  !v.validFrom || !v.validTo || v.validFrom < v.validTo;

export const CreateRateCardDto = z
  .object({ ...rateCardShape, surcharges: z.array(SurchargeDto).max(50).default([]) })
  .refine((v) => v.origin !== v.destination, {
    message: "Origin and destination must differ",
    path: ["destination"],
  })
  .refine(validityWindow, {
    message: "validFrom must be before validTo",
    path: ["validTo"],
  });

/**
 * Partial by design, but the validity window is checked against the merged
 * result in the service — a PATCH that moves only `validTo` behind an
 * untouched `validFrom` cannot be caught by looking at the body alone.
 */
export const UpdateRateCardDto = z
  .object(rateCardShape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" })
  .refine(validityWindow, { message: "validFrom must be before validTo", path: ["validTo"] });

export const ReplaceSurchargesDto = z.object({
  surcharges: z.array(SurchargeDto).max(50),
});

export const CreateMarginRuleDto = z
  .object({
    /** Null on any dimension is a wildcard; the most specific rule wins. */
    customerId: z.string().uuid().nullish(),
    origin: Locode.nullish(),
    destination: Locode.nullish(),
    mode: Mode.nullish(),
    marginBps: z.number().int().min(0).max(10_000),
    minMarginCents: z.number().int().min(0).default(0),
  })
  .refine((v) => !v.origin || !v.destination || v.origin !== v.destination, {
    message: "Origin and destination must differ",
    path: ["destination"],
  });

export const UpdateMarginRuleDto = CreateMarginRuleDto.innerType()
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateRateCard = z.infer<typeof CreateRateCardDto>;
export type UpdateRateCard = z.infer<typeof UpdateRateCardDto>;
export type Surcharge = z.infer<typeof SurchargeDto>;
export type CreateMarginRule = z.infer<typeof CreateMarginRuleDto>;
export type UpdateMarginRule = z.infer<typeof UpdateMarginRuleDto>;
