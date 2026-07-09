"use client";

import { useState } from "react";
import { apiPost, money } from "@/lib/api";

interface QuoteLine {
  chargeCode: string;
  description: string;
  quantity: number;
  sellCents: number;
  currency: string;
}

interface QuoteResponse {
  quoteId: string;
  result: {
    carrierName: string;
    transitDays: number | null;
    lines: QuoteLine[];
    totalsByCurrency: Record<string, number>;
  };
}

const inputStyle = {
  padding: "0.5rem",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  width: "100%",
} as const;

/** The demo that wins customers: itemised quote in seconds, book in one click. */
export default function NewQuotePage() {
  const [form, setForm] = useState({
    customerId: "",
    origin: "CNSHA",
    destination: "ZADUR",
    mode: "OCEAN",
    containerType: "40HC",
    quantity: 2,
    incoterm: "FOB",
  });
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [booking, setBooking] = useState<{ reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function getQuote() {
    setBusy(true);
    setError(null);
    setBooking(null);
    try {
      setQuote(await apiPost<QuoteResponse>("/quotes", form));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      setBooking(await apiPost<{ reference: string }>(`/quotes/${quote.quoteId}/book`, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Instant quote</h1>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr 1fr" }}>
        <label>
          Customer ID
          <input
            style={inputStyle}
            value={form.customerId}
            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            placeholder="party uuid"
          />
        </label>
        <label>
          Incoterm
          <select
            style={inputStyle}
            value={form.incoterm}
            onChange={(e) => setForm({ ...form, incoterm: e.target.value })}
          >
            {["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Origin (UN/LOCODE)
          <input
            style={inputStyle}
            value={form.origin}
            onChange={(e) => setForm({ ...form, origin: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          Destination
          <input
            style={inputStyle}
            value={form.destination}
            onChange={(e) => setForm({ ...form, destination: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          Container type
          <select
            style={inputStyle}
            value={form.containerType}
            onChange={(e) => setForm({ ...form, containerType: e.target.value })}
          >
            {["20GP", "40GP", "40HC", "45HC", "20RF", "40RF"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
          />
        </label>
      </div>
      <button
        onClick={getQuote}
        disabled={busy || !form.customerId}
        style={{
          marginTop: "1rem",
          padding: "0.6rem 1.5rem",
          background: "#2563eb",
          color: "white",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {busy ? "Working…" : "Get quote"}
      </button>

      {error && <p style={{ color: "#dc2626", whiteSpace: "pre-wrap" }}>{error}</p>}

      {quote && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>
            {quote.result.carrierName}
            {quote.result.transitDays != null && ` · ~${quote.result.transitDays} days`}
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {quote.result.lines.map((line) => (
                <tr key={line.chargeCode} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "0.4rem 0" }}>{line.description}</td>
                  <td style={{ textAlign: "right" }}>
                    {line.quantity} × {money(line.sellCents, line.currency)}
                  </td>
                </tr>
              ))}
              {Object.entries(quote.result.totalsByCurrency).map(([currency, total]) => (
                <tr key={currency}>
                  <td style={{ paddingTop: "0.5rem" }}>
                    <strong>Total ({currency})</strong>
                  </td>
                  <td style={{ textAlign: "right", paddingTop: "0.5rem" }}>
                    <strong>{money(total, currency)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!booking && (
            <button
              onClick={book}
              disabled={busy}
              style={{
                marginTop: "1rem",
                padding: "0.6rem 1.5rem",
                background: "#16a34a",
                color: "white",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Book this quote
            </button>
          )}
          {booking && (
            <p style={{ color: "#16a34a", fontWeight: 600 }}>
              Booked — shipment {booking.reference}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
