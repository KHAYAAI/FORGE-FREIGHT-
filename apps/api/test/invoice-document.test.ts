import { describe, expect, it } from "vitest";
import {
  buildInvoiceDocument,
  lineVatCents,
  type InvoiceDocumentInput,
  type InvoiceLineInput,
} from "../src/modules/billing/invoice-document.js";

/**
 * The invoice is the document a customer pays from and an auditor reads back
 * years later. Everything asserted here is something that, if it drifted,
 * would produce a document that is internally inconsistent — and an invoice
 * whose visible parts do not add up to its total is queried before it is paid.
 */

const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  id: over.id ?? "l1",
  chargeCode: "FRT",
  description: "Ocean freight ZADUR → NLRTM",
  category: "FREIGHT",
  provenance: "MARKED_UP",
  basis: "PER_CONTAINER",
  quantity: 2,
  unitSellCents: 1_850_00,
  sellCents: 3_700_00,
  buyCents: 3_100_00,
  currency: "ZAR",
  vatBps: 1500,
  ...over,
});

const base = (over: Partial<InvoiceDocumentInput> = {}): InvoiceDocumentInput => ({
  number: "INV-2026-000101",
  type: "FREIGHT_INVOICE",
  status: "ISSUED",
  currency: "ZAR",
  issueDate: new Date("2026-03-02T08:00:00Z"),
  dueDate: new Date("2026-04-01T08:00:00Z"),
  paymentTermsDays: 30,
  issuer: { legalName: "Meridian Freight Services (Pty) Ltd", country: "ZA" },
  billTo: { name: "Kalahari Textiles (Pty) Ltd" },
  lines: [line()],
  ...over,
});

