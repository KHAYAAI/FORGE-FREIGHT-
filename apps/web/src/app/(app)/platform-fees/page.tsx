import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function PlatformFeesPage() {
  let error: string | null = null;
  const fees = await api.platformFees().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return { charges: [], totals: [] };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Platform fees"
        description="What this tenant owes the operator on booked freight — accrued automatically when a shipment departs."
      />

      {error && <ErrorState message={error} />}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {fees.totals.length === 0 ? (
          <StatTile label="Total owed" value="—" />
        ) : (
          fees.totals.map((t) => (
            <StatTile key={t.currency} label={`Owed (${t.currency})`} value={money(t.amountCents, t.currency)} tone="accent" />
          ))
        )}
      </div>

      <Panel>
        <PanelHeader title={`Fee charges (${fees.charges.length})`} />
        {fees.charges.length === 0 && !error ? (
          <EmptyState title="No fees accrued yet" description="Fees appear here once a shipment departs." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Shipment</TH>
                <TH>Description</TH>
                <TH align="right">Amount</TH>
                <TH>Accrued</TH>
              </TR>
            </THead>
            <tbody>
              {fees.charges.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Mono className="text-primary">{c.shipmentId.slice(0, 8)}</Mono>
                  </TD>
                  <TD className="text-secondary">{c.description}</TD>
                  <TD align="right" className="tabular text-accent-strong">
                    {money(c.sellCents, c.currency)}
                  </TD>
                  <TD className="text-secondary">{fmtDate(c.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
