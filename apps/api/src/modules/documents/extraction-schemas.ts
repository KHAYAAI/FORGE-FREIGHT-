// zod/v4 API — required by the Anthropic SDK's zodOutputFormat helper.
import { z } from "zod/v4";

/**
 * Structured-output schemas per document type. Every schema carries a
 * self-reported `confidence` plus per-field nullability — the model must
 * return null for anything it cannot read rather than guessing. Amounts are
 * integer cents, consistent with the rest of the platform.
 */

const MoneyExtract = z.object({
  amountCents: z.number().int().describe("Amount in integer minor units (cents)"),
  currency: z.string().describe("ISO 4217 currency code"),
});

export const CommercialInvoiceExtract = z.object({
  confidence: z
    .number()
    .describe("Your overall confidence in this extraction, 0 to 1"),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable().describe("ISO 8601 date"),
  sellerName: z.string().nullable(),
  buyerName: z.string().nullable(),
  incoterm: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unitPrice: MoneyExtract.nullable(),
      lineTotal: MoneyExtract.nullable(),
      hsCode: z.string().nullable().describe("HS code if printed on the invoice"),
      countryOfOrigin: z.string().nullable(),
    }),
  ),
  invoiceTotal: MoneyExtract.nullable(),
});

export const PackingListExtract = z.object({
  confidence: z.number().describe("Your overall confidence in this extraction, 0 to 1"),
  shipperName: z.string().nullable(),
  consigneeName: z.string().nullable(),
  packages: z.array(
    z.object({
      description: z.string(),
      packageCount: z.number().nullable(),
      packageType: z.string().nullable(),
      grossWeightKg: z.number().nullable(),
      netWeightKg: z.number().nullable(),
      volumeCbm: z.number().nullable(),
    }),
  ),
  totalGrossWeightKg: z.number().nullable(),
  totalPackages: z.number().nullable(),
});

export const BillOfLadingExtract = z.object({
  confidence: z.number().describe("Your overall confidence in this extraction, 0 to 1"),
  blNumber: z.string().nullable(),
  shipperName: z.string().nullable(),
  consigneeName: z.string().nullable(),
  notifyParty: z.string().nullable(),
  vesselName: z.string().nullable(),
  voyageNumber: z.string().nullable(),
  portOfLoading: z.string().nullable().describe("UN/LOCODE if determinable"),
  portOfDischarge: z.string().nullable().describe("UN/LOCODE if determinable"),
  containers: z.array(
    z.object({
      containerNumber: z.string().nullable().describe("ISO 6346, e.g. MSKU1234565"),
      sealNumber: z.string().nullable(),
      containerType: z.string().nullable(),
    }),
  ),
  onBoardDate: z.string().nullable().describe("ISO 8601 date"),
});

export const EXTRACTION_SCHEMAS = {
  COMMERCIAL_INVOICE: CommercialInvoiceExtract,
  PACKING_LIST: PackingListExtract,
  BL: BillOfLadingExtract,
} as const;

export type ExtractableDocType = keyof typeof EXTRACTION_SCHEMAS;

export function isExtractable(docType: string): docType is ExtractableDocType {
  return docType in EXTRACTION_SCHEMAS;
}
