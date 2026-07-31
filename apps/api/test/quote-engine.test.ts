import { describe, expect, it } from "vitest";
import {
  buildQuote,
  NoMarginRuleError,
  NoRateError,
  resolveMarginRule,
  selectRateCard,
  type MarginRuleInput,
  type QuoteRequest,
  type RateCardInput,
} from "../src/modules/quoting/quote-engine.js";

const at = new Date("2026-07-15T00:00:00Z");

const shaDur: RateCardInput = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "CONTRACT",
  carrierName: "Maersk Line",
  mode: "OCEAN",
  origin: "CNSHA",
  destination: "ZADUR",
  containerType: "40HC",
  buyAmountCents: 2350_00, // USD 2,350.00
  currency: "USD",
  transitDays: 28,
  validFrom: new Date("2026-07-01T00:00:00Z"),
  validTo: new Date("2026-09-30T23:59:59Z"),
  surcharges: [
    {
      code: "BAF",
      description: "Bunker adjustment factor",
      basis: "PER_CONTAINER",
      amountCents: 210_00,
      currency: "USD",
    },
    {
      code: "THC-D",
      description: "Terminal handling, Durban",
      basis: "PER_CONTAINER",
      amountCents: 4350_00,
      currency: "ZAR",
    },
    {
      code: "DOC",
      description: "Documentation fee",
      basis: "PER_BL",
      amountCents: 950_00,
      currency: "ZAR",
    },
    {
      code: "EWR",
      description: "Emergency war risk (2% of freight)",
      basis: "PERCENT_OF_FREIGHT",
      amountCents: 200, // basis points
      currency: "USD",
    },
  ],
};

const defaultRule: MarginRuleInput = {
  id: "rule-default",
  customerId: null,
  origin: null,
  destination: null,
  mode: null,
  marginBps: 1800,
  minMarginCents: 1500_00,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const laneRule: MarginRuleInput = {
  id: "rule-lane",
  customerId: null,
  origin: "CNSHA",
  destination: "ZADUR",
  mode: "OCEAN",
  marginBps: 1200,
  minMarginCents: 1000_00,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const request: QuoteRequest = {
  customerId: "22222222-2222-2222-2222-222222222222",
  origin: "CNSHA",
  destination: "ZADUR",
  mode: "OCEAN",
  containerType: "40HC",
  quantity: 2,
  requestedAt: at,
};

describe("margin rule resolution", () => {
  it("prefers the most specific rule (lane+mode beats default)", () => {
    expect(resolveMarginRule([defaultRule, laneRule], request).id).toBe("rule-lane");
  });

  it("breaks a tie between equally specific rules by recency", () => {
    // Two catch-alls is a configuration mistake, but an easy one to make. It
    // used to resolve to whichever row the database returned first, so the
    // same quote could be priced differently on two runs.
    const older: MarginRuleInput = { ...defaultRule, id: "rule-old", marginBps: 1000 };
    const newer: MarginRuleInput = {
      ...defaultRule,
      id: "rule-new",
      marginBps: 2000,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    };
    expect(resolveMarginRule([older, newer], request).id).toBe("rule-new");
    expect(resolveMarginRule([newer, older], request).id).toBe("rule-new");
  });

  it("customer-specific beats lane-specific", () => {
    const customerRule: MarginRuleInput = {
      ...defaultRule,
      id: "rule-customer",
      customerId: request.customerId,
      marginBps: 900,
    };
    expect(resolveMarginRule([defaultRule, laneRule, customerRule], request).id).toBe(
      "rule-customer",
    );
  });

  it("excludes rules whose non-null fields do not match", () => {
    const otherCustomer: MarginRuleInput = {
      ...defaultRule,
      id: "rule-other",
      customerId: "33333333-3333-3333-3333-333333333333",
    };
    expect(resolveMarginRule([otherCustomer, defaultRule], request).id).toBe(
      "rule-default",
    );
  });

  it("throws when nothing matches", () => {
    const otherCustomer: MarginRuleInput = {
      ...defaultRule,
      id: "rule-other",
      customerId: "33333333-3333-3333-3333-333333333333",
    };
    expect(() => resolveMarginRule([otherCustomer], request)).toThrow(
      NoMarginRuleError,
    );
  });
});

describe("rate card selection", () => {
  it("rejects expired cards", () => {
    const expired = {
      ...shaDur,
      validTo: new Date("2026-07-10T00:00:00Z"),
    };
    expect(selectRateCard([expired], request)).toBeNull();
  });

  it("picks the cheapest valid card", () => {
    const cheaper = { ...shaDur, id: "00000000-0000-0000-0000-000000000000", buyAmountCents: 2100_00 };
    expect(selectRateCard([shaDur, cheaper], request)?.id).toBe(cheaper.id);
  });
});

describe("buildQuote", () => {
  it("produces an itemised multicurrency quote with margins applied", () => {
    const quote = buildQuote(request, [shaDur], [defaultRule, laneRule]);

    expect(quote.marginRuleId).toBe("rule-lane"); // 12% lane margin
    expect(quote.lines).toHaveLength(5);

    const freight = quote.lines.find((l) => l.chargeCode === "FRT")!;
    // 235000 * 1.12 = 263200, margin 28200 > min 100000? No: min margin
    // ZAR-denominated floors apply per line; 235000 + 100000 = 335000 wins.
    expect(freight.sellCents).toBe(Math.max(263200, 235000 + 100000));
    expect(freight.quantity).toBe(2);

    const ewr = quote.lines.find((l) => l.chargeCode === "EWR")!;
    expect(ewr.buyCents).toBe(Math.round((2350_00 * 200) / 10_000)); // 2% of freight
    expect(ewr.currency).toBe("USD");

    // Surcharges take the percentage margin only — no absolute floor.
    const baf = quote.lines.find((l) => l.chargeCode === "BAF")!;
    expect(baf.sellCents).toBe(Math.round(210_00 * 1.12));

    const doc = quote.lines.find((l) => l.chargeCode === "DOC")!;
    expect(doc.quantity).toBe(1); // per BL, not per container

    // Totals split by currency, weighted by quantity.
    const usdTotal = quote.lines
      .filter((l) => l.currency === "USD")
      .reduce((sum, l) => sum + l.sellCents * l.quantity, 0);
    expect(quote.totalsByCurrency.USD).toBe(usdTotal);
    expect(Object.keys(quote.totalsByCurrency).sort()).toEqual(["USD", "ZAR"]);
  });

  it("throws NoRateError when no card covers the lane", () => {
    expect(() =>
      buildQuote({ ...request, origin: "DEHAM" }, [shaDur], [defaultRule]),
    ).toThrow(NoRateError);
  });

  it("rejects non-positive quantities", () => {
    expect(() => buildQuote({ ...request, quantity: 0 }, [shaDur], [defaultRule])).toThrow(
      RangeError,
    );
  });

  it("all amounts are integer cents", () => {
    const quote = buildQuote(request, [shaDur], [laneRule]);
    for (const line of quote.lines) {
      expect(Number.isInteger(line.buyCents)).toBe(true);
      expect(Number.isInteger(line.sellCents)).toBe(true);
    }
  });
});
