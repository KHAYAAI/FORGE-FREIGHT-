import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { InvoicesTable } from "@/components/forms/invoices-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  let error: string | null = null;
  const invoices = await api.listInvoices().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  const outstanding = invoices.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
  const overdue = invoices.filter((i) => i.status === "OVERDUE");

  // Counting unpaid invoices is not the same question as how much money is
  // owed, and the second one is the one a finance lead actually asks.
  const owedByCurrency = new Map<string, number>();
  for (const invoice of outstanding) {
    const owed = invoice.outstandingCents ?? invoice.totalCents;
    if (owed > 0) owedByCurrency.set(invoice.currency, (owedByCurrency.get(invoice.currency) ?? 0) + owed);
  }
  const owed = [...owedByCurrency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([currency, cents]) => money(cents, currency));

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Invoices"
        description="Charges billed per shipment, grouped by currency — record payments as they settle."
      />

      {error && <ErrorState message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total invoices" value={invoices.length} />
        <StatTile
          label="Outstanding"
          value={outstanding.length}
          tone={outstanding.length > 0 ? "warning" : "success"}
        />
        <StatTile
          label="Owed"
          value={owed.length === 0 ? "—" : owed[0]!}
          sub={owed.length > 1 ? owed.slice(1).join(" · ") : undefined}
          tone={owed.length > 0 ? "warning" : "success"}
        />
        <StatTile label="Overdue" value={overdue.length} tone={overdue.length > 0 ? "critical" : "success"} />
      </div>

      <Panel>
        {invoices.length === 0 && !error ? (
          <EmptyState title="No invoices yet" description="Issue one from a shipment's charges." />
        ) : (
          <InvoicesTable invoices={invoices} />
        )}
      </Panel>
    </div>
  );
}
