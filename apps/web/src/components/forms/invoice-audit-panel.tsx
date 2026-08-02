"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/client-api";
import { money } from "@/lib/format";
import type { AuditResult, ExceptionRow, MatchSource } from "@/lib/types";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Tag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

/**
 * The four-way match, on the screen.
 *
 * Two things here are load-bearing and easy to lose in a redesign.
 *
 * The first is the match-depth strip. "No exceptions found" is a different
 * claim depending on how many of the four sources were actually available, and
 * a screen that shows a green tick without saying which checks ran is a screen
 * that lends the audit a confidence it has not earned. Missing sources are
 * rendered as prominently as findings.
 *
 * The second is that nothing here blocks anything. A finding annotates; a
 * person decides. The buttons are Accept and Query, and both are recorded.
 */

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "critical",
  WARN: "warning",
  INFO: "neutral",
};

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "warning",
  DISPUTED: "critical",
  ACCEPTED: "neutral",
  RESOLVED: "success",
};

const SOURCE_LABEL: Record<MatchSource, string> = {
  CONTRACT: "Contract",
  VENDOR_COST: "Vendor cost / benchmark",
  SHIPMENT_DATA: "Shipment data",
  SERVICE_EVENTS: "Service events",
};

export function InvoiceAuditPanel({
  invoiceId,
  currency,
  initialExceptions,
}: {
  invoiceId: string;
  currency: string;
  initialExceptions: ExceptionRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialExceptions);
  const [summary, setSummary] = useState<AuditResult["summary"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [packet, setPacket] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const result = await clientApi.auditInvoice(invoiceId);
      setSummary(result.summary);
      setRows(await clientApi.invoiceExceptions(invoiceId));
      if (result.summary.findings === 0) {
        toast.success(
          "No exceptions",
          `${result.summary.linesChecked} line(s) matched against ${result.summary.matchedSources} of 4 sources.`,
        );
      } else {
        toast.info(
          `${result.summary.findings} exception(s)`,
          result.summary.netVarianceCents > 0
            ? `${money(result.summary.netVarianceCents, currency)} of the invoice is queryable.`
            : "No net overcharge, but the findings are worth reading.",
        );
      }
      router.refresh();
    } catch (e) {
      toast.error("Audit failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, status: "ACCEPTED" | "DISPUTED") {
    try {
      await clientApi.resolveException(id, status);
      setRows((prev) =>
        prev.map((r) => (r.exception.id === id ? { ...r, exception: { ...r.exception, status } } : r)),
      );
      // A queried line is held back from the balance on the document itself,
      // so the invoice has to re-render, not just this panel.
      router.refresh();
    } catch (e) {
      toast.error("Could not update", e instanceof Error ? e.message : String(e));
    }
  }

  async function generatePacket() {
    try {
      const p = await clientApi.disputePacket(invoiceId);
      setPacket(p.body);
      toast.success(
        "Dispute packet ready",
        p.lineCount === 0
          ? "Nothing quantified to claim."
          : `${p.lineCount} item(s), ${money(p.claimedCents, currency)}.`,
      );
    } catch (e) {
      toast.error("Could not build the packet", e instanceof Error ? e.message : String(e));
    }
  }

  const open = rows.filter((r) => r.exception.status === "OPEN" || r.exception.status === "DISPUTED");
  const queryable = open.reduce((s, r) => s + Math.max(0, r.exception.varianceCents ?? 0), 0);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Four-way match"
        title="Invoice audit"
        actions={
          <>
            <Button onClick={run} disabled={busy}>
              {busy ? "Matching…" : rows.length === 0 ? "Run audit" : "Re-run"}
            </Button>
            {open.length > 0 && (
              <Button variant="secondary" onClick={generatePacket}>
                Dispute packet
              </Button>
            )}
          </>
        }
      />

      <p className="mb-4 text-[11.5px] leading-relaxed text-tertiary">
        Every line is checked against the contract the customer accepted, the underlying vendor cost
        or a published benchmark, the shipment&rsquo;s own facts, and the service event record.
        Findings annotate the invoice; they do not block it.
      </p>

      {summary && (
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          {(Object.keys(SOURCE_LABEL) as MatchSource[]).map((source) => (
            <div
              key={source}
              className={`rounded border px-3 py-2 ${
                summary.matchDepth[source]
                  ? "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-success-wash"
                  : "border-hairline bg-inset"
              }`}
            >
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-tertiary">
                {SOURCE_LABEL[source]}
              </div>
              <div
                className={`mt-0.5 text-[12px] font-semibold ${
                  summary.matchDepth[source] ? "text-success" : "text-tertiary"
                }`}
              >
                {summary.matchDepth[source] ? "Matched" : "No data"}
              </div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.matchedSources < 4 && (
        <div className="mb-4 rounded border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-wash px-3 py-2 text-[11.5px] text-warning">
          This invoice was matched against {summary.matchedSources} of 4 sources. The lines that
          depend on the missing ones have not been validated — see the findings below for which.
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Not audited yet"
          description="Run the match before this invoice is paid — dispute windows are measured in days, and a finding raised after the window closes is a write-off."
        />
      ) : (
        <>
          {queryable > 0 && (
            <div className="mb-3 text-[12px] text-primary">
              <span className="text-secondary">Queryable on this invoice:</span>{" "}
              <span className="tabular font-semibold text-warning">{money(queryable, currency)}</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {rows.map(({ exception: e }) => (
              <div key={e.id} className="rounded border border-hairline bg-inset px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={SEVERITY_TONE[e.severity] ?? "neutral"} dot>
                    {e.severity}
                  </Tag>
                  <span className="mono text-[10.5px] text-tertiary">{e.code}</span>
                  <Tag tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status}</Tag>
                  {e.varianceCents != null && e.varianceCents !== 0 && (
                    <span
                      className={`tabular ml-auto text-[12px] font-semibold ${
                        e.varianceCents > 0 ? "text-warning" : "text-secondary"
                      }`}
                    >
                      {e.varianceCents > 0 ? "+" : ""}
                      {money(e.varianceCents, currency)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-primary">{e.message}</p>
                {e.status === "OPEN" && (
                  <div className="mt-2 flex gap-2">
                    <Button variant="secondary" onClick={() => resolve(e.id, "DISPUTED")}>
                      Query this line
                    </Button>
                    <Button variant="ghost" onClick={() => resolve(e.id, "ACCEPTED")}>
                      Accept as billed
                    </Button>
                  </div>
                )}
                {e.resolutionNote && (
                  <p className="mt-1.5 text-[11px] text-tertiary">{e.resolutionNote}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {packet && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-tertiary">
            Dispute packet — send this to the vendor
          </div>
          <textarea
            readOnly
            value={packet}
            rows={16}
            className="mono w-full rounded border border-hairline bg-inset p-3 text-[11px] leading-relaxed text-secondary"
          />
        </div>
      )}
    </Panel>
  );
}
