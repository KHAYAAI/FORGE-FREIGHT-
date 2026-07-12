"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import { money } from "@/lib/format";
import type { Party } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, TR, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

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

const CONTAINER_TYPES = ["20GP", "40GP", "40HC", "45HC", "20RF", "40RF", "LCL"];
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const MODES = ["OCEAN", "AIR", "ROAD", "RAIL"];

export function QuoteForm({ parties }: { parties: Party[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    customerId: parties[0]?.id ?? "",
    origin: "CNSHA",
    destination: "ZADUR",
    mode: "OCEAN",
    containerType: "40HC",
    quantity: 2,
    incoterm: "FOB",
  });
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [booking, setBooking] = useState<{ reference: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"quote" | "book" | null>(null);

  async function getQuote() {
    setBusy("quote");
    setError(null);
    setBooking(null);
    setQuote(null);
    try {
      const result = await clientApi.createQuote(form);
      setQuote(result);
      toast.success("Quote generated", `${result.result.carrierName} — ${result.result.lines.length} line item(s).`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast.error("Failed to generate quote", message);
    } finally {
      setBusy(null);
    }
  }

  async function book() {
    if (!quote) return;
    setBusy("book");
    setError(null);
    try {
      const result = await clientApi.bookQuote(quote.quoteId);
      setBooking({ reference: result.reference, id: result.id });
      toast.success("Shipment booked", `Reference ${result.reference}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast.error("Failed to book quote", message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Panel className="lg:col-span-2">
        <PanelHeader title="Quote parameters" />
        <div className="flex flex-col gap-4">
          <Field label="Customer" required>
            <Select
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="" disabled>
                Select a party…
              </option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Origin" required hint="UN/LOCODE">
              <Input
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value.toUpperCase() })}
                className="font-mono"
                maxLength={5}
              />
            </Field>
            <Field label="Destination" required hint="UN/LOCODE">
              <Input
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value.toUpperCase() })}
                className="font-mono"
                maxLength={5}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode">
              <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Incoterm">
              <Select
                value={form.incoterm}
                onChange={(e) => setForm({ ...form, incoterm: e.target.value })}
              >
                {INCOTERMS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Container type">
              <Select
                value={form.containerType}
                onChange={(e) => setForm({ ...form, containerType: e.target.value })}
              >
                {CONTAINER_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              />
            </Field>
          </div>

          {error && (
            <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={getQuote}
            disabled={busy !== null || !form.customerId}
          >
            {busy === "quote" ? "Pricing…" : "Generate quote"}
          </Button>
        </div>
      </Panel>

      <Panel className="lg:col-span-3">
        <PanelHeader
          title="Itemised quote"
          eyebrow={quote ? quote.result.carrierName : undefined}
        />
        {!quote && (
          <div className="flex h-64 items-center justify-center text-[12.5px] text-tertiary">
            Fill in the parameters and generate a quote to see pricing.
          </div>
        )}
        {quote && (
          <div>
            {quote.result.transitDays != null && (
              <div className="mb-3 text-[12px] text-secondary">
                Estimated transit: <span className="text-primary">{quote.result.transitDays} days</span>
              </div>
            )}
            <Table>
              <tbody>
                {quote.result.lines.map((line) => (
                  <TR key={line.chargeCode}>
                    <TD className="text-secondary">{line.description}</TD>
                    <TD align="right" className="tabular">
                      {line.quantity} × {money(line.sellCents, line.currency)}
                    </TD>
                  </TR>
                ))}
                {Object.entries(quote.result.totalsByCurrency).map(([currency, total]) => (
                  <TR key={currency} className="hover:bg-transparent">
                    <TD className="font-semibold text-primary">Total ({currency})</TD>
                    <TD align="right" className="tabular text-[15px] font-semibold text-accent-strong">
                      {money(total, currency)}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>

            <div className="mt-5 flex items-center gap-3">
              {!booking ? (
                <Button variant="success" size="lg" onClick={book} disabled={busy !== null}>
                  {busy === "book" ? "Booking…" : "Book this quote"}
                </Button>
              ) : (
                <div className="flex items-center gap-3 rounded border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-success-wash px-4 py-2.5">
                  <span className="text-[12.5px] font-medium text-success">
                    Booked — shipment {booking.reference}
                  </span>
                  <button
                    onClick={() => router.push(`/shipments/${booking.id}`)}
                    className="text-[11.5px] font-semibold text-accent hover:underline"
                  >
                    View shipment →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
