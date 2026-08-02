import { describe, expect, it } from "vitest";
import {
  auditInvoice,
  buildDisputePacket,
  type AuditInput,
  type AuditLine,
} from "../src/modules/billing/invoice-audit.js";

/**
 * Each test here is one way a forwarder invoice is wrong in the field. The
 * point of the suite is not that the rules fire — it is that they fire on the
 * specific shapes that a two-way match against the quote total cannot see.
 */

const line = (over: Partial<AuditLine> = {}): AuditLine => ({
  id: over.id ?? "l1",
  chargeCode: "FRT",
  description: "Ocean freight",
  category: "FREIGHT",
  provenance: "MARKED_UP",
  basis: "PER_CONTAINER",
  quantity: 2,
  unitSellCents: 1_850_00,
  sellCents: 3_700_00,
  buyCents: 3_100_00,
  currency: "ZAR",
  vatBps: 1500,
  contractRef: "MSK-2026-Q1",
  ...over,
});

const facts = (over: Partial<AuditInput["facts"]> = {}): AuditInput["facts"] => ({
  containerCount: 2,
  transportDocumentCount: 1,
  chargeableWeightGrams: 18_000_000,
  volumeCm3: 60_000_000,
  mode: "OCEAN",
  occurredEventTypes: [
    "shipment.booked",
    "container.gated_in",
    "container.loaded",
    "vessel.departed",
    "vessel.arrived",
    "container.discharged",
    "container.gated_out",
    "entry.submitted",
    "entry.released",
    "pod.confirmed",
  ],
  ...over,
});

const input = (over: Partial<AuditInput> = {}): AuditInput => {
  const lines = over.lines ?? [line()];
  const subtotal = lines.reduce((s, l) => s + l.sellCents, 0);
  const vat = lines.reduce((s, l) => s + Math.round((l.sellCents * l.vatBps) / 10_000), 0);
  return {
    invoiceCurrency: "ZAR",
    statedSubtotalCents: subtotal,
    statedVatCents: vat,
    statedTotalCents: subtotal + vat,
    issuerVatRegistered: true,
    lines,
    contract: [],
    facts: facts(),
    ...over,
    // Recomputed after the spread so an explicit lines override still balances,
    // unless the test deliberately states its own totals.
    ...(over.statedSubtotalCents == null
      ? { statedSubtotalCents: subtotal, statedVatCents: vat, statedTotalCents: subtotal + vat }
      : {}),
  };
};

const codes = (r: ReturnType<typeof auditInvoice>) => r.findings.map((f) => f.code);

describe("a clean invoice", () => {
  it("raises nothing", () => {
    expect(codes(auditInvoice(input()))).toEqual([]);
  });
});

describe("against the contract", () => {
  it("catches a rate billed above what the customer was sold", () => {
    const r = auditInvoice(
      input({
        contract: [
          { chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 1_500_00, currency: "ZAR", source: "Rate card ZADUR-NLRTM Q1" },
        ],
      }),
    );
    const f = r.findings.find((x) => x.code === "CONTRACT_RATE_VARIANCE")!;
    expect(f.severity).toBe("CRITICAL");
    // 2 containers × R350 over = R700 overcharge.
    expect(f.varianceCents).toBe(700_00);
    expect(f.message).toContain("Rate card ZADUR-NLRTM Q1");
  });

  it("stays quiet inside the tolerance", () => {
    const r = auditInvoice(
      input({
        contract: [
          { chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 1_840_00, currency: "ZAR", source: "c" },
        ],
      }),
    );
    expect(codes(r)).not.toContain("CONTRACT_RATE_VARIANCE");
  });

  it("refuses to compare rates across currencies instead of guessing an FX rate", () => {
    const r = auditInvoice(
      input({
        contract: [
          { chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 100_00, currency: "USD", source: "c" },
        ],
      }),
    );
    expect(codes(r)).toContain("CONTRACT_CURRENCY_MISMATCH");
    expect(codes(r)).not.toContain("CONTRACT_RATE_VARIANCE");
  });

  it("names a third-party line with nothing behind it", () => {
    // The finding a two-way match can never produce: not that the number is
    // wrong, but that nothing exists to check it against.
    const r = auditInvoice(
      input({
        lines: [line({ contractRef: null, vendorInvoiceRef: null, buyCents: null })],
      }),
    );
    expect(codes(r)).toContain("NO_MATCH_REFERENCE");
  });

  it("does not ask a forwarder's own fee to reference a vendor", () => {
    const r = auditInvoice(
      input({
        lines: [
          line({
            chargeCode: "DOC",
            category: "DOCUMENTATION",
            provenance: "FORWARDER_ORIGINATED",
            basis: "PER_DOCUMENT",
            quantity: 1,
            unitSellCents: 85_000,
            sellCents: 85_000,
            buyCents: null,
            contractRef: null,
          }),
        ],
      }),
    );
    expect(codes(r)).not.toContain("NO_MATCH_REFERENCE");
  });
});

