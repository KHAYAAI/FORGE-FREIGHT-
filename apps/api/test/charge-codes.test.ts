import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  CHARGE_CODES,
  CHARGE_CODE_BY_CODE,
  normaliseChargeCode,
  normaliseKey,
} from "../src/modules/billing/charge-codes.js";

/**
 * The taxonomy is a lookup table, and a lookup table's failure mode is silent:
 * two codes claiming one alias resolves to whichever came first, and nothing
 * anywhere complains. These tests are what makes that loud.
 */

describe("the code list itself", () => {
  it("has no duplicate codes", () => {
    const codes = CHARGE_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has no alias claimed by two different codes", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const def of CHARGE_CODES) {
      for (const alias of [def.code, def.label, ...def.aliases]) {
        const key = normaliseKey(alias);
        const prior = owner.get(key);
        if (prior && prior !== def.code) collisions.push(`${alias}: ${prior} vs ${def.code}`);
        owner.set(key, def.code);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("uses only categories the invoice knows how to render", () => {
    for (const def of CHARGE_CODES) {
      expect(CATEGORY_ORDER).toContain(def.category);
    }
  });

  it("keeps MSC as the fallback, so normalisation can never fail", () => {
    expect(CHARGE_CODE_BY_CODE.has("MSC")).toBe(true);
  });

  it("marks the three high-error categories the trade actually disputes", () => {
    // Fuel, destination terminal handling and documentation: least AP
    // scrutiny, most forwarder discretion. If someone downgrades these the
    // audit stops looking where the money is.
    expect(CHARGE_CODE_BY_CODE.get("BAF")!.errorRate).toBe("HIGH");
    expect(CHARGE_CODE_BY_CODE.get("THC")!.errorRate).toBe("HIGH");
    expect(CHARGE_CODE_BY_CODE.get("DOC")!.errorRate).toBe("HIGH");
  });

  it("keeps duty and import VAT outside the scope of VAT", () => {
    // Charging VAT on a recovered statutory amount overstates the invoice and
    // the issuer's output tax at the same time.
    expect(CHARGE_CODE_BY_CODE.get("DTY")!.taxable).toBe(false);
    expect(CHARGE_CODE_BY_CODE.get("VAT")!.taxable).toBe(false);
  });
});

describe("normalising what a vendor wrote", () => {
  it("matches the canonical code exactly", () => {
    const r = normaliseChargeCode("THC");
    expect(r.code).toBe("THC");
    expect(r.match).toBe("exact");
  });

  it("collapses the vendor dialects for origin handling onto one code", () => {
    for (const spelling of ["OHC", "OTHC", "Origin Handling", "ORIG.HANDLING CHG", "origin terminal handling"]) {
      expect(normaliseChargeCode(spelling).code).toBe("OHC");
    }
  });

  it("treats punctuation and case as noise", () => {
    expect(normaliseChargeCode("  b/l fee ").code).toBe("DOC");
    expect(normaliseChargeCode("B.L. FEE").code).toBe("DOC");
  });

  it("folds every fuel spelling into the surcharge family", () => {
    expect(normaliseChargeCode("Bunker Adjustment").def.category).toBe("FUEL_SURCHARGE");
    expect(normaliseChargeCode("Low Sulphur").code).toBe("BAF");
    expect(normaliseChargeCode("EMERGENCY FUEL").code).toBe("EBS");
  });

  it("falls back to Other rather than dropping an unknown line", () => {
    // Dropping the line loses money; refusing the invoice stops the forwarder
    // billing at all. Visible fallback is the only option that does neither.
    const r = normaliseChargeCode("XYZ SPECIAL RECOVERY");
    expect(r.code).toBe("MSC");
    expect(r.match).toBe("fallback");
  });

  it("survives empty and junk input", () => {
    expect(normaliseChargeCode("").code).toBe("MSC");
    expect(normaliseChargeCode("!!!").code).toBe("MSC");
  });

  it("lets a tenant's own mapping beat the built-in list", () => {
    // A forwarder's vendors speak dialects nobody else's do. "HANDLING" is
    // origin handling to this tenant and nothing in particular by default.
    const tenant = new Map([[normaliseKey("HANDLING"), "OHC"]]);
    expect(normaliseChargeCode("Handling", tenant).code).toBe("OHC");
    expect(normaliseChargeCode("Handling").code).toBe("MSC");
  });

  it("ignores a tenant mapping that points at a code that does not exist", () => {
    const tenant = new Map([[normaliseKey("WHATEVER"), "NOT_A_CODE"]]);
    expect(normaliseChargeCode("WHATEVER", tenant).code).toBe("MSC");
  });
});
