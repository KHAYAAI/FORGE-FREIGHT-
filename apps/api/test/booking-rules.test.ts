import { describe, expect, it } from "vitest";
import {
  assertBookable,
  planLegs,
  QuoteNotBookableError,
} from "../src/modules/bookings/booking-rules.js";

const now = new Date("2026-07-15T12:00:00Z");
const baseQuote = {
  id: "q1",
  tenantId: "t1",
  status: "ISSUED" as const,
  validUntil: new Date("2026-07-29T00:00:00Z"),
};

describe("assertBookable", () => {
  it("allows an issued, unexpired quote", () => {
    expect(() => assertBookable(baseQuote, now)).not.toThrow();
  });

  it("allows an already-accepted quote (idempotent accept path)", () => {
    expect(() => assertBookable({ ...baseQuote, status: "ACCEPTED" }, now)).not.toThrow();
  });

  it.each(["DECLINED", "EXPIRED", "DRAFT"] as const)("rejects %s quotes", (status) => {
    expect(() => assertBookable({ ...baseQuote, status }, now)).toThrow(
      QuoteNotBookableError,
    );
  });

  it("rejects quotes past their validity date", () => {
    expect(() =>
      assertBookable({ ...baseQuote, validUntil: new Date("2026-07-01T00:00:00Z") }, now),
    ).toThrow(/expired/);
  });
});

describe("planLegs", () => {
  it("plans a single leg in the quoted mode", () => {
    expect(
      planLegs({ origin: "CNSHA", destination: "ZADUR", mode: "OCEAN" }),
    ).toEqual([{ sequence: 1, mode: "OCEAN", origin: "CNSHA", destination: "ZADUR" }]);
  });
});
