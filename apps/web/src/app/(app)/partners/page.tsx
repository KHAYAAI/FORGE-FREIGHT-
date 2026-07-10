import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
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

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Partners"
        description="Franchise agents booking through the platform — each pays a platform fee on their freight, set here."
      />

      {forbidden ? (
        <EmptyState
          title="Operator access only"
          description="This tenant isn't the operator tenant, so partner administration is not available."
        />
      ) : (
        <>
          {error && <ErrorState message={error} />}

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
