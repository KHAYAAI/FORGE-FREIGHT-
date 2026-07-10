import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TARIFF_EXTRACT } from "../src/modules/customs/tariff-data.js";
import { loadTariffBook, parseTariffCsv } from "../src/modules/customs/tariff-loader.js";

describe("tariff loader", () => {
  it("returns the built-in extract when no CSV path is given", () => {
    const book = loadTariffBook(null);
    expect(book).toHaveLength(TARIFF_EXTRACT.length);
  });

  it("parses a simple CSV row", () => {
    const rows = parseTariffCsv(
      "hsCode,description,keywords,generalRateBps\n" +
        "1234.56,Widgets of steel,widget;steel,1500\n",
    );
    expect(rows).toEqual([
      { hsCode: "1234.56", description: "Widgets of steel", keywords: ["widget", "steel"], generalRateBps: 1500 },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseTariffCsv(
      'hsCode,description,keywords,generalRateBps\n' +
        '9999.99,"Widgets, deluxe edition",widget,0\n',
    );
    expect(rows[0]!.description).toBe("Widgets, deluxe edition");
  });

  it("rejects a CSV missing required columns", () => {
    expect(() => parseTariffCsv("hsCode,description\n1234.56,Widgets\n")).toThrow(
      /generalRateBps/,
    );
  });

  it("rejects a malformed data row", () => {
    expect(() =>
      parseTariffCsv("hsCode,description,generalRateBps\n1234.56,,notanumber\n"),
    ).toThrow(/malformed/);
  });

  describe("with a real CSV file", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "tariff-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("overrides a built-in line by hsCode and keeps everything else", () => {
      const existing = TARIFF_EXTRACT[0]!;
      const csvPath = join(dir, "tariff.csv");
      writeFileSync(
        csvPath,
        `hsCode,description,keywords,generalRateBps\n${existing.hsCode},Overridden description,override,9999\n`,
      );

      const book = loadTariffBook(csvPath);
      expect(book).toHaveLength(TARIFF_EXTRACT.length);
      const overridden = book.find((l) => l.hsCode === existing.hsCode);
      expect(overridden?.description).toBe("Overridden description");
      expect(overridden?.generalRateBps).toBe(9999);
    });

    it("adds a new heading not present in the built-in extract", () => {
      const csvPath = join(dir, "tariff.csv");
      writeFileSync(
        csvPath,
        "hsCode,description,keywords,generalRateBps\n0000.00,Brand new heading,new,100\n",
      );

      const book = loadTariffBook(csvPath);
      expect(book).toHaveLength(TARIFF_EXTRACT.length + 1);
      expect(book.some((l) => l.hsCode === "0000.00")).toBe(true);
    });

    it("throws when TARIFF_CSV_PATH points at a nonexistent file", () => {
      expect(() => loadTariffBook(join(dir, "missing.csv"))).toThrow(/does not exist/);
    });
  });
});
