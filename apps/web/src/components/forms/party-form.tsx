"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { clientApi } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/badge";

export function PartyForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", country: "", address: "", taxId: "", email: "", phone: "" });
  const [result, setResult] = useState<{ name: string; verdict: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const party = await clientApi.createParty({
        name: form.name,
        country: form.country || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
      });
      setResult({ name: party.name, verdict: party.screening?.verdict ?? "UNKNOWN" });
      setForm({ name: "", country: "", address: "", taxId: "", email: "", phone: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Register party" eyebrow="Screened on creation" />
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country" hint="ISO-2">
            <Input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
              maxLength={2}
              className="font-mono"
            />
          </Field>
          <Field label="Tax ID">
            <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>

        {error && (
          <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
            {error}
          </div>
        )}
        {result && (
          <div className="flex items-center gap-2 rounded border border-hairline bg-hover px-3 py-2 text-[12px]">
            <span className="text-secondary">{result.name} screened —</span>
            <Tag tone={result.verdict === "HIT" ? "critical" : result.verdict === "CLEAN" ? "success" : "neutral"}>
              {result.verdict}
            </Tag>
          </div>
        )}

        <Button type="submit" variant="primary" disabled={busy || !form.name}>
          {busy ? "Screening…" : "Create & screen"}
        </Button>
      </form>
    </Panel>
  );
}
