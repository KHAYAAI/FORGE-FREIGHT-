import { api, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { EmptyState, ErrorState, InfoBanner } from "@/components/ui/empty-state";
import { BarRow } from "@/components/ui/bar-row";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  let error: string | null = null;
  const network = await api.getNetwork().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return null;
  });

  const errorText = error ?? "";
  const forbidden = errorText.includes("403") || errorText.toLowerCase().includes("forbidden");

  const statusMax = Math.max(1, ...(network?.shipmentsByStatus.map((r) => r.n) ?? [0]));
  const corridorMax = Math.max(1, ...(network?.corridorVolume.map((r) => r.n) ?? [0]));

  return (
    <div>
      <PageHeader
        eyebrow="Infrastructure business"
        title="Network Overview"
        description="Total trade volume across every tenant on the platform — our own shipments plus every partner's. This is the aggregate signal a single forwarder's data never has, and the exact claim the neutral-infrastructure pitch to government and clearing agents has to be able to back up with a real number."
      />

      {forbidden ? (
        <EmptyState
          title="Operator access only"
          description="This tenant isn't the operator tenant, so network-wide aggregates aren't available — a partner sees its own shipments and its own platform fees, never another tenant's volume."
        />
      ) : (
        <>
          {error && <ErrorState message={error} />}

          {network && (
            <>
              <InfoBanner>
                Deliberately shaped like a corridor Track-and-Trace dashboard, not a sales report:
                lane, volume, status — never customer names. That's the whole point of the
                infrastructure model — the platform can produce this view precisely because it
                doesn't need to know or care which tenant a shipment belongs to.
              </InfoBanner>

              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Total shipments (all tenants)" value={network.totalShipments} tone="accent" />
                <StatTile
                  label="Tenants on platform"
                  value={network.tenantsByType.reduce((sum, t) => sum + t.n, 0)}
                />
                <StatTile
                  label="Partner agents"
                  value={network.tenantsByType.find((t) => t.type === "PARTNER_AGENT")?.n ?? 0}
                />
                {network.platformFeeRevenue.map((r) => (
                  <StatTile
                    key={r.currency}
                    label={`Platform fee revenue (${r.currency})`}
                    value={money(r.totalCents, r.currency)}
                    tone="success"
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Panel>
                  <PanelHeader title="Corridor volume" eyebrow="Top 20 lanes, all tenants" />
                  {network.corridorVolume.length === 0 ? (
                    <EmptyState title="No shipments yet" description="Volume appears here once bookings exist." />
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {network.corridorVolume.map((c) => (
                        <BarRow
                          key={`${c.origin}-${c.destination}`}
                          label={`${c.origin} → ${c.destination}`}
                          value={c.n}
                          max={corridorMax}
                        />
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel>
                  <PanelHeader title="Network shipments by status" />
                  {network.shipmentsByStatus.length === 0 ? (
                    <EmptyState title="No shipments yet" description="Nothing booked across the network." />
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {network.shipmentsByStatus.map((s) => (
                        <BarRow key={s.status} label={s.status.replaceAll("_", " ")} value={s.n} max={statusMax} />
                      ))}
                    </div>
                  )}
                </Panel>
              </div>

              <Panel className="mt-4">
                <PanelHeader title="Tenants by type" />
                <Table>
                  <THead>
                    <TR>
                      <TH>Type</TH>
                      <TH align="right">Count</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {network.tenantsByType.map((t) => (
                      <TR key={t.type}>
                        <TD>
                          <Tag tone={t.type === "OPERATOR" ? "accent" : t.type === "PARTNER_AGENT" ? "info" : "neutral"}>
                            {t.type.replaceAll("_", " ")}
                          </Tag>
                        </TD>
                        <TD align="right" className="tabular">
                          <Mono>{t.n}</Mono>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
