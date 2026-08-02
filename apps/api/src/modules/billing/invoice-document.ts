import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CHARGE_CODE_BY_CODE,
  type ChargeBasis,
  type ChargeCategory,
  type ChargeProvenance,
} from "./charge-codes.js";

/**
 * Assembling the standardised freight-forwarder invoice.
 *
 * The document this produces is deliberately more than a total and a due date.
 * A forwarder invoice is a *consolidated multi-party billing document*: it
 * carries what the carrier charged, what the terminal charged, what the
 * authority took, and what the forwarder is charging for its own work, and the
 * customer's AP team has to be able to tell those apart. So each line states
 * its category, its basis and its quantity, whose cost it is, and whether it
 * was passed through at cost, marked up, or originated by the forwarder.
 *
 * Two things this is NOT, both of which get confused with it:
 *
 * - A **commercial invoice** is the seller's document stating the value of the
 *   goods, and it is what customs assesses duty on. Its total has no
 *   relationship to this one and using this document in its place misdeclares
 *   the customs value.
 * - A **bill of lading** is the carrier's contract of carriage and, when
 *   negotiable, a document of title. It moves goods; this moves money.
 *
 * Pure: no framework, no database, no clock. Every input is passed in, so the
 * same inputs always render the same document — which is the whole point when
 * the customer holds a printed copy of what was sent six months ago.
 */

export interface InvoiceIssuer {
  legalName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  /** SARS customs client number, printed so the customer's broker can reconcile. */
  customsClientNumber?: string | null;
  addressLines?: string | null;
  country: string;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  bankSwift?: string | null;
  invoiceFooter?: string | null;
}

export interface InvoiceBillTo {
  name: string;
  addressLines?: string | null;
  country?: string | null;
  /** The customer's VAT registration — required for them to reclaim. */
  taxId?: string | null;
  email?: string | null;
  contact?: string | null;
}

/** The movement the charges relate to. Every field is a matching key for AP. */
export interface InvoiceShipmentSummary {
  reference: string;
  origin: string;
  destination: string;
  mode: string;
  incoterm?: string | null;
  vesselName?: string | null;
  voyage?: string | null;
  /** Bill of lading or air waybill. */
  transportDocumentRef?: string | null;
  carrierBookingRef?: string | null;
  containers?: Array<{ number: string | null; type: string | null }>;
  etd?: string | null;
  eta?: string | null;
}

/** What was in the boxes, in the words the packing list used. */
export interface InvoiceCargoSummary {
  description: string;
  cargoType: string;
  pieces: number;
  grossWeightGrams: number;
  volumeCm3: number;
  chargeableWeightGrams: number;
  /** Marks the customer's own warehouse recognises. */
  marksAndNumbers?: string | null;
}

export interface InvoiceLineInput {
  id: string;
  chargeCode: string;
  description: string;
  category: ChargeCategory;
  provenance: ChargeProvenance;
  basis: ChargeBasis;
  quantity: number;
  unitSellCents: number | null;
  sellCents: number;
  buyCents: number | null;
  currency: string;
  vatBps: number;
  vendorName?: string | null;
  vendorInvoiceRef?: string | null;
  contractRef?: string | null;
  disputed?: boolean;
}

export interface InvoiceDocumentInput {
  number: string;
  type: "FREIGHT_INVOICE" | "CREDIT_NOTE" | "PROFORMA";
  status: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  paymentTermsDays: number;
  issuer: InvoiceIssuer;
  billTo: InvoiceBillTo;
  shipment?: InvoiceShipmentSummary | null;
  cargo?: InvoiceCargoSummary | null;
  lines: InvoiceLineInput[];
  customerReference?: string | null;
  notes?: string | null;
  /** Already-received money, so the document can state what is actually owed. */
  paidCents?: number;
}

export interface InvoiceLine extends InvoiceLineInput {
  /** Human label for the code, from the taxonomy rather than the vendor's text. */
  codeLabel: string;
  vatCents: number;
  /** Only meaningful where a buy exists. Never rendered to a customer. */
  marginCents: number | null;
  marginBps: number | null;
}

export interface InvoiceSection {
  category: ChargeCategory;
  label: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  vatCents: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  /** Of the subtotal: money advanced on the customer's behalf, billed at cost. */
  disbursementCents: number;
  /** Of the subtotal: third-party cost with the forwarder's margin on it. */
  markedUpCents: number;
  /** Of the subtotal: the forwarder's own services, no underlying cost. */
  forwarderOriginatedCents: number;
  paidCents: number;
  outstandingCents: number;
  /** Lines held back from payment pending a dispute. Included in the total. */
  disputedCents: number;
}

/** Operator-only. Rendering this to a customer shows them your margin. */
export interface InvoiceMargin {
  buyCents: number;
  sellCents: number;
  marginCents: number;
  marginBps: number;
  /** Lines with no recorded buy — margin is unknowable, not zero. */
  linesWithoutBuy: number;
}

