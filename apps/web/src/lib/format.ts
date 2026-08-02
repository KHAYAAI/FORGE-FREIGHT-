/** Pure formatting helpers — safe to import from client components. */

/**
 * Money, formatted the same everywhere.
 *
 * Deliberately not `toLocaleString`: the separators it picks for `en-ZA`
 * depend on which ICU data the runtime was built with, and Node and Chromium
 * do not agree. The invoices screen rendered its server-side total as
 * `ZAR 8 700,00` and the table rows beside it as `ZAR 4,500.00` — the same
 * function, the same page, two currencies' worth of visual difference, plus a
 * hydration mismatch on anything rendered both ways.
 *
 * Thousands are grouped with a comma and cents follow a full stop, which is
 * what SARS and every South African bank statement use.
 */
export function money(cents: number | string | null | undefined, currency: string): string {
  const n = Number(cents ?? 0) / 100;
  const sign = n < 0 ? "-" : "";
  const fixed = Math.abs(n).toFixed(2);
  const [whole = "0", fraction = "00"] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${sign}${grouped}.${fraction}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A date, with no time and no locale.
 *
 * `fmtDate` goes through ICU, which is fine for a screen where the exact
 * separator does not matter. It is not fine on an invoice: the document is
 * printed, filed and quoted back months later, and it has to read identically
 * whether it was rendered on the server, in the browser, or into a PDF.
 * Formatted in UTC for the same reason — an invoice dated the 1st in Durban
 * must not become the 31st for a reader in São Paulo.
 */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Kilograms from grams, one decimal, no locale. */
export function kg(grams: number): string {
  const n = grams / 1000;
  const [whole = "0", frac = "0"] = n.toFixed(1).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac} kg`;
}

/** Cubic metres from cubic centimetres, three decimals, no locale. */
export function cbm(cm3: number): string {
  return `${(cm3 / 1_000_000).toFixed(3)} m³`;
}
