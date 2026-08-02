import { z } from "zod";
import { CHARGE_CODES } from "./charge-codes.js";

const CATEGORIES = [
  "ORIGIN",
  "FREIGHT",
  "FUEL_SURCHARGE",
  "DESTINATION",
  "CUSTOMS",
  "DUTY_TAX",
  "DOCUMENTATION",
  "DEMURRAGE_DETENTION",
  "INSURANCE",
  "PLATFORM_FEE",
  "OTHER",
] as const;

const PROVENANCES = ["PASS_THROUGH", "MARKED_UP", "FORWARDER_ORIGINATED"] as const;

const BASES = [
  "PER_SHIPMENT",
  "PER_CONTAINER",
  "PER_KG",
  "PER_CBM",
  "PER_DOCUMENT",
  "PER_DAY",
  "PERCENTAGE",
] as const;

/**
 * A company's invoice identity.
 *
 * Everything is optional because onboarding is incremental — a forwarder fills
 * this in over days, not in one form submission — and the completeness check
 * on the profile is what tells them what is still missing. Refusing a partial
 * save would just make people put placeholder text in the VAT number field.
 */
export const BillingProfileDto = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  tradingName: z.string().trim().max(200).nullish(),
  registrationNumber: z.string().trim().max(50).nullish(),
  vatNumber: z.string().trim().max(50).nullish(),
  customsClientNumber: z.string().trim().max(50).nullish(),
  addressLines: z.string().trim().max(500).nullish(),
  country: z.string().trim().toUpperCase().length(2).optional(),
  email: z.string().trim().email().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  logoUrl: z.string().trim().max(200_000).nullish(),
  bankName: z.string().trim().max(120).nullish(),
  bankAccountName: z.string().trim().max(200).nullish(),
  bankAccountNumber: z.string().trim().max(60).nullish(),
  bankBranchCode: z.string().trim().max(30).nullish(),
  bankSwift: z.string().trim().max(20).nullish(),
  /**
   * Constrained to letters and digits: it goes into the invoice number, and a
   * prefix containing a hyphen or a slash makes the series unparseable by the
   * customer's AP system and by anyone reconciling it later.
   */
  invoiceNumberPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultCurrency: z.string().trim().toUpperCase().length(3).optional(),
  vatBps: z.number().int().min(0).max(5000).optional(),
  invoiceFooter: z.string().trim().max(2000).nullish(),
});

/**
 * A charge line, in full.
 *
 * `category`, `provenance` and `basis` are required rather than defaulted:
 * every one of them changes what the audit is able to check, and a line that
 * silently defaults to "other, forwarder-originated, per shipment" is a line
 * the audit will pass because it has been told there is nothing to compare.
 */
export const ChargeLineDto = z
  .object({
    chargeCode: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(300),
    kind: z.enum(["FREIGHT", "SURCHARGE", "DISBURSEMENT", "FEE"]),
    category: z.enum(CATEGORIES),
    provenance: z.enum(PROVENANCES),
    basis: z.enum(BASES),
    quantity: z.number().int().positive().max(100_000),
    unitSellCents: z.number().int(),
    buyCents: z.number().int().nullish(),
    currency: z.string().trim().toUpperCase().length(3),
    vatBps: z.number().int().min(0).max(5000).default(0),
    vendorPartyId: z.string().uuid().nullish(),
    vendorInvoiceRef: z.string().trim().max(100).nullish(),
    contractRef: z.string().trim().max(100).nullish(),
  })
  .superRefine((line, ctx) => {
    // A pass-through line billed above its own cost is not a pricing decision,
    // it is a line mislabelled. Refused at the door rather than left for the
    // audit to find after the invoice has gone out.
    if (line.provenance === "PASS_THROUGH" && line.buyCents != null) {
      if (line.unitSellCents * line.quantity > line.buyCents) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A pass-through disbursement is billed at cost. Either remove the margin or record this line as MARKED_UP.",
          path: ["provenance"],
        });
      }
    }
    if (line.provenance !== "FORWARDER_ORIGINATED" && line.buyCents == null && !line.vendorInvoiceRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A third-party line needs either the cost or the vendor's invoice reference, or there is nothing to match it against.",
        path: ["buyCents"],
      });
    }
  });

export const IssueInvoiceDto = z.object({
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  transportDocumentRef: z.string().trim().max(60).nullish(),
  customerReference: z.string().trim().max(100).nullish(),
});

export const ChargeCodeAliasDto = z.object({
  alias: z.string().trim().min(1).max(80),
  canonicalCode: z.enum(CHARGE_CODES.map((c) => c.code) as [string, ...string[]]),
  vendorPartyId: z.string().uuid().nullish(),
});

export const ResolveExceptionDto = z.object({
  status: z.enum(["ACCEPTED", "DISPUTED", "RESOLVED"]),
  note: z.string().trim().max(1000).nullish(),
});
