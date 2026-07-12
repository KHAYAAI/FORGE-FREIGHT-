"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { FreightDocument } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/badge";
import { Mono } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

function extractedPreview(data: Record<string, unknown> | null): [string, string][] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 5)
    .map(([k, v]) => [k, String(v)]);
}

export function DocumentReviewCard({ doc }: { doc: FreightDocument }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confidence = doc.extractionConfidence;
  const belowThreshold = confidence == null || confidence < 0.85;
  const preview = extractedPreview(doc.extractedData);

  async function act(decision: "APPROVED" | "REJECTED") {
    setBusy(decision === "APPROVED" ? "approve" : "reject");
    setError(null);
    try {
      await clientApi.reviewDocument(doc.id, decision);
      toast.success(
        decision === "APPROVED" ? "Document approved" : "Document rejected",
        doc.fileName,
      );
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Review action failed", message);
      setBusy(null);
    }
  }

  return (
    <div className="rounded border border-hairline bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12.5px] font-semibold text-primary">
            {doc.docType.replaceAll("_", " ")}
          </div>
          <div className="text-[11px] text-tertiary">{doc.fileName}</div>
        </div>
        <Tag tone={belowThreshold ? "warning" : "success"}>
          {confidence != null ? `${(confidence * 100).toFixed(0)}%` : "No score"}
        </Tag>
      </div>

      {preview.length > 0 ? (
        <dl className="mb-3 grid grid-cols-1 gap-1 rounded bg-inset p-2.5 text-[11.5px]">
          {preview.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="shrink-0 text-tertiary">{k}</dt>
              <dd className="truncate text-right text-secondary">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mb-3 rounded bg-inset p-2.5 text-[11.5px] text-tertiary">
          No extraction available — manual data entry required.
        </div>
      )}

      <div className="mb-3 text-[11px] text-tertiary">
        {belowThreshold
          ? "Below 0.85 threshold — human confirmation required."
          : "Above threshold — auto-approval eligible."}
      </div>

      {error && <div className="mb-2 text-[11.5px] text-critical">{error}</div>}

      <div className="flex gap-2">
        <Button variant="success" size="sm" disabled={busy !== null} onClick={() => act("APPROVED")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => act("REJECTED")}>
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <span className="ml-auto self-center">
          <Mono className="text-tertiary">{doc.id.slice(0, 8)}</Mono>
        </span>
      </div>
    </div>
  );
}
