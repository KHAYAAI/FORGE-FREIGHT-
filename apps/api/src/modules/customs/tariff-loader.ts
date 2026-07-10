import { existsSync, readFileSync } from "node:fs";
import { TARIFF_EXTRACT, type TariffLine } from "./tariff-data.js";

/**
 * Loads the working tariff book: the built-in reference extract, optionally
 * overridden line-by-line by a CSV of the real gazetted schedule (exported
 * from SARS eFiling or a licensed tariff data provider). Set
 * TARIFF_CSV_PATH to enable it — this is the seam that turns the starter
 * dataset into production tariff data without a code change.
 *
 * CSV columns: hsCode,description,keywords,generalRateBps
 * keywords is semicolon-separated within its field. Fields may be quoted
 * with double quotes (RFC 4180-style) if they contain a comma.
 */
export function loadTariffBook(csvPath: string | null | undefined): TariffLine[] {
  const byCode = new Map(TARIFF_EXTRACT.map((line) => [line.hsCode, line]));

  if (csvPath) {
    if (!existsSync(csvPath)) {
      throw new Error(`TARIFF_CSV_PATH is set to '${csvPath}' but the file does not exist`);
    }
    for (const line of parseTariffCsv(readFileSync(csvPath, "utf8"))) {
      byCode.set(line.hsCode, line);
    }
  }

  return Array.from(byCode.values());
}

export function parseTariffCsv(csv: string): TariffLine[] {
  const rows = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  const columns = splitCsvRow(header!).map((c) => c.trim().toLowerCase());
  const hsCodeIdx = columns.indexOf("hscode");
  const descriptionIdx = columns.indexOf("description");
  const keywordsIdx = columns.indexOf("keywords");
  const rateIdx = columns.indexOf("generalratebps");

  if (hsCodeIdx === -1 || descriptionIdx === -1 || rateIdx === -1) {
    throw new Error(
      "Tariff CSV must have hsCode, description, and generalRateBps columns (keywords optional)",
    );
  }

  return dataRows.map((row, i) => {
    const cells = splitCsvRow(row);
    const hsCode = cells[hsCodeIdx]?.trim();
    const description = cells[descriptionIdx]?.trim();
    const rate = Number(cells[rateIdx]?.trim());
    if (!hsCode || !description || Number.isNaN(rate)) {
      throw new Error(`Tariff CSV row ${i + 2} is malformed: ${row}`);
    }
    const keywords =
      keywordsIdx !== -1
        ? (cells[keywordsIdx] ?? "")
            .split(";")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean)
        : [];
    return { hsCode, description, keywords, generalRateBps: rate };
  });
}

function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (inQuotes) {
      if (char === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
