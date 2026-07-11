import Link from "next/link";
import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { InfoBanner, EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PartnerForm } from "@/components/forms/partner-form";
import { FeeRateEditor } from "@/components/forms/fee-rate-editor";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  let error: string | null = null;
  const partners = await api.listPartners().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  const errorText: string = error ?? "";
  const forbidden = errorText.includes("403") || errorText.toLowerCase().includes("forbidden");

  const totalShipments = partners.reduce((sum, p) => sum + p.shipmentCount, 0);
  const revenueByCurrency = new Map<string, number>();
  for (const p of partners) {
    for (const r of p.feeRevenue) {
      revenueByCurrency.set(r.currency, (revenueByCurrency.get(r.currency) ?? 0) + r.amountCents);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Infrastructure business"
        title="Partners"
        description="Other operators running their own book of business on our rails — not our customers. We never see their shipper relationships; we take a platform fee on the freight they move."
      />

      {forbidden ? (
        <EmptyState
          title="Operator access only"
          description="This tenant isn't the operator tenant, so partner administration is not available."
        />
      ) : (
        <>
          {error && <ErrorState message={error} />}

          <InfoBanner>
            This is the platform-fee revenue engine, separate from freight margin on shipments
            we book directly. A partner keeps their own branding and customer relationships end
            to end — we're invisible to their shippers, indispensable to their ops team.{" "}
            <Link href="/network" className="font-medium text-accent hover:underline">
              See aggregate network volume →
            </Link>
          </InfoBanner>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Active partners" value={partners.length} />
            <StatTile label="Shipments via partners" value={totalShipments} tone="accent" />
            {Array.from(revenueByCurrency.entries()).map(([currency, cents]) => (
              <StatTile key={currency} label={`Fee revenue (${currency})`} value={money(cents, currency)} tone="success" />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Panel className="lg:col-span-3" padded={false}>
              <div className="p-5 pb-0">
                <PanelHeader title={`Partners (${partners.length})`} />
              </div>
              {partners.length === 0 && !error ? (
                <div className="px-5 pb-5">
                  <EmptyState title="No partners yet" description="Onboard the first one on the right." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Platform fee</TH>
                      <TH align="right">Shipments</TH>
                      <TH align="right">Fee revenue</TH>
                      <TH>Onboarded</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {partners.map((p) => (
                      <TR key={p.id}>
                        <TD className="font-medium text-primary">{p.name}</TD>
                        <TD>
                          <FeeRateEditor partnerId={p.id} currentBps={p.platformFeeBps} />
                        </TD>
                        <TD align="right" className="tabular">
                          {p.shipmentCount}
                        </TD>
                        <TD align="right" className="tabular text-success">
                          {p.feeRevenue.length === 0
                            ? "—"
                            : p.feeRevenue.map((r) => money(r.amountCents, r.currency)).join(" · ")}
                        </TD>
                        <TD className="text-secondary">{fmtDate(p.createdAt)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <div className="lg:col-span-2">
              <PartnerForm />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
