"use client";

import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { ClassificationCandidate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Tag } from "@/components/ui/badge";

export function ClassifyHelper() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClassificationCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await clientApi.classify(q.trim()));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-hairline bg-inset p-3">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        HS classification helper
      </div>
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="describe the commodity…"
          className="h-8 text-[12px]"
        />
        <Button size="sm" onClick={search} disabled={busy || !q.trim()}>
          {busy ? "…" : "Search"}
        </Button>
      </div>
      {results && (
        <div className="mt-2 flex flex-col gap-1.5">
          {results.length === 0 && <div className="text-[11.5px] text-tertiary">No candidates found.</div>}
          {results.map((r) => (
            <div key={r.hsCode} className="flex items-center justify-between rounded bg-surface px-2.5 py-1.5">
              <div>
                <span className="font-mono text-[11.5px] text-primary">{r.hsCode}</span>
                <span className="ml-2 text-[11.5px] text-secondary">{r.description}</span>
              </div>
              <Tag tone={r.confidence >= 0.7 ? "success" : "warning"}>
                {(r.confidence * 100).toFixed(0)}%
              </Tag>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
