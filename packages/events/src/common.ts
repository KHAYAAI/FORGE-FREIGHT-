import { z } from "zod";

/** All money is integer minor units (cents) + ISO 4217 currency. ZAR-first. */
export const Money = z.object({
  amountCents: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

/** UN/LOCODE, e.g. CNSHA, ZADUR, ZAJNB, DEHAM. */
export const Unlocode = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/);

export const TransportMode = z.enum(["OCEAN", "AIR", "ROAD", "RAIL"]);
export type TransportMode = z.infer<typeof TransportMode>;

export const ContainerType = z.enum([
  "20GP",
  "40GP",
  "40HC",
  "45HC",
  "20RF",
  "40RF",
  "LCL",
]);
export type ContainerType = z.infer<typeof ContainerType>;

export const Incoterm = z.enum([
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);
export type Incoterm = z.infer<typeof Incoterm>;

/** ISO 6346 container number, e.g. MSKU1234565. Checksum not enforced here. */
export const ContainerNumber = z.string().regex(/^[A-Z]{4}\d{7}$/);

/** IMO vessel number. */
export const ImoNumber = z.string().regex(/^\d{7}$/);
