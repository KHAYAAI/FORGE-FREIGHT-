"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export function FeeRateEditor({ partnerId, currentBps }: { partnerId: string; currentBps: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(String((currentBps ?? 0) / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await clientApi.updatePartnerFeeRate(partnerId, Math.round(Number(value) * 100));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={100}
        step="0.1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-20 text-[11px]"
      />
      <span className="text-[11px] text-secondary">%</span>
      <Button size="sm" variant="secondary" onClick={save} disabled={busy}>
        {busy ? "…" : "Save"}
      </Button>
      {error && <span className="text-[10.5px] text-critical">{error}</span>}
    </div>
  );
}
