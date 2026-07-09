"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { clientApi } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/card";

const DOC_TYPES = [
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "BL",
  "SAD500",
  "CERTIFICATE_OF_ORIGIN",
  "CLEARING_INSTRUCTION",
  "POD",
  "OTHER",
];

export function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("COMMERCIAL_INVOICE");
  const [shipmentId, setShipmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("docType", docType);
      if (shipmentId.trim()) form.set("shipmentId", shipmentId.trim());
      const doc = await clientApi.uploadDocument(form);
      setOk(
        doc.extractionConfidence != null
          ? `Uploaded — extraction confidence ${(doc.extractionConfidence * 100).toFixed(0)}%`
          : "Uploaded — routed to manual review (no extraction confidence available)",
      );
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Upload document" eyebrow="Claude structured extraction" />
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Document type">
          <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shipment ID" hint="Optional — leave blank for unlinked documents.">
          <Input
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            placeholder="uuid"
            className="font-mono text-[12px]"
          />
        </Field>
        <Field label="File" hint="PDF, image, or CSV — up to 32MB.">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*,.csv"
            className="w-full rounded-sm border border-strong bg-inset px-3 py-2 text-[12.5px] text-primary file:mr-3 file:rounded-sm file:border-0 file:bg-accent file:px-2.5 file:py-1 file:text-[11px] file:font-semibold file:text-white"
          />
        </Field>

        {error && (
          <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
            {error}
          </div>
        )}
        {ok && (
          <div className="rounded border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-success-wash px-3 py-2 text-[12px] text-success">
            {ok}
          </div>
        )}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Uploading…" : "Upload & extract"}
        </Button>
      </form>
    </Panel>
  );
}
