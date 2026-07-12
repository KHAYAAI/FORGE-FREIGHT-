"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { clientApi } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function PartnerForm() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [feePercent, setFeePercent] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const partner = await clientApi.createPartner({
        name,
        platformFeeBps: Math.round(Number(feePercent) * 100),
      });
      toast.success("Partner onboarded", `${partner.name} is now live on the platform.`);
      setName("");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Failed to create partner", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Onboard partner" eyebrow="M10 franchise layer" />
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Partner name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Platform fee" required hint="Percent of freight sell, charged on vessel.departed.">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
              className="w-24"
            />
            <span className="text-[12.5px] text-secondary">%</span>
          </div>
        </Field>

        {error && (
          <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
            {error}
          </div>
        )}

        <Button type="submit" variant="primary" disabled={busy || !name}>
          {busy ? "Creating…" : "Create partner tenant"}
        </Button>
      </form>
    </Panel>
  );
}
