import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtDate, money, relativeTime } from "@/lib/format";

afterEach(() => vi.useRealTimers());

/**
 * `money` delegates to `toLocaleString("en-ZA")`, whose separators depend on
 * the runtime's ICU data - en-ZA renders decimals with a comma on some builds
 * and a period on others. These assert the invariants that actually matter on
 * an invoice (currency prefix, exactly two fraction digits, never NaN) rather
 * than pinning a separator the platform is entitled to choose.
 */
const TWO_DECIMALS = /^[A-Z]{3} [\d\s\u00a0\u202f,.]*\d[.,]\d{2}$/;

describe("money", () => {
  it("renders cents as a two-decimal amount with its currency", () => {
    const out = money(123456, "ZAR");
    expect(out).toMatch(TWO_DECIMALS);
    expect(out.startsWith("ZAR ")).toBe(true);
    expect(out).toMatch(/1[\s\u00a0\u202f,.]?234/);
  });

  it("accepts the string cents the API returns for bigint columns", () => {
    expect(money("770000", "USD")).toBe(money(770000, "USD"));
  });

  it("treats a missing amount as zero rather than NaN", () => {
    // A charge with no value must read "0.00", never "NaN" on an invoice.
    expect(money(null, "ZAR")).toMatch(/^ZAR 0[.,]00$/);
    expect(money(undefined, "ZAR")).toMatch(/^ZAR 0[.,]00$/);
    expect(money(null, "ZAR")).not.toContain("NaN");
  });

  it("keeps sub-cent precision out of the output", () => {
    expect(money(1, "USD")).toMatch(/^USD 0[.,]01$/);
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
