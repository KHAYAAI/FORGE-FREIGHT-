import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PartyForm } from "@/components/forms/party-form";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  let error: string | null = null;
  const parties = await api.listParties().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  return (
    <div>
      <PageHeader
        eyebrow="Compliance"
        title="Parties"
        description="Customers, carriers, and counterparties — every one screened against sanctions lists on creation."
      />

      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={`On file (${parties.length})`} />
          </div>
          {parties.length === 0 && !error ? (
            <div className="px-5 pb-5">
              <EmptyState title="No parties yet" description="Register the first counterparty on the right." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Country</TH>
                  <TH>Contact</TH>
                  <TH>Added</TH>
                </TR>
              </THead>
              <tbody>
                {parties.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-primary">{p.name}</TD>
                    <TD>
                      {p.country ? <Tag tone="neutral">{p.country}</Tag> : <span className="text-tertiary">—</span>}
                    </TD>
                    <TD className="text-secondary">{p.email ?? p.phone ?? "—"}</TD>
                    <TD className="text-secondary">{fmtDate(p.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <PartyForm />
        </div>
      </div>
    </div>
  );
}
