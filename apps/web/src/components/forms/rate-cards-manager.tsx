"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { clientApi, type RateCardDraft, type SurchargeDraft } from "@/lib/client-api";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { RateCard, SurchargeBasis } from "@/lib/types";
import type { DatedRateCard } from "@/lib/rate-validity";

const MODES = ["OCEAN", "AIR", "ROAD", "RAIL"] as const;
const CONTAINERS = ["20GP", "40GP", "40HC", "45HC", "20RF", "40RF", "LCL"] as const;
const BASES: SurchargeBasis[] = [
  "PER_CONTAINER",
  "PER_SHIPMENT",
  "PER_BL",
  "PERCENT_OF_FREIGHT",
];

const BASIS_LABEL: Record<SurchargeBasis, string> = {
  PER_CONTAINER: "per container",
  PER_SHIPMENT: "per shipment",
  PER_BL: "per B/L",
  PERCENT_OF_FREIGHT: "% of freight",
};

/** `amountCents` doubles as basis points for percentage surcharges. */
function surchargeAmount(basis: SurchargeBasis, amountCents: number, currency: string): string {
  return basis === "PERCENT_OF_FREIGHT"
    ? `${(amountCents / 100).toFixed(2)}%`
    : money(amountCents, currency);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function emptyDraft(): RateCardDraft & { surcharges: SurchargeDraft[] } {
  const now = new Date();
  const year = new Date(now.getTime() + 365 * 86_400_000);
  return {
    kind: "CONTRACT",
    carrierName: "",
    mode: "OCEAN",
    origin: "",
    destination: "",
    containerType: "40HC",
    buyAmountCents: 0,
    currency: "USD",
    transitDays: null,
    validFrom: isoDay(now),
    validTo: isoDay(year),
    surcharges: [],
  };
}

/**
 * Rate card administration.
 *
 * Money is entered in whole currency units and stored in minor units — an
 * operator types 1850.00, the API receives 185000. Doing that conversion here
 * rather than asking anyone to think in cents is the difference between a
 * usable screen and a data-entry trap.
 */
export function RateCardsManager({ cards }: { cards: DatedRateCard[] }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const card = await clientApi.createRateCard({
        ...draft,
        // Send the whole day, not midnight-to-midnight: a card valid "to
        // 31 Dec" should still price a quote raised on the afternoon of the
        // 31st.
        validFrom: new Date(`${draft.validFrom}T00:00:00Z`).toISOString(),
        validTo: new Date(`${draft.validTo}T23:59:59Z`).toISOString(),
      });
      toast.success(
        "Rate card added",
        `${card.origin} → ${card.destination} on ${card.carrierName}.`,
      );
      setDraft(emptyDraft());
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("Could not add rate card", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: RateCard) {
    setBusy(true);
    try {
      await clientApi.deleteRateCard(card.id);
      toast.success("Rate card removed", `${card.origin} → ${card.destination} is no longer priced.`);
      router.refresh();
    } catch (err) {
      toast.error("Could not remove rate card", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Rate cards"
        eyebrow="What the freight costs you"
        actions={
          <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "New rate card"}
          </Button>
        }
      />

      {open && (
        <form
          onSubmit={create}
          className="mb-4 rounded border border-hairline bg-inset p-4"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Origin" required hint="UN/LOCODE">
              <Input
                value={draft.origin}
                onChange={(e) => set("origin", e.target.value.toUpperCase())}
                placeholder="ZADUR"
                maxLength={5}
                className="font-mono"
                required
              />
            </Field>
            <Field label="Destination" required hint="UN/LOCODE">
              <Input
                value={draft.destination}
                onChange={(e) => set("destination", e.target.value.toUpperCase())}
                placeholder="NLRTM"
                maxLength={5}
                className="font-mono"
                required
              />
            </Field>
            <Field label="Mode" required>
              <Select
                value={draft.mode}
                onChange={(e) => set("mode", e.target.value as RateCardDraft["mode"])}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Equipment" hint="Blank prices per shipment, not per box.">
              <Select
                value={draft.containerType ?? ""}
                onChange={(e) =>
                  set("containerType", (e.target.value || null) as RateCardDraft["containerType"])
                }
              >
                <option value="">Per shipment</option>
                {CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Carrier" required>
              <Input
                value={draft.carrierName}
                onChange={(e) => set("carrierName", e.target.value)}
                placeholder="Maersk Line"
                required
              />
            </Field>
            <Field label="Kind" required>
              <Select
                value={draft.kind}
                onChange={(e) => set("kind", e.target.value as RateCardDraft["kind"])}
              >
                <option value="CONTRACT">Contract</option>
                <option value="SPOT">Spot</option>
              </Select>
            </Field>
            <Field label="Buy price" required hint="What the carrier charges you.">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.buyAmountCents === 0 ? "" : draft.buyAmountCents / 100}
                  onChange={(e) =>
                    set("buyAmountCents", Math.round(Number(e.target.value || 0) * 100))
                  }
                  required
                />
                <Input
                  value={draft.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  maxLength={3}
                  className="w-20 font-mono"
                  required
                />
              </div>
            </Field>
            <Field label="Transit days">
              <Input
                type="number"
                min={0}
                value={draft.transitDays ?? ""}
                onChange={(e) => set("transitDays", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>

            <Field label="Valid from" required>
              <Input
                type="date"
                value={draft.validFrom}
                onChange={(e) => set("validFrom", e.target.value)}
                required
              />
            </Field>
            <Field label="Valid to" required>
              <Input
                type="date"
                value={draft.validTo}
                onChange={(e) => set("validTo", e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Add rate card"}
            </Button>
            <span className="text-[11.5px] text-tertiary">
              Surcharges are added once the card exists.
            </span>
          </div>
        </form>
      )}

      {cards.length === 0 ? (
        <EmptyState
          title="No rate cards"
          description="Nothing can be quoted until at least one lane is priced."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Lane</TH>
              <TH>Carrier</TH>
              <TH>Equipment</TH>
              <TH align="right">Buy</TH>
              <TH>Transit</TH>
              <TH>Validity</TH>
              <TH>Surcharges</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {cards.map((card) => {
              return (
                <TR key={card.id}>
                  <TD>
                    <Mono className="text-primary">{card.origin}</Mono>
                    <span className="text-tertiary"> → </span>
                    <Mono className="text-primary">{card.destination}</Mono>
                    <span className="ml-2 text-[11px] text-tertiary">{card.mode}</span>
                  </TD>
                  <TD className="text-secondary">
                    {card.carrierName}
                    <Tag tone="neutral" className="ml-2">
                      {card.kind}
                    </Tag>
                  </TD>
                  <TD className="text-secondary">{card.containerType ?? "per shipment"}</TD>
                  <TD align="right" className="tabular text-primary">
                    {money(card.buyAmountCents, card.currency)}
                  </TD>
                  <TD className="text-secondary">
                    {card.transitDays === null ? "—" : `${card.transitDays}d`}
                  </TD>
                  <TD>
                    {card.validity === "expired" ? (
                      <Tag tone="critical" dot>
                        Expired
                      </Tag>
                    ) : card.validity === "pending" ? (
                      <Tag tone="warning" dot>
                        Not yet live
                      </Tag>
                    ) : (
                      <span className="text-[11.5px] text-secondary">
                        to {new Date(card.validTo).toISOString().slice(0, 10)}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === card.id ? null : card.id)}
                      className="text-[11.5px] font-medium text-accent hover:underline"
                    >
                      {card.surcharges.length} {expanded === card.id ? "▾" : "▸"}
                    </button>
                    {expanded === card.id && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {card.surcharges.length === 0 && (
                          <span className="text-[11px] text-tertiary">None on this card.</span>
                        )}
                        {card.surcharges.map((s) => (
                          <span key={s.id} className="text-[11px] text-secondary">
                            <Mono className="text-primary">{s.code}</Mono>{" "}
                            {surchargeAmount(s.basis, s.amountCents, s.currency)}{" "}
                            <span className="text-tertiary">{BASIS_LABEL[s.basis]}</span>
                          </span>
                        ))}
                        <SurchargeEditor card={card} onSaved={() => router.refresh()} />
                      </div>
                    )}
                  </TD>
                  <TD align="right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(card)}
                      className="text-[11.5px] font-medium text-critical hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

/**
 * Surcharges are replaced as a set rather than edited row by row — a tariff
 * arrives as a sheet, and "these are the costs now" is the only statement that
 * cannot leave a withdrawn BAF behind.
 */
function SurchargeEditor({ card, onSaved }: { card: RateCard; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<SurchargeDraft[]>(() =>
    card.surcharges.map((s) => ({
      code: s.code,
      description: s.description,
      basis: s.basis,
      amountCents: s.amountCents,
      currency: s.currency,
    })),
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await clientApi.replaceSurcharges(card.id, rows);
      toast.success("Surcharges updated", `${rows.length} on ${card.origin} → ${card.destination}.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error("Could not save surcharges", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 self-start text-[11px] font-medium text-accent hover:underline"
      >
        Edit surcharges
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border border-hairline bg-inset p-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <Input
            value={row.code}
            onChange={(e) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, code: e.target.value.toUpperCase() } : r)))
            }
            placeholder="BAF"
            className="w-20 px-2 py-1 font-mono text-[11px]"
          />
          <Input
            value={row.description}
            onChange={(e) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
            }
            placeholder="Bunker adjustment"
            className="w-40 px-2 py-1 text-[11px]"
          />
          <Select
            value={row.basis}
            onChange={(e) =>
              setRows(
                rows.map((r, j) =>
                  j === i ? { ...r, basis: e.target.value as SurchargeBasis } : r,
                ),
              )
            }
            className="w-36 px-2 py-1 text-[11px]"
          >
            {BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_LABEL[b]}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            step={row.basis === "PERCENT_OF_FREIGHT" ? "0.01" : "0.01"}
            value={row.amountCents / 100}
            onChange={(e) =>
              setRows(
                rows.map((r, j) =>
                  j === i ? { ...r, amountCents: Math.round(Number(e.target.value || 0) * 100) } : r,
                ),
              )
            }
            className="w-24 px-2 py-1 text-[11px]"
          />
          <span className="text-[10.5px] text-tertiary">
            {row.basis === "PERCENT_OF_FREIGHT" ? "%" : row.currency}
          </span>
          <button
            type="button"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="text-[11px] text-critical hover:underline"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setRows([
              ...rows,
              {
                code: "",
                description: "",
                basis: "PER_CONTAINER",
                amountCents: 0,
                currency: card.currency,
              },
            ])
          }
          className="text-[11px] font-medium text-accent hover:underline"
        >
          + Add surcharge
        </button>
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Replace set"}
        </Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[11px] text-tertiary hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
