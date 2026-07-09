import Link from "next/link";
import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default async function FinancePage() {
  let error: string | null = null;
  const views = await api.financeViews().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return { dutyFinancing: [], factoring: [] };
  });

  const outstandingFactoring = views.factoring.filter((r) => !r.settled_at);
  const dutyTotal = views.dutyFinancing.reduce((sum, r) => sum + Number(r.amountCents), 0);
  const factoringTotal = outstandingFactoring.reduce((sum, r) => sum + Number(r.amount_cents), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Finance views"
        description="Trade-finance feed off the Revenue Ontology ledger — duty financing eligibility and receivables outstanding."
      />

      {error && <ErrorState message={error} />}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="Duty financing eligible"
          value={views.dutyFinancing.length > 0 ? money(dutyTotal, views.dutyFinancing[0]!.currency) : "—"}
          tone="success"
          sub={`${views.dutyFinancing.length} released entries`}
        />
        <StatTile
          label="Factoring exposure"
          value={outstandingFactoring.length > 0 ? money(factoringTotal, outstandingFactoring[0]!.currency) : "—"}
          tone="accent"
          sub={`${outstandingFactoring.length} receivables outstanding`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Duty financing eligible" eyebrow="entry.released → disbursement" />
          {views.dutyFinancing.length === 0 ? (
            <EmptyState title="Nothing eligible" description="Appears once a customs entry is released." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Shipment</TH>
                  <TH align="right">Amount</TH>
                  <TH>Released</TH>
                </TR>
              </THead>
              <tbody>
                {views.dutyFinancing.map((r) => (
                  <TR key={r.shipmentId}>
                    <TD>
                      <Link href={`/shipments/${r.shipmentId}`} className="font-medium text-accent hover:underline">
                        <Mono>{r.shipmentId.slice(0, 8)}</Mono>
                      </Link>
                    </TD>
                    <TD align="right" className="tabular text-success">
                      {money(r.amountCents, r.currency)}
                    </TD>
                    <TD className="text-secondary">{fmtDate(r.occurredAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Factoring exposure" eyebrow="receivable.recognised → outstanding" />
          {outstandingFactoring.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="All receivables settled." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Shipment</TH>
                  <TH align="right">Amount</TH>
                  <TH align="right">Days out</TH>
                </TR>
              </THead>
              <tbody>
                {outstandingFactoring.map((r, i) => {
                  const days = daysSince(r.recognised_at);
                  return (
                    <TR key={`${r.shipment_id}-${i}`}>
                      <TD>
                        <Link
                          href={`/shipments/${r.shipment_id}`}
                          className="font-medium text-accent hover:underline"
                        >
                          <Mono>{r.shipment_id.slice(0, 8)}</Mono>
                        </Link>
                      </TD>
                      <TD align="right" className="tabular text-accent-strong">
                        {money(r.amount_cents, r.currency)}
                      </TD>
                      <TD align="right">
                        <Tag tone={days > 7 ? "critical" : days > 3 ? "warning" : "neutral"}>{days}d</Tag>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}
