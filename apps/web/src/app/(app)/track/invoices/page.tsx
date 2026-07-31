import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { InvoiceStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

/** A shipper's own invoices. Read-only — payment is arranged with the forwarder. */
export default async function TrackInvoicesPage() {
  let error: string | null = null;
  const invoices = await api.portalInvoices().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  return (
    <div>
      <PageHeader
        eyebrow="Your account"
        title="My Invoices"
        description="What your forwarder has billed you for, and what's still outstanding."
      />

      {error && <ErrorState message={error} />}

      <Panel>
        {invoices.length === 0 && !error ? (
          <EmptyState
            title="No invoices yet"
            description="Invoices appear here once your forwarder issues them."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Status</TH>
                <TH align="right">Amount</TH>
                <TH>Due</TH>
                <TH>Issued</TH>
              </TR>
            </THead>
            <tbody>
              {invoices.map((invoice) => (
                <TR key={invoice.id}>
                  <TD>
                    <Mono className="text-primary">{invoice.number}</Mono>
                  </TD>
                  <TD>
                    <InvoiceStatusTag status={invoice.status} />
                  </TD>
                  <TD align="right" className="tabular text-primary">
                    {money(invoice.totalCents, invoice.currency)}
                  </TD>
                  <TD className="text-secondary">{fmtDate(invoice.dueDate)}</TD>
                  <TD className="text-secondary">{fmtDate(invoice.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
