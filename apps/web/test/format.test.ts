import { afterEach, describe, expect, it, vi } from "vitest";
import { cbm, fmtDate, fmtDay, kg, money, relativeTime } from "@/lib/format";

afterEach(() => vi.useRealTimers());

/**
 * `money` used to delegate to `toLocaleString("en-ZA")`, whose separators
 * depend on the runtime's ICU build — which meant the invoices screen showed
 * `ZAR 8 700,00` in a server-rendered tile and `ZAR 4,500.00` in the table
 * rows beside it. It formats by hand now, so these pin the exact output: a
 * separator that varies between server and client is a hydration mismatch,
 * not a platform choice to be tolerated.
 */
describe("money", () => {
  it("formats identically wherever it runs", () => {
    expect(money(123456, "ZAR")).toBe("ZAR 1,234.56");
    expect(money(870000, "ZAR")).toBe("ZAR 8,700.00");
    expect(money(100, "USD")).toBe("USD 1.00");
  });

  it("groups large amounts every three digits", () => {
    expect(money(123456789012, "USD")).toBe("USD 1,234,567,890.12");
  });

  it("accepts the string cents the API returns for bigint columns", () => {
    expect(money("770000", "USD")).toBe(money(770000, "USD"));
  });

  it("treats a missing amount as zero rather than NaN", () => {
    // A charge with no value must read "0.00", never "NaN" on an invoice.
    expect(money(null, "ZAR")).toBe("ZAR 0.00");
    expect(money(undefined, "ZAR")).toBe("ZAR 0.00");
  });

  it("keeps sub-cent precision out of the output", () => {
    expect(money(1, "USD")).toBe("USD 0.01");
  });

  it("puts the sign before the digits, not inside the grouping", () => {
    // An overpaid invoice shows a negative outstanding balance.
    expect(money(-123456, "ZAR")).toBe("ZAR -1,234.56");
  });
});

describe("fmtDate", () => {
  it("shows an em dash for a missing timestamp", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
  });

  it("includes the date parts of a real timestamp", () => {
    const out = fmtDate("2026-07-15T09:30:00.000Z");
    expect(out).toContain("2026");
    expect(out).toContain("Jul");
    expect(out).toContain("15");
  });
});

describe("relativeTime", () => {
  it("steps through seconds, minutes, hours and days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));

    expect(relativeTime("2026-07-15T11:59:31.000Z")).toBe("29s ago");
    expect(relativeTime("2026-07-15T11:30:00.000Z")).toBe("30m ago");
    expect(relativeTime("2026-07-15T06:00:00.000Z")).toBe("6h ago");
    expect(relativeTime("2026-07-12T12:00:00.000Z")).toBe("3d ago");
  });

  it("shows an em dash for a missing timestamp", () => {
    expect(relativeTime(null)).toBe("—");
  });
});

describe("fmtDay", () => {
  it("formats in UTC with no locale involved", () => {
    // An invoice dated the 1st in Durban must not read as the 31st for someone
    // opening it in São Paulo, and it must read identically on the server, in
    // the browser and in a PDF.
    expect(fmtDay("2026-08-02T00:30:00.000Z")).toBe("02 Aug 2026");
    expect(fmtDay("2026-08-01T23:30:00.000Z")).toBe("01 Aug 2026");
    expect(fmtDay("2026-01-09T12:00:00.000Z")).toBe("09 Jan 2026");
    expect(fmtDay("2026-12-31T23:59:59.000Z")).toBe("31 Dec 2026");
  });

  it("shows an em dash for a missing date", () => {
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay(undefined)).toBe("—");
  });
});

describe("kg and cbm", () => {
  it("groups thousands and fixes the precision", () => {
    expect(kg(8_400_000)).toBe("8,400.0 kg");
    expect(kg(1_260)).toBe("1.3 kg");
    expect(kg(0)).toBe("0.0 kg");
    expect(cbm(40_320_000)).toBe("40.320 m³");
    expect(cbm(0)).toBe("0.000 m³");
  });
});
