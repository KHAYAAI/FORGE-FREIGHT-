import { describe, expect, it } from "vitest";
import { QuotePdfService } from "../src/modules/quoting/quote-pdf.service.js";

describe("QuotePdfService", () => {
  it("renders a non-trivial PDF document", async () => {
    const pdf = await new QuotePdfService().render({
      quoteId: "9d7948c5-dc56-4c5d-8e43-1d2aeeb29f02",
      customerName: "Ubuntu Trading (Pty) Ltd",
      origin: "CNSHA",
      destination: "ZADUR",
      mode: "OCEAN",
      containerType: "40HC",
      containerQuantity: 2,
      incoterm: "FOB",
      validUntil: new Date("2026-07-29T00:00:00Z"),
      createdAt: new Date("2026-07-15T00:00:00Z"),
      lines: [
        {
          chargeCode: "FRT",
          description: "OCEAN freight CNSHA→ZADUR (Maersk Line)",
          quantity: 2,
          sellCents: 335000,
          currency: "USD",
        },
        {
          chargeCode: "THC-D",
          description: "Terminal handling, Durban",
          quantity: 2,
          sellCents: 487200,
          currency: "ZAR",
        },
      ],
      totalsByCurrency: { USD: 670000, ZAR: 974400 },
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");
  });
});