describe("provenance and tax", () => {
  it("treats margin on a pass-through disbursement as critical", () => {
    const r = auditInvoice(
      input({
        lines: [
          line({
            chargeCode: "DTY",
            category: "DUTY_TAX",
            provenance: "PASS_THROUGH",
            basis: "PER_SHIPMENT",
            quantity: 1,
            unitSellCents: 132_000,
            sellCents: 132_000,
            buyCents: 120_000,
            vatBps: 0,
          }),
        ],
      }),
    );
    const f = r.findings.find((x) => x.code === "MARGIN_ON_PASS_THROUGH")!;
    expect(f.severity).toBe("CRITICAL");
    expect(f.varianceCents).toBe(12_000);
  });

  it("catches VAT charged on a statutory amount that is outside its scope", () => {
    const r = auditInvoice(
      input({
        lines: [
          line({
            chargeCode: "DTY",
            category: "DUTY_TAX",
            provenance: "PASS_THROUGH",
            basis: "PER_SHIPMENT",
            quantity: 1,
            unitSellCents: 120_000,
            sellCents: 120_000,
            buyCents: 120_000,
            vatBps: 1500,
          }),
        ],
      }),
    );
    const f = r.findings.find((x) => x.code === "VAT_ON_DISBURSEMENT")!;
    expect(f.severity).toBe("CRITICAL");
    expect(f.varianceCents).toBe(18_000);
  });

  it("queries a taxable line carrying no VAT from a registered issuer", () => {
    const r = auditInvoice(input({ lines: [line({ vatBps: 0 })] }));
    expect(codes(r)).toContain("MISSING_VAT");
  });

  it("does not query missing VAT from an issuer that is not registered", () => {
    const r = auditInvoice(input({ lines: [line({ vatBps: 0 })], issuerVatRegistered: false }));
    expect(codes(r)).not.toContain("MISSING_VAT");
  });
});

