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
