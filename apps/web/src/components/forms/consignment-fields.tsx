"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clientApi, type CargoItemDraft, type ConsignmentDraft } from "@/lib/client-api";
import { Field, Input, Select } from "@/components/ui/field";
import { Tag } from "@/components/ui/badge";
import type { ConsignmentReference, Measurement } from "@/lib/types";

const PACKAGE_TYPES: { code: string; label: string }[] = [
  { code: "PALLET", label: "Pallet" },
  { code: "CARTON", label: "Carton" },
  { code: "CRATE", label: "Crate" },
  { code: "DRUM", label: "Drum" },
  { code: "BAG", label: "Bag / sack" },
  { code: "BALE", label: "Bale" },
  { code: "ROLL", label: "Roll" },
  { code: "IBC", label: "IBC tote" },
  { code: "BULK", label: "Bulk / unpackaged" },
  { code: "LOOSE", label: "Loose pieces" },
];

const CARGO_TYPES = [
  { code: "GENERAL", label: "General cargo" },
  { code: "HAZARDOUS", label: "Hazardous / dangerous goods" },
  { code: "REEFER", label: "Temperature controlled" },
  { code: "PERISHABLE", label: "Perishable" },
  { code: "OVERSIZED", label: "Oversized / out of gauge" },
  { code: "VALUABLE", label: "High value" },
  { code: "LIVE_ANIMALS", label: "Live animals" },
];

const URGENCIES = [
  { code: "ECONOMY", label: "Economy — cheapest routing" },
  { code: "STANDARD", label: "Standard — best value" },
  { code: "EXPRESS", label: "Express — priority space" },
  { code: "CRITICAL", label: "Critical — first available" },
];

export function emptyCargoItem(): CargoItemDraft {
  return {
    description: "",
    packageType: "PALLET",
    pieces: 1,
    grossWeightGrams: 0,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    stackable: true,
  };
}

export function emptyConsignment(origin = "", destination = ""): ConsignmentDraft {
  return {
    description: "",
    cargoType: "GENERAL",
    urgency: "STANDARD",
    portOfExit: origin,
    portOfEntry: destination,
    items: [emptyCargoItem()],
  };
}

const kg = (grams: number) => grams / 1000;
const m3 = (cm3: number) => cm3 / 1_000_000;
const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * The cargo capture block.
 *
 * Everything here is entered in the units a shipper reads off a packing list —
 * kilograms and centimetres — and converted to the grams and millimetres the
 * API stores, because integers are what keep a chargeable weight from becoming
 * a rounding argument with a carrier.
 */