describe("against the shipment's own facts", () => {
  it("catches a per-container charge billed once on a two-container booking", () => {
    // The commonest terminal-handling error there is.
    const r = auditInvoice(
      input({
        lines: [
          line({ chargeCode: "THC", category: "DESTINATION", quantity: 1, unitSellCents: 95_000, sellCents: 95_000, buyCents: 95_000, provenance: "PASS_THROUGH" }),
        ],
      }),
    );
    const f = r.findings.find((x) => x.code === "QUANTITY_VS_CONTAINERS")!;
    expect(f.varianceCents).toBe(-95_000); // undercharged by one container
  });

  it("catches a documentation fee billed per container instead of per bill of lading", () => {
    const r = auditInvoice(
      input({
        lines: [
          line({
            chargeCode: "DOC",
            category: "DOCUMENTATION",
            basis: "PER_DOCUMENT",
            provenance: "FORWARDER_ORIGINATED",
            quantity: 2,
            unitSellCents: 85_000,
            sellCents: 170_000,
            buyCents: null,
          }),
        ],
      }),
    );
    const f = r.findings.find((x) => x.code === "QUANTITY_VS_DOCUMENTS")!;
    expect(f.varianceCents).toBe(85_000);
  });

  it("catches a line whose own arithmetic does not hold", () => {
    const r = auditInvoice(
      input({ lines: [line({ quantity: 2, unitSellCents: 1_850_00, sellCents: 3_900_00 })] }),
    );
    const f = r.findings.find((x) => x.code === "LINE_ARITHMETIC")!;
    expect(f.varianceCents).toBe(200_00);
  });

  it("catches the same line billed twice at the same amount", () => {
    const r = auditInvoice(
      input({ lines: [line({ id: "a" }), line({ id: "b" })] }),
    );
    const f = r.findings.find((x) => x.code === "DUPLICATE_LINE")!;
    expect(f.chargeId).toBe("b");
    expect(f.evidence.firstChargeId).toBe("a");
  });

  it("catches a total that does not equal the lines under it", () => {
    const r = auditInvoice(input({ statedSubtotalCents: 400_000, statedVatCents: 60_000, statedTotalCents: 460_000 }));
    expect(codes(r)).toContain("SUBTOTAL_MISMATCH");
  });

  it("catches a total that does not equal its own subtotal plus VAT", () => {
    const r = auditInvoice(input({ statedSubtotalCents: 370_000, statedVatCents: 55_500, statedTotalCents: 999_999 }));
    expect(codes(r)).toContain("TOTAL_MISMATCH");
  });

  it("refuses to add up two currencies quietly", () => {
    const r = auditInvoice(input({ lines: [line({ currency: "USD" })] }));
    const f = r.findings.find((x) => x.code === "CURRENCY_MISMATCH")!;
    expect(f.severity).toBe("CRITICAL");
  });
});

describe("against the service event record", () => {
  it("flags a delivery charge on a container that never left the terminal", () => {
    // Not a pricing error — a line for work not done.
    const r = auditInvoice(
      input({
        lines: [
          line({ chargeCode: "DEL", category: "DESTINATION", quantity: 2, unitSellCents: 45_000, sellCents: 90_000, buyCents: 70_000 }),
        ],
        facts: facts({ occurredEventTypes: ["shipment.booked", "vessel.departed", "vessel.arrived"] }),
      }),
    );
    const f = r.findings.find((x) => x.code === "SERVICE_NOT_EVIDENCED")!;
    expect(f.severity).toBe("CRITICAL");
    expect(f.varianceCents).toBe(90_000);
  });

  it("does not fire when no event history is available at all", () => {
    // Absence of a timeline is not evidence the service did not happen.
    const r = auditInvoice(
      input({
        lines: [line({ chargeCode: "DEL", category: "DESTINATION", quantity: 2, unitSellCents: 45_000, sellCents: 90_000, buyCents: 70_000 })],
        facts: facts({ occurredEventTypes: [] }),
      }),
    );
    expect(codes(r)).not.toContain("SERVICE_NOT_EVIDENCED");
  });
});

