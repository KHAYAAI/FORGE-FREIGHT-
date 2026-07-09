"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { CustomsEntry, CustomsEntryLine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function ConfirmLineAction({ entryId, line }: { entryId: string; line: CustomsEntryLine }) {
  const router = useRouter();
  const [hsCode, setHsCode] = useState(line.hsCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await clientApi.confirmLine(entryId, line.id, hsCode.trim() || undefined);
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
        value={hsCode}
        onChange={(e) => setHsCode(e.target.value)}
        placeholder="6204.62.00"
        className="h-7 w-28 font-mono text-[11px]"
      />
      <Button size="sm" variant="primary" onClick={confirm} disabled={busy || !hsCode.trim()}>
        {busy ? "…" : "Confirm"}
      </Button>
      {error && <span className="text-[10.5px] text-critical">{error}</span>}
    </div>
  );
}

export function EntryStageActions({ entry }: { entry: CustomsEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [releaseRef, setReleaseRef] = useState("");

  const allConfirmed = (entry.lines ?? []).every((l) => l.confirmedAt);

  async function run(action: string, fn: () => Promise<unknown>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (entry.status === "DRAFT") {
    return (
      <div className="flex flex-col gap-2">
        {!allConfirmed && (
          <div className="text-[11.5px] text-tertiary">Confirm every line&apos;s HS code before preparing.</div>
        )}
        {error && <div className="text-[11.5px] text-critical">{error}</div>}
        <Button
          variant="primary"
          disabled={!allConfirmed || busy !== null}
          onClick={() => run("prepare", () => clientApi.prepareEntry(entry.id))}
        >
          {busy === "prepare" ? "Preparing…" : "Prepare entry"}
        </Button>
      </div>
    );
  }

  if (entry.status === "PREPARED") {
    return (
      <div className="flex flex-col gap-2">
        {error && <div className="text-[11.5px] text-critical">{error}</div>}
        <Button
          variant="primary"
          disabled={busy !== null}
          onClick={() => run("submit", () => clientApi.submitEntry(entry.id))}
        >
          {busy === "submit" ? "Submitting…" : "Submit to bureau"}
        </Button>
      </div>
    );
  }

  if (entry.status === "SUBMITTED" || entry.status === "QUERY") {
    return (
      <div className="flex flex-col gap-3">
        <Field label="Outcome detail" hint="Bureau note, query reason, or release context.">
          <Input value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Field label="Release reference" hint="Only needed when releasing.">
          <Input value={releaseRef} onChange={(e) => setReleaseRef(e.target.value)} className="font-mono" />
        </Field>
        {error && <div className="text-[11.5px] text-critical">{error}</div>}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => run("query", () => clientApi.entryOutcome(entry.id, "QUERY", detail || undefined))}
          >
            Raise query
          </Button>
          <Button
            variant="success"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("release", () =>
                clientApi.entryOutcome(entry.id, "RELEASED", detail || undefined, releaseRef || undefined),
              )
            }
          >
            Release
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy !== null}
            onClick={() => run("stop", () => clientApi.entryOutcome(entry.id, "STOPPED", detail || undefined))}
          >
            Stop
          </Button>
        </div>
      </div>
    );
  }

  return <div className="text-[12px] text-tertiary">Entry is {entry.status.toLowerCase()} — no further action.</div>;
}