export interface InvoiceDocument {
  number: string;
  type: InvoiceDocumentInput["type"];
  typeLabel: string;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  paymentTermsLabel: string;
  issuer: InvoiceIssuer;
  billTo: InvoiceBillTo;
  shipment?: InvoiceShipmentSummary | null;
  cargo?: InvoiceCargoSummary | null;
  sections: InvoiceSection[];
  totals: InvoiceTotals;
  margin: InvoiceMargin;
  customerReference?: string | null;
  notes?: string | null;
  /**
   * Printed on every document. Not boilerplate — a forwarder invoice used as a
   * commercial invoice is a customs valuation problem, and it happens because
   * nothing on the page says otherwise.
   */
  documentNotice: string;
  /** Every currency appearing on the lines. Should be exactly one. */
  currencies: string[];
}

const TYPE_LABEL: Record<InvoiceDocumentInput["type"], string> = {
  FREIGHT_INVOICE: "Freight invoice",
  CREDIT_NOTE: "Credit note",
  PROFORMA: "Proforma invoice",
};

const DOCUMENT_NOTICE =
  "This is a freight forwarder's invoice for transport and related services. " +
  "It is not a commercial invoice and does not state the value of the goods; " +
  "it is not a bill of lading and confers no title to the cargo.";

/**
 * VAT on one line, rounded per line rather than on the subtotal.
 *
 * Per line because that is what the line shows, and a total that does not
 * equal the sum of its visible parts is the first thing an AP clerk queries.
 * Half-up on the absolute value so a credit note rounds symmetrically with the
 * invoice it reverses — `Math.round(-0.5)` is `-0` in JavaScript, which would
 * make a full credit note one cent short of the original.
 */
export function lineVatCents(sellCents: number, vatBps: number): number {
  const magnitude = Math.round((Math.abs(sellCents) * vatBps) / 10_000);
  return sellCents < 0 ? -magnitude : magnitude;
}

/** Basis points of margin over sell. Sell of zero has no defined margin. */
function marginBpsOf(buyCents: number, sellCents: number): number | null {
  if (sellCents === 0) return null;
  return Math.round(((sellCents - buyCents) / Math.abs(sellCents)) * 10_000);
}

export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocument {
  const sign = input.type === "CREDIT_NOTE" ? -1 : 1;

  const lines: InvoiceLine[] = input.lines.map((l) => {
    const sellCents = sign * l.sellCents;
    const buyCents = l.buyCents == null ? null : sign * l.buyCents;
    return {
      ...l,
      sellCents,
      buyCents,
      unitSellCents: l.unitSellCents == null ? null : sign * l.unitSellCents,
      codeLabel: CHARGE_CODE_BY_CODE.get(l.chargeCode)?.label ?? l.description,
      vatCents: lineVatCents(sellCents, l.vatBps),
      marginCents: buyCents == null ? null : sellCents - buyCents,
      marginBps: buyCents == null ? null : marginBpsOf(buyCents, sellCents),
    };
  });

  const sections: InvoiceSection[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = lines.filter((l) => l.category === category);
    if (inCategory.length === 0) continue;
    sections.push({
      category,
      label: CATEGORY_LABEL[category],
      lines: inCategory,
      subtotalCents: inCategory.reduce((s, l) => s + l.sellCents, 0),
      vatCents: inCategory.reduce((s, l) => s + l.vatCents, 0),
    });
  }

  const subtotalCents = lines.reduce((s, l) => s + l.sellCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const byProvenance = (p: ChargeProvenance) =>
    lines.filter((l) => l.provenance === p).reduce((s, l) => s + l.sellCents, 0);

  const linesWithBuy = lines.filter((l) => l.buyCents != null);
  const buyCents = linesWithBuy.reduce((s, l) => s + (l.buyCents ?? 0), 0);
  const sellOnBuyLines = linesWithBuy.reduce((s, l) => s + l.sellCents, 0);

  const totalCents = subtotalCents + vatCents;
  const paidCents = input.paidCents ?? 0;

  return {
    number: input.number,
    type: input.type,
    typeLabel: TYPE_LABEL[input.type],
    status: input.status,
    currency: input.currency,
    issueDate: input.issueDate.toISOString(),
    dueDate: input.dueDate.toISOString(),
    paymentTermsDays: input.paymentTermsDays,
    paymentTermsLabel:
      input.type === "PROFORMA"
        ? "Proforma — not a demand for payment"
        : input.paymentTermsDays === 0
          ? "Due on presentation"
          : `Net ${input.paymentTermsDays} days from date of invoice`,
    issuer: input.issuer,
    billTo: input.billTo,
    shipment: input.shipment ?? null,
    cargo: input.cargo ?? null,
    sections,
    totals: {
      subtotalCents,
      vatCents,
      totalCents,
      disbursementCents: byProvenance("PASS_THROUGH"),
      markedUpCents: byProvenance("MARKED_UP"),
      forwarderOriginatedCents: byProvenance("FORWARDER_ORIGINATED"),
      paidCents,
      outstandingCents: totalCents - paidCents,
      disputedCents: lines
        .filter((l) => l.disputed)
        .reduce((s, l) => s + l.sellCents + l.vatCents, 0),
    },
    margin: {
      buyCents,
      sellCents: sellOnBuyLines,
      marginCents: sellOnBuyLines - buyCents,
      marginBps: marginBpsOf(buyCents, sellOnBuyLines) ?? 0,
      linesWithoutBuy: lines.length - linesWithBuy.length,
    },
    customerReference: input.customerReference ?? null,
    notes: input.notes ?? null,
    documentNotice: DOCUMENT_NOTICE,
    currencies: Array.from(new Set(input.lines.map((l) => l.currency))).sort(),
  };
}