describe("fuel surcharges", () => {
  const bafLine = () =>
    line({
      id: "baf",
      chargeCode: "BAF",
      category: "FUEL_SURCHARGE",
      provenance: "PASS_THROUGH",
      quantity: 2,
      unitSellCents: 42_000,
      sellCents: 84_000,
      buyCents: 84_000,
    });

  it("says plainly when it cannot check them at all", () => {
    // The highest-error category on the document going unchecked is a fact the
    // reader is entitled to, not something to pass over in silence.
    const r = auditInvoice(input({ lines: [bafLine()] }));
    const f = r.findings.find((x) => x.code === "FUEL_BENCHMARK_UNAVAILABLE")!;
    expect(f.message).toContain("FUEL_INDEX_URL");
    expect(f.evidence.totalCents).toBe(84_000);
  });

  it("catches a surcharge still at last quarter's index level", () => {
    const r = auditInvoice(
      input({
        lines: [bafLine()],
        fuel: {
          indexCode: "PLATTS_VLSFO_ROTTERDAM",
          source: "Platts VLSFO Rotterdam",
          quotedFor: "2026-03-01",
          expectedUnitCents: 31_000,
          currency: "ZAR",
        },
      }),
    );
    const f = r.findings.find((x) => x.code === "FUEL_INDEX_VARIANCE")!;
    expect(f.severity).toBe("CRITICAL");
    expect(f.varianceCents).toBe(22_000);
    expect(f.evidence.indexCode).toBe("PLATTS_VLSFO_ROTTERDAM");
  });
});

describe("demurrage and detention", () => {
  const dem = (quantity: number) =>
    line({
      id: "dem",
      chargeCode: "DEM",
      category: "DEMURRAGE_DETENTION",
      provenance: "PASS_THROUGH",
      basis: "PER_DAY",
      quantity,
      unitSellCents: 95_000,
      sellCents: 95_000 * quantity,
      buyCents: 95_000 * quantity,
    });

  it("says what is missing rather than passing an unverifiable charge", () => {
    const r = auditInvoice(input({ lines: [dem(4)] }));
    const f = r.findings.find((x) => x.code === "DEMURRAGE_UNVERIFIABLE")!;
    expect(f.message).toContain("TERMINAL_EVENTS_URL");
  });

  it("recomputes the chargeable days from free time and the gate clock", () => {
    const r = auditInvoice(
      input({
        lines: [dem(4)],
        facts: facts({
          freeTimeDays: 5,
          dischargedAt: new Date("2026-03-01T06:00:00Z"),
          gateOutAt: new Date("2026-03-08T06:00:00Z"), // 7 days dwell, 5 free → 2 chargeable
        }),
      }),
    );
    const f = r.findings.find((x) => x.code === "DEMURRAGE_DAYS_VARIANCE")!;
    expect(f.severity).toBe("CRITICAL");
    expect(f.varianceCents).toBe(190_000); // 2 days over at R950
  });

  it("accepts demurrage that matches the clock", () => {
    const r = auditInvoice(
      input({
        lines: [dem(2)],
        facts: facts({
          freeTimeDays: 5,
          dischargedAt: new Date("2026-03-01T06:00:00Z"),
          gateOutAt: new Date("2026-03-08T06:00:00Z"),
        }),
      }),
    );
    expect(codes(r)).not.toContain("DEMURRAGE_DAYS_VARIANCE");
  });

  it("catches demurrage and detention counting the same days", () => {
    // The two windows abut at gate-out. Billed together for more days than the
    // container was out of the carrier's hands, one is eating the other's.
    const r = auditInvoice(
      input({
        lines: [
          dem(3),
          line({
            id: "det",
            chargeCode: "DET",
            category: "DEMURRAGE_DETENTION",
            provenance: "PASS_THROUGH",
            basis: "PER_DAY",
            quantity: 6,
            unitSellCents: 65_000,
            sellCents: 390_000,
            buyCents: 390_000,
          }),
        ],
        facts: facts({
          freeTimeDays: 5,
          dischargedAt: new Date("2026-03-01T06:00:00Z"),
          gateOutAt: new Date("2026-03-09T06:00:00Z"),
          emptyReturnedAt: new Date("2026-03-08T06:00:00Z"),
        }),
      }),
    );
    expect(codes(r)).toContain("DEMURRAGE_DETENTION_OVERLAP");
  });
});