describe("assembling the document", () => {
  it("adds VAT per line and totals to the sum of what it shows", () => {
    const doc = buildInvoiceDocument(base());
    expect(doc.totals.subtotalCents).toBe(370_000);
    expect(doc.totals.vatCents).toBe(55_500);
    expect(doc.totals.totalCents).toBe(425_500);
    // The whole point: the visible sections must add up to the visible total.
    const fromSections = doc.sections.reduce((s, sec) => s + sec.subtotalCents + sec.vatCents, 0);
    expect(fromSections).toBe(doc.totals.totalCents);
  });

  it("groups lines into trade-order sections", () => {
    const doc = buildInvoiceDocument(
      base({
        lines: [
          line({ id: "a", chargeCode: "THC", category: "DESTINATION", sellCents: 60_000, unitSellCents: 30_000 }),
          line({ id: "b" }),
          line({ id: "c", chargeCode: "OHC", category: "ORIGIN", sellCents: 40_000, unitSellCents: 20_000 }),
        ],
      }),
    );
    expect(doc.sections.map((s) => s.category)).toEqual(["ORIGIN", "FREIGHT", "DESTINATION"]);
  });

  it("splits the subtotal by how the forwarder came by the money", () => {
    // The field no forwarder invoice in the wild carries, and the one that
    // makes margin explicable rather than something a customer has to guess at.
    const doc = buildInvoiceDocument(
      base({
        lines: [
          line({ id: "a", provenance: "MARKED_UP", sellCents: 300_000, unitSellCents: 150_000 }),
          line({ id: "b", chargeCode: "DTY", category: "DUTY_TAX", provenance: "PASS_THROUGH", sellCents: 120_000, quantity: 1, unitSellCents: 120_000, vatBps: 0, buyCents: 120_000 }),
          line({ id: "c", chargeCode: "DOC", category: "DOCUMENTATION", provenance: "FORWARDER_ORIGINATED", sellCents: 85_000, quantity: 1, unitSellCents: 85_000, buyCents: null }),
        ],
      }),
    );
    expect(doc.totals.markedUpCents).toBe(300_000);
    expect(doc.totals.disbursementCents).toBe(120_000);
    expect(doc.totals.forwarderOriginatedCents).toBe(85_000);
    expect(
      doc.totals.markedUpCents + doc.totals.disbursementCents + doc.totals.forwarderOriginatedCents,
    ).toBe(doc.totals.subtotalCents);
  });

  it("reports margin only where a cost is actually recorded", () => {
    // A line with no buy has unknowable margin, not 100% margin. Counting it
    // as pure profit is how a margin report becomes fiction.
    const doc = buildInvoiceDocument(
      base({
        lines: [line({ id: "a" }), line({ id: "b", chargeCode: "DOC", category: "DOCUMENTATION", buyCents: null, sellCents: 85_000, quantity: 1, unitSellCents: 85_000 })],
      }),
    );
    expect(doc.margin.buyCents).toBe(310_000);
    expect(doc.margin.sellCents).toBe(370_000);
    expect(doc.margin.marginCents).toBe(60_000);
    expect(doc.margin.linesWithoutBuy).toBe(1);
  });

  it("states what it is and is not, on every document", () => {
    // A forwarder invoice used as a commercial invoice misdeclares the customs
    // value of the goods. It happens because nothing on the page says otherwise.
    const doc = buildInvoiceDocument(base());
    expect(doc.documentNotice).toMatch(/not a commercial invoice/i);
    expect(doc.documentNotice).toMatch(/not a bill of lading/i);
  });

  it("surfaces mixed currencies rather than silently summing them", () => {
    const doc = buildInvoiceDocument(
      base({ lines: [line({ id: "a" }), line({ id: "b", currency: "USD" })] }),
    );
    expect(doc.currencies).toEqual(["USD", "ZAR"]);
  });

  it("labels payment terms in the words the customer's AP team uses", () => {
    expect(buildInvoiceDocument(base()).paymentTermsLabel).toBe(
      "Net 30 days from date of invoice",
    );
    expect(buildInvoiceDocument(base({ paymentTermsDays: 0 })).paymentTermsLabel).toBe(
      "Due on presentation",
    );
  });

  it("never presents a proforma as a demand for payment", () => {
    const doc = buildInvoiceDocument(base({ type: "PROFORMA" }));
    expect(doc.typeLabel).toBe("Proforma invoice");
    expect(doc.paymentTermsLabel).toMatch(/not a demand for payment/i);
  });

  it("carries the outstanding balance, not just the total", () => {
    const doc = buildInvoiceDocument(base({ paidCents: 200_000 }));
    expect(doc.totals.outstandingCents).toBe(225_500);
  });

  it("separates disputed money from the balance so it can be held back", () => {
    const doc = buildInvoiceDocument(
      base({
        lines: [
          line({ id: "a" }),
          line({ id: "b", chargeCode: "BAF", category: "FUEL_SURCHARGE", sellCents: 40_000, quantity: 1, unitSellCents: 40_000, disputed: true }),
        ],
      }),
    );
    expect(doc.totals.disputedCents).toBe(46_000);
    // Still inside the total: disputing a line does not remove it from the
    // invoice, it flags it. Netting it off would quietly reissue the document.
    expect(doc.totals.totalCents).toBe(425_500 + 46_000);
  });
});

describe("credit notes", () => {
  it("reverses every amount so a full credit note is the exact inverse", () => {
    const inv = buildInvoiceDocument(base());
    const cn = buildInvoiceDocument(base({ type: "CREDIT_NOTE" }));
    expect(cn.totals.subtotalCents).toBe(-inv.totals.subtotalCents);
    expect(cn.totals.vatCents).toBe(-inv.totals.vatCents);
    expect(cn.totals.totalCents).toBe(-inv.totals.totalCents);
  });

  it("rounds symmetrically with the invoice it reverses", () => {
    // Math.round(-0.5) is -0 in JavaScript, so a naive implementation leaves a
    // full credit note one cent short of the invoice on odd half-cents.
    const odd = 333_33; // R333.33 → VAT of R49.9995, which rounds to R50.00
    expect(lineVatCents(odd, 1500)).toBe(50_00);
    expect(lineVatCents(-odd, 1500)).toBe(-50_00);
    expect(lineVatCents(odd, 1500) + lineVatCents(-odd, 1500)).toBe(0);
  });
});

describe("an invoice with nothing on it", () => {
  it("is a zero document rather than a crash", () => {
    const doc = buildInvoiceDocument(base({ lines: [] }));
    expect(doc.sections).toEqual([]);
    expect(doc.totals.totalCents).toBe(0);
    expect(doc.margin.marginBps).toBe(0);
  });
});