export function ConsignmentFields({
  value,
  onChange,
  mode,
  reference,
}: {
  value: ConsignmentDraft;
  onChange: (next: ConsignmentDraft) => void;
  mode: string;
  reference?: ConsignmentReference | null;
}) {
  const [measure, setMeasure] = useState<Measurement | null>(null);
  const [measuring, setMeasuring] = useState(false);

  const set = <K extends keyof ConsignmentDraft>(key: K, v: ConsignmentDraft[K]) =>
    onChange({ ...value, [key]: v });

  const setItem = (i: number, patch: Partial<CargoItemDraft>) =>
    onChange({ ...value, items: value.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const ready = useMemo(
    () =>
      value.items.length > 0 &&
      value.items.every((i) => i.pieces > 0 && i.grossWeightGrams > 0) &&
      /^[A-Z]{2}[A-Z0-9]{3}$/.test(value.portOfExit) &&
      /^[A-Z]{2}[A-Z0-9]{3}$/.test(value.portOfEntry) &&
      value.portOfExit !== value.portOfEntry &&
      value.description.trim().length > 0,
    [value],
  );

  const runMeasure = useCallback(async () => {
    if (!ready) return setMeasure(null);
    setMeasuring(true);
    try {
      setMeasure(await clientApi.measureConsignment({ ...value, mode }));
    } catch {
      // A failed measurement is not an error the shipper needs to see mid-typing;
      // the same rules run again on submit, where the message has somewhere to go.
      setMeasure(null);
    } finally {
      setMeasuring(false);
    }
  }, [ready, value, mode]);

  // Debounced so the totals track typing without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(runMeasure, 400);
    return () => clearTimeout(t);
  }, [runMeasure]);

  const cargoUplift = reference?.cargoTypes.find((c) => c.code === value.cargoType)?.upliftBps ?? 0;
  const service = reference?.urgencies.find((u) => u.code === value.urgency);

  return (
    <div className="flex flex-col gap-4">
      {/* --------------------------------------------------------- goods -- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <Field label="Description of goods" required hint="As it will read on the bill of lading.">
            <Input
              value={value.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Cotton knitted T-shirts, printed — retail distribution"
              required
            />
          </Field>
        </div>

        <Field label="Type of cargo" required hint={cargoUplift ? `Handling uplift ${(cargoUplift / 100).toFixed(0)}%` : "No handling uplift"}>
          <Select value={value.cargoType} onChange={(e) => set("cargoType", e.target.value)}>
            {CARGO_TYPES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="Urgency"
          required
          hint={
            service?.maxTransitDays
              ? `Carriers over ${service.maxTransitDays} days transit are excluded`
              : "Any transit time"
          }
        >
          <Select value={value.urgency} onChange={(e) => set("urgency", e.target.value)}>
            {URGENCIES.map((u) => (
              <option key={u.code} value={u.code}>{u.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Port of exit" required hint="UN/LOCODE the goods leave through.">
          <Input
            value={value.portOfExit}
            onChange={(e) => set("portOfExit", e.target.value.toUpperCase())}
            placeholder="ZADUR"
            maxLength={5}
            className="font-mono"
            required
          />
        </Field>
      </div>

      {/* ------------------------------------------- hazardous / reefer -- */}
      {value.cargoType === "HAZARDOUS" && (
        <div className="rounded border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-wash p-3">
          <p className="mb-3 text-[11.5px] text-warning">
            Dangerous goods cannot be booked without a complete declaration — this is what a
            terminal turns a container away for.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="UN number" required>
              <Input
                value={value.unNumber ?? ""}
                onChange={(e) => set("unNumber", e.target.value.toUpperCase() || null)}
                placeholder="UN1263"
                className="font-mono"
              />
            </Field>
            <Field label="IMO class" required>
              <Input
                value={value.imoClass ?? ""}
                onChange={(e) => set("imoClass", e.target.value || null)}
                placeholder="3"
                className="font-mono"
              />
            </Field>
            <Field label="Packing group" required>
              <Select
                value={value.packingGroup ?? ""}
                onChange={(e) => set("packingGroup", e.target.value || null)}
              >
                <option value="">Select…</option>
                <option value="I">I — high danger</option>
                <option value="II">II — medium danger</option>
                <option value="III">III — low danger</option>
              </Select>
            </Field>
          </div>
        </div>
      )}

      {(value.cargoType === "REEFER" || value.cargoType === "PERISHABLE") && (
        <div className="rounded border border-hairline bg-inset p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Min temperature" hint="°C">
              <Input
                type="number"
                step="0.1"
                value={value.tempMinDeciC == null ? "" : value.tempMinDeciC / 10}
                onChange={(e) =>
                  set("tempMinDeciC", e.target.value === "" ? null : Math.round(Number(e.target.value) * 10))
                }
                placeholder="-18.0"
              />
            </Field>
            <Field label="Max temperature" hint="°C">
              <Input
                type="number"
                step="0.1"
                value={value.tempMaxDeciC == null ? "" : value.tempMaxDeciC / 10}
                onChange={(e) =>
                  set("tempMaxDeciC", e.target.value === "" ? null : Math.round(Number(e.target.value) * 10))
                }
                placeholder="-16.0"
              />
            </Field>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- pickup -- */}
      <div>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
          Collection
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Pick-up point" hint="Blank if the shipper delivers to port.">
            <Input
              value={value.pickupLocode ?? ""}
              onChange={(e) => set("pickupLocode", e.target.value.toUpperCase() || null)}
              placeholder="ZAJNB"
              maxLength={5}
              className="font-mono"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Collection address">
              <Input
                value={value.pickupAddress ?? ""}
                onChange={(e) => set("pickupAddress", e.target.value || null)}
                placeholder="Unit 4, Isando Industrial Park, Kempton Park"
              />
            </Field>
          </div>
          <Field label="Site contact">
            <Input
              value={value.pickupContact ?? ""}
              onChange={(e) => set("pickupContact", e.target.value || null)}
              placeholder="Name and number"
            />
          </Field>
        </div>
      </div>

      {/* -------------------------------------------------- packing list -- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            Packing list
          </span>
          <span className="text-[11px] text-tertiary">
            Weight is the line total; dimensions are per piece.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {value.items.map((item, i) => (
            <div key={i} className="rounded border border-hairline bg-inset p-3">
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-12">
                <div className="md:col-span-3">
                  <Field label="Contents" required>
                    <Input
                      value={item.description}
                      onChange={(e) => setItem(i, { description: e.target.value })}
                      placeholder="Cartons of printed T-shirts"
                      required
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Packaging" required>
                    <Select
                      value={item.packageType}
                      onChange={(e) => setItem(i, { packageType: e.target.value })}
                    >
                      {PACKAGE_TYPES.map((p) => (
                        <option key={p.code} value={p.code}>{p.label}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Pieces" required>
                    <Input
                      type="number"
                      min={1}
                      value={item.pieces || ""}
                      onChange={(e) => setItem(i, { pieces: Number(e.target.value) || 0 })}
                      required
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Weight" required hint="kg, line total">
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={item.grossWeightGrams ? kg(item.grossWeightGrams) : ""}
                      onChange={(e) =>
                        setItem(i, { grossWeightGrams: Math.round(Number(e.target.value || 0) * 1000) })
                      }
                      required
                    />
                  </Field>
                </div>
                <div className="md:col-span-3">
                  <Field label="L × W × H" hint="cm, per piece">
                    <div className="flex items-center gap-1">
                      {(["lengthMm", "widthMm", "heightMm"] as const).map((dim) => (
                        <Input
                          key={dim}
                          type="number"
                          min={0}
                          value={item[dim] == null ? "" : item[dim]! / 10}
                          onChange={(e) =>
                            setItem(i, {
                              [dim]: e.target.value === "" ? null : Math.round(Number(e.target.value) * 10),
                            } as Partial<CargoItemDraft>)
                          }
                          className="px-2"
                        />
                      ))}
                    </div>
                  </Field>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-[11.5px] text-secondary">
                  <input
                    type="checkbox"
                    checked={item.stackable}
                    onChange={(e) => setItem(i, { stackable: e.target.checked })}
                  />
                  Stackable
                </label>
                <input
                  className="flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-[11.5px] text-primary placeholder:text-tertiary"
                  value={item.marksAndNumbers ?? ""}
                  onChange={(e) => setItem(i, { marksAndNumbers: e.target.value || null })}
                  placeholder="Shipping marks (optional)"
                />
                {value.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, items: value.items.filter((_, j) => j !== i) })}
                    className="text-[11.5px] font-medium text-critical hover:underline"
                  >
                    Remove line
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...value, items: [...value.items, emptyCargoItem()] })}
          className="mt-2 text-[11.5px] font-medium text-accent hover:underline"
        >
          + Add another line
        </button>
      </div>

      {/* ------------------------------------------------------- totals -- */}
      <div className="rounded border border-hairline bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            What the carrier will bill
          </span>
          {measuring && <span className="text-[11px] text-tertiary">calculating…</span>}
        </div>

        {measure ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Total label="Pieces" value={String(measure.pieces)} />
              <Total label="Gross weight" value={`${fmt(kg(measure.grossWeightGrams), 1)} kg`} />
              <Total label="Volume" value={`${fmt(m3(measure.volumeCm3), 3)} m³`} />
              <Total
                label="Chargeable"
                value={`${fmt(kg(measure.chargeableWeightGrams), 1)} kg`}
                accent
              />
            </div>
            <p className="mt-2.5 text-[11.5px] text-secondary">
              {measure.volumetricApplies ? (
                <>
                  This freight is <strong className="text-primary">billed on volume</strong>: at{" "}
                  {measure.divisorCm3PerKg} cm³/kg its {fmt(m3(measure.volumeCm3), 2)} m³ is deemed{" "}
                  {fmt(kg(measure.volumetricWeightGrams), 0)} kg, more than the{" "}
                  {fmt(kg(measure.grossWeightGrams), 0)} kg it actually weighs.
                </>
              ) : (
                <>
                  Billed on actual weight — the {fmt(m3(measure.volumeCm3), 2)} m³ it occupies is
                  deemed only {fmt(kg(measure.volumetricWeightGrams), 0)} kg.
                </>
              )}
            </p>

            {measure.requirements.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {measure.requirements.map((r) => (
                  <div key={r.code} className="flex items-start gap-2">
                    <Tag tone={r.blocking ? "critical" : "warning"} dot>
                      {r.blocking ? "Required" : "Note"}
                    </Tag>
                    <span className="text-[11.5px] text-secondary">{r.description}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11.5px] text-tertiary">
            Enter the goods, the ports and at least one packing line to see the chargeable weight.
          </p>
        )}
      </div>
    </div>
  );
}

function Total({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-tertiary">{label}</div>
      <div
        className={`tabular mt-1 text-[15px] font-semibold ${accent ? "text-accent-strong" : "text-primary"}`}
      >
        {value}
      </div>
    </div>
  );
}
