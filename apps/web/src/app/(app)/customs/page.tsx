import Link from "next/link";
import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { CustomsStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { CreateEntryForm } from "@/components/forms/create-entry-form";

export const dynamic = "force-dynamic";

export default async function CustomsPage() {
  let error: string | null = null;
  const entries = await api.listEntries().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  return (
    <div>
      <PageHeader
        eyebrow="Compliance"
        title="Customs"
        description="HS classification, duty/VAT calculation, and bureau submission — DRAFT through RELEASED."
      />

      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={`Entries (${entries.length})`} />
          </div>
          {entries.length === 0 && !error ? (
            <div className="px-5 pb-5">
              <EmptyState title="No entries yet" description="Create one from a shipment on the right." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entry</TH>
                  <TH>Status</TH>
                  <TH align="right">Duty + VAT</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <tbody>
                {entries.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Link href={`/customs/${e.id}`} className="font-medium text-accent hover:underline">
                        <Mono>{e.id.slice(0, 8)}</Mono>
                      </Link>
                    </TD>
                    <TD>
                      <CustomsStatusTag status={e.status} />
                    </TD>
                    <TD align="right" className="tabular">
                      {e.dutiesTotalCents != null && e.vatTotalCents != null
                        ? money(Number(e.dutiesTotalCents) + Number(e.vatTotalCents), e.currency)
                        : "—"}
                    </TD>
                    <TD className="text-secondary">{fmtDate(e.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <CreateEntryForm />
        </div>
      </div>
    </div>
  );
}
