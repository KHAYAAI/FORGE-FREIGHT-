import { describe, expect, it } from "vitest";
import { ClassificationService } from "../src/modules/customs/classification.service.js";
import {
  assertTransition,
  computeDutyLine,
  computeEntryTotals,
  InvalidEntryTransitionError,
} from "../src/modules/customs/duty-calculator.js";

describe("duty calculator", () => {
  it("computes duty, ATV upliftment and VAT for a non-SACU import", () => {
    // R100,000 goods at 20% duty: duty R20,000; ATV = 100k + 10k + 20k = 130k;
    // VAT 15% of ATV = R19,500.
    const result = computeDutyLine({
      customsValueCents: 100_000_00,
      dutyRateBps: 2000,
    });
    expect(result.dutyCents).toBe(20_000_00);
    expect(result.atvCents).toBe(130_000_00);
    expect(result.vatCents).toBe(19_500_00);
  });

  it("skips the 10% upliftment for SACU-origin goods", () => {
    const result = computeDutyLine({
      customsValueCents: 100_000_00,
      dutyRateBps: 0,
      sacuOrigin: true,
    });
    expect(result.atvCents).toBe(100_000_00);
    expect(result.vatCents).toBe(15_000_00);
  });

  it("rounds half-up at each statutory step", () => {
    const result = computeDutyLine({ customsValueCents: 333, dutyRateBps: 1500 });
    expect(result.dutyCents).toBe(50); // 49.95 → 50
    expect(Number.isInteger(result.vatCents)).toBe(true);
  });

  it("rejects fractional customs values", () => {
    expect(() =>
      computeDutyLine({ customsValueCents: 100.5, dutyRateBps: 0 }),
    ).toThrow(RangeError);
  });

  it("totals entry lines", () => {
    const a = computeDutyLine({ customsValueCents: 50_000_00, dutyRateBps: 2000 });
    const b = computeDutyLine({ customsValueCents: 30_000_00, dutyRateBps: 0 });
    const totals = computeEntryTotals([a, b]);
    expect(totals.dutiesTotalCents).toBe(a.dutyCents + b.dutyCents);
    expect(totals.vatTotalCents).toBe(a.vatCents + b.vatCents);
  });
});

describe("entry state machine", () => {
  it("allows the happy path DRAFT→PREPARED→SUBMITTED→RELEASED", () => {
    expect(() => {
      assertTransition("DRAFT", "PREPARED");
      assertTransition("PREPARED", "SUBMITTED");
      assertTransition("SUBMITTED", "RELEASED");
    }).not.toThrow();
  });

  it("allows query and stop loops back to submission", () => {
    expect(() => {
      assertTransition("SUBMITTED", "QUERY");
      assertTransition("QUERY", "SUBMITTED");
      assertTransition("SUBMITTED", "STOPPED");
      assertTransition("STOPPED", "SUBMITTED");
    }).not.toThrow();
  });

  it("blocks illegal jumps", () => {
    expect(() => assertTransition("DRAFT", "RELEASED")).toThrow(
      InvalidEntryTransitionError,
    );
    expect(() => assertTransition("RELEASED", "SUBMITTED")).toThrow(
      InvalidEntryTransitionError,
    );
  });
});

describe("HS classification", () => {
  const service = new ClassificationService({ TARIFF_CSV_PATH: "" } as never);

  it("finds the right heading for a clear description", () => {
    const [top] = service.classify("2000 cotton t-shirts, knitted");
    expect(top!.hsCode).toBe("6109.10");
    expect(top!.confidence).toBeGreaterThan(0);
  });

  it("returns multiple ranked candidates", () => {
    const candidates = service.classify("leather shoes and sneakers");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]!.hsCode).toBe("6403.99");
  });

  it("returns nothing for unclassifiable text", () => {
    expect(service.classify("xyzzy")).toEqual([]);
  });
});
