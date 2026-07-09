"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { clientApi } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";

interface DraftLine {
  description: string;
  customsValueCents: string;
  hsCode: string;
  sacuOrigin: boolean;
}

const EMPTY_LINE: DraftLine = { description: "", customsValueCents: "", hsCode: "", sacuOrigin: false };

export function CreateEntryForm() {
  const router = useRouter();
  const [shipmentId, setShipmentId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await clientApi.createEntry({
        shipmentId: shipmentId.trim(),
        lines: lines.map((l) => ({
          description: l.description,
          customsValueCents: Math.round(Number(l.customsValueCents) * 100),
          hsCode: l.hsCode.trim() || undefined,
          sacuOrigin: l.sacuOrigin,
        })),
      });
      router.push(`/customs/${entry.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="New customs entry" eyebrow="Draft" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Shipment ID" required hint="UUID — copy from the shipment page URL.">
          <Input
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            placeholder="uuid"
            className="font-mono text-[12px]"
            required
          />
        </Field>

        <div className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <div key={i} className="rounded border border-hairline p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                Line {i + 1}
              </div>
              <div className="flex flex-col gap-2.5">
                <Field label="Description" required>
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="e.g. 2000 cotton t-shirts"
                    required
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Customs value" hint="ZAR, decimal">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.customsValueCents}
                      onChange={(e) => updateLine(i, { customsValueCents: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="HS code" hint="Optional — leave blank to classify later">
                    <Input
                      value={line.hsCode}
                      onChange={(e) => updateLine(i, { hsCode: e.target.value })}
                      placeholder="6204.62.00"
                      className="font-mono"
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-secondary">
                  <input
                    type="checkbox"
                    checked={line.sacuOrigin}
                    onChange={(e) => updateLine(i, { sacuOrigin: e.target.checked })}
                  />
                  SACU origin (no ATV uplift)
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
          >
            + Add line
          </Button>
          {lines.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLines((prev) => prev.slice(0, -1))}
            >
              Remove last
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
            {error}
          </div>
        )}

        <Button type="submit" variant="primary" disabled={busy || !shipmentId.trim()}>
          {busy ? "Creating…" : "Create entry"}
        </Button>
      </form>
    </Panel>
  );
}
