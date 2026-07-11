import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { ShipmentStatusTag, Tag, exceptionSeverity } from "@/components/ui/badge";
import { EmptyState, ErrorState, InfoBanner } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let error: string | null = null;
  const [monitor, shipments, exceptions, tenant] = await Promise.all([
    api.systemMonitor().catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.listShipments().catch(() => []),
    api.openExceptions().catch(() => []),
    api.getMyTenant().catch(() => null),
  ]);

  const byStatus = new Map((monitor?.entities.shipmentsByStatus ?? []).map((r) => [r.status, r.n]));
  const active =
    (monitor?.entities.shipmentsByStatus ?? [])
      .filter((r) => r.status !== "DELIVERED" && r.status !== "CANCELLED")
      .reduce((sum, r) => sum + r.n, 0) || shipments.length;
  const inTransit = byStatus.get("IN_TRANSIT") ?? 0;
  const customsHold = byStatus.get("CUSTOMS") ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Dashboard"
        description="Live state of the freight book — bookings, transit, customs, and what needs a human today."
      />

      {error && <ErrorState message={error} />}

      {tenant?.type === "OPERATOR" && (
        <InfoBanner>
          This view is the <strong>forwarder business</strong> — shipments booked directly with
          your own customers, margin on freight you personally handle.{" "}
          <Link href="/network" className="font-medium text-accent hover:underline">
            The infrastructure business
          </Link>{" "}
          — other operators running on these rails, platform fee per shipment — lives separately
          under Network Overview and Partners.
        </InfoBanner>
      )}
      {tenant?.type === "PARTNER_AGENT" && (
        <InfoBanner>
          You run your own book of business on FORGE Freight&apos;s rails — your customers, your
          branding, your relationships. We only see the freight you move, for the platform fee.{" "}
          <Link href="/platform-fees" className="font-medium text-accent hover:underline">
            See what you owe →
          </Link>
        </InfoBanner>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Active shipments" value={active} tone="accent" />
        <StatTile label="In transit" value={inTransit} tone="neutral" />
        <StatTile
          label="Customs hold"
          value={customsHold}
          tone={customsHold > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Open exceptions"
          value={exceptions.length}
          tone={exceptions.length > 0 ? "critical" : "success"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3">
          <PanelHeader
            title="Recent shipments"
            actions={
              <Link href="/shipments" className="text-[11.5px] font-medium text-accent hover:underline">
                View all →
              </Link>
            }
          />
          {shipments.length === 0 ? (
            <EmptyState title="No shipments yet" description="Book a quote to see it appear here." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Route</TH>
                  <TH>Status</TH>
                  <TH>Booked</TH>
                </TR>
              </THead>
              <tbody>
                {shipments.slice(0, 8).map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/shipments/${s.id}`} className="font-medium text-accent hover:underline">
                        <Mono>{s.reference}</Mono>
                      </Link>
                    </TD>
                    <TD className="text-secondary">
                      {s.origin} → {s.destination}
                    </TD>
                    <TD>
                      <ShipmentStatusTag status={s.status} />
                    </TD>
                    <TD className="text-secondary">{fmtDate(s.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Needs attention"
            actions={
              <Link href="/ops" className="text-[11.5px] font-medium text-accent hover:underline">
                Ops console →
              </Link>
            }
          />
          {exceptions.length === 0 ? (
            <EmptyState title="Nothing open" description="No exceptions on the board." />
          ) : (
            <div className="flex flex-col gap-2">
              {exceptions.slice(0, 6).map((exc) => (
                <Link
                  key={exc.exceptionId}
                  href={`/shipments/${exc.shipmentId}`}
                  className="rounded border border-hairline p-3 transition-colors hover:border-strong hover:bg-hover"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <Tag tone={exceptionSeverity(exc.code)} dot>
                      {exc.code.replaceAll("_", " ")}
                    </Tag>
                    <Mono className="text-tertiary">{exc.reference}</Mono>
                  </div>
                  <div className="text-[12px] text-secondary">
                    {exc.detail ?? `${exc.origin} → ${exc.destination}`}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
