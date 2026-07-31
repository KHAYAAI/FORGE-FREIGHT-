"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { clientApi, type MarginRuleDraft } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { MarginRule, Party } from "@/lib/types";

const MODES = ["OCEAN", "AIR", "ROAD", "RAIL"] as const;

function emptyDraft(): MarginRuleDraft {
  return {
    customerId: null,
    origin: null,
    destination: null,
    mode: null,
    marginBps: 1_500,
    minMarginCents: 0,
  };
}

function specificity(rule: MarginRule): number {
  return (
    Number(!!rule.customerId) +
    Number(!!rule.origin) +
    Number(!!rule.destination) +
    Number(!!rule.mode)
  );
}

/**
 * Margin rules decide the sell price on top of a rate card's buy. The list
 * arrives most-specific-first, which is the order the quote engine resolves
 * them in — so the table reads top-down as "this is the rule that will
 * actually apply", rather than as a pile an operator has to simulate in their
 * head.
 */
export function MarginRulesManager({
  rules,
  parties,
}: {
  rules: MarginRule[];
  parties: Party[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<MarginRuleDraft>(emptyDraft);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const partyName = (id: string | null) =>
    id ? (parties.find((p) => p.id === id)?.name ?? "Unknown customer") : null;

  const set = <K extends keyof MarginRuleDraft>(key: K, value: MarginRuleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await clientApi.createMarginRule(draft);
      toast.success("Margin rule added", `${(draft.marginBps / 100).toFixed(2)}% on buy.`);
      setDraft(emptyDraft());
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("Could not add margin rule", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: MarginRule) {
    setBusy(true);
    try {
      await clientApi.deleteMarginRule(rule.id);
      toast.success("Margin rule removed");
      router.refresh();
    } catch (err) {
      // The API refuses to delete the last catch-all — that message is the
      // point, so surface it rather than a generic failure.
      toast.error("Could not remove margin rule", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Margin rules"
        eyebrow="What you charge on top"
        actions={
          <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "New margin rule"}
          </Button>
        }
      />

      {open && (
        <form onSubmit={create} className="mb-4 rounded border border-hairline bg-inset p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Customer" hint="Blank applies to every customer.">
              <Select
                value={draft.customerId ?? ""}
                onChange={(e) => set("customerId", e.target.value || null)}
              >
                <option value="">Any customer</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Origin" hint="Blank matches any origin.">
              <Input
                value={draft.origin ?? ""}
                onChange={(e) => set("origin", e.target.value.toUpperCase() || null)}
                placeholder="Any"
                maxLength={5}
                className="font-mono"
              />
            </Field>
            <Field label="Destination" hint="Blank matches any destination.">
              <Input
                value={draft.destination ?? ""}
                onChange={(e) => set("destination", e.target.value.toUpperCase() || null)}
                placeholder="Any"
                maxLength={5}
                className="font-mono"
              />
            </Field>
            <Field label="Mode">
              <Select
                value={draft.mode ?? ""}
                onChange={(e) => set("mode", (e.target.value || null) as MarginRuleDraft["mode"])}
              >
                <option value="">Any mode</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Margin" required hint="Percent of the buy price.">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={draft.marginBps / 100}
                  onChange={(e) => set("marginBps", Math.round(Number(e.target.value || 0) * 100))}
                  required
                />
                <span className="text-[12.5px] text-secondary">%</span>
              </div>
            </Field>
            <Field label="Minimum margin" hint="Floor per quote line, in the line's currency.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.minMarginCents / 100}
                onChange={(e) =>
                  set("minMarginCents", Math.round(Number(e.target.value || 0) * 100))
                }
              />
            </Field>
          </div>

          <Button type="submit" variant="primary" disabled={busy} className="mt-4">
            {busy ? "Saving…" : "Add margin rule"}
          </Button>
        </form>
      )}

      {rules.length === 0 ? (
        <EmptyState
          title="No margin rules"
          description="Quoting fails without at least one catch-all rule — nothing can be priced."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Applies to</TH>
              <TH align="right">Margin</TH>
              <TH align="right">Floor</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {rules.map((rule) => {
              const scope = [
                partyName(rule.customerId),
                rule.origin && rule.destination
                  ? `${rule.origin} → ${rule.destination}`
                  : rule.origin
                    ? `from ${rule.origin}`
                    : rule.destination
                      ? `to ${rule.destination}`
                      : null,
                rule.mode,
              ].filter(Boolean);
              return (
                <TR key={rule.id}>
                  <TD>
                    {scope.length === 0 ? (
                      <Tag tone="accent">Everything (catch-all)</Tag>
                    ) : (
                      <span className="text-secondary">
                        {scope.map((part, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-tertiary"> · </span>}
                            <Mono className="text-primary">{part}</Mono>
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="ml-2 text-[10.5px] text-tertiary">
                      {specificity(rule)} of 4 dimensions
                    </span>
                  </TD>
                  <TD align="right" className="tabular text-primary">
                    {(rule.marginBps / 100).toFixed(2)}%
                  </TD>
                  <TD align="right" className="tabular text-secondary">
                    {/* Currency-agnostic on purpose: the floor is applied in
                        whichever currency the quote line is priced in. */}
                    {rule.minMarginCents === 0
                      ? "—"
                      : (rule.minMarginCents / 100).toLocaleString("en-ZA", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  </TD>
                  <TD align="right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(rule)}
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