describe("normalisation", () => {
  it("flags a line nobody has mapped as unauditable", () => {
    const r = auditInvoice(
      input({ lines: [line({ chargeCode: "MSC", category: "OTHER", codeMatch: "fallback", description: "Special recovery" })] }),
    );
    const f = r.findings.find((x) => x.code === "UNMAPPED_CHARGE_CODE")!;
    expect(f.severity).toBe("WARN");
  });

  it("keeps an immaterial unmapped line as information rather than noise", () => {
    const r = auditInvoice(
      input({
        lines: [line({ chargeCode: "MSC", category: "OTHER", codeMatch: "fallback", quantity: 1, unitSellCents: 1_200, sellCents: 1_200, buyCents: null, contractRef: null, provenance: "FORWARDER_ORIGINATED" })],
      }),
    );
    expect(r.findings.find((x) => x.code === "UNMAPPED_CHARGE_CODE")!.severity).toBe("INFO");
  });
});

describe("the summary", () => {
  it("says which of the four match sources were actually available", () => {
    // "No exceptions found" against one source is a different claim from the
    // same words against four. Conflating them is how an audit becomes theatre.
    const thin = auditInvoice(
      input({
        lines: [line({ buyCents: null })],
        facts: facts({ containerCount: 0, transportDocumentCount: 0, occurredEventTypes: [] }),
      }),
    );
    expect(thin.summary.matchedSources).toBe(0);
    expect(thin.summary.matchDepth.CONTRACT).toBe(false);

    const full = auditInvoice(
      input({
        contract: [{ chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 1_850_00, currency: "ZAR", source: "c" }],
      }),
    );
    expect(full.summary.matchedSources).toBe(4);
  });

  it("nets the quantified variances and counts what is critical", () => {
    const r = auditInvoice(
      input({
        contract: [{ chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 1_500_00, currency: "ZAR", source: "c" }],
      }),
    );
    expect(r.summary.netVarianceCents).toBe(700_00);
    expect(r.summary.criticalCount).toBe(1);
  });

  it("puts the critical findings first", () => {
    const r = auditInvoice(
      input({
        lines: [line({ vatBps: 0, currency: "USD" })],
      }),
    );
    expect(r.findings[0]!.severity).toBe("CRITICAL");
  });
});

describe("the dispute packet", () => {
  it("claims only the quantified overcharges, and says so in money", () => {
    const audit = auditInvoice(
      input({
        contract: [{ chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 1_500_00, currency: "ZAR", source: "Rate card Q1" }],
      }),
    );
    const packet = buildDisputePacket({
      invoiceNumber: "INV-2026-000101",
      issuerName: "Meridian Freight Services",
      shipmentReference: "FF-2026-000044",
      transportDocumentRef: "MAEU123456789",
      currency: "ZAR",
      findings: audit.findings,
      lineById: new Map([["l1", { description: "Ocean freight", chargeCode: "FRT", sellCents: 370_000 }]]),
      disputeWindowDaysRemaining: 9,
      generatedAt: new Date("2026-03-05T10:00:00Z"),
    });
    expect(packet.claimedCents).toBe(700_00);
    expect(packet.lineCount).toBe(1);
    expect(packet.subject).toContain("ZAR 700.00");
    expect(packet.body).toContain("MAEU123456789");
    expect(packet.body).toContain("9 day(s) remaining");
    // Raised before payment, not at month-end after the window shut.
    expect(packet.body).toContain("before payment");
  });

  it("ignores undercharges — those are not the vendor's problem", () => {
    const audit = auditInvoice(
      input({
        contract: [{ chargeCode: "FRT", basis: "PER_CONTAINER", unitSellCents: 2_200_00, currency: "ZAR", source: "c" }],
      }),
    );
    const packet = buildDisputePacket({
      invoiceNumber: "INV-1",
      issuerName: "x",
      currency: "ZAR",
      findings: audit.findings,
      lineById: new Map(),
      generatedAt: new Date("2026-03-05T10:00:00Z"),
    });
    expect(packet.claimedCents).toBe(0);
    expect(packet.body).toContain("No quantified overcharges");
  });
});
