import { describe, expect, it } from "vitest";
import { withValidity } from "@/lib/rate-validity";
import type { RateCard } from "@/lib/types";

const NOW = Date.parse("2026-07-15T12:00:00Z");

function card(validFrom: string, validTo: string): RateCard {
  return {
    id: crypto.randomUUID(),
    tenantId: "t",
    kind: "CONTRACT",
    carrierId: null,
    carrierName: "Test Line",
    mode: "OCEAN",
    origin: "ZADUR",
    destination: "NLRTM",
    containerType: "40HC",
    buyAmountCents: 100_000,
    currency: "USD",
    transitDays: 24,
    validFrom,
    validTo,
    createdAt: validFrom,
    surcharges: [],
  };
}

describe("rate card validity", () => {
  it("classifies a card that has run out", () => {
    const [row] = withValidity([card("2026-01-01T00:00:00Z", "2026-06-30T00:00:00Z")], NOW);
    expect(row!.validity).toBe("expired");
  });

  it("classifies a card that has not started", () => {
    const [row] = withValidity([card("2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z")], NOW);
    expect(row!.validity).toBe("pending");
  });

  it("classifies a card in its window", () => {
    const [row] = withValidity([card("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z")], NOW);
    expect(row!.validity).toBe("live");
  });

  it("counts the boundary day as live", () => {
    // A card written "valid to 15 July" must still price a quote raised that
    // morning — the API stores the end of the day, so the comparison is
    // against an instant, not a date.
    const [row] = withValidity([card("2026-07-15T00:00:00Z", "2026-07-15T23:59:59Z")], NOW);
    expect(row!.validity).toBe("live");
  });
});
