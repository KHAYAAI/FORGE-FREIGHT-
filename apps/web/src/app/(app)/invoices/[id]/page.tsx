import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/empty-state";
import { InvoiceDocumentView } from "@/components/ui/invoice-document";
import { InvoiceAuditPanel } from "@/components/forms/invoice-audit-panel";

export const dynamic = "force-dynamic";

/**
 * One invoice, as the document and as the audit over it.
 *
 * Deliberately the same page. Separating "the invoice" from "is the invoice
 * right" is what produces a process where the first is sent and the second
 * happens at month-end, by which time the dispute window has closed.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let error: string | null = null;

  const [doc, exceptions] = await Promise.all([
    api.invoiceDocument(id).catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.invoiceExceptions(id).catch(() => []),
  ]);

  if (!doc) return <ErrorState message={error ?? "Invoice not found"} />;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title={doc.number}
        description={`${doc.typeLabel} to ${doc.billTo.name}`}
      />

      <div className="mb-4">
        <Link href="/invoices" className="text-[12px] text-accent hover:underline">
          ← All invoices
        </Link>
      </div>

      <div className="mb-5">
        <InvoiceDocumentView doc={doc} commercial />
      </div>

      <InvoiceAuditPanel
        invoiceId={id}
        currency={doc.currency}
        initialExceptions={exceptions}
      />
    </div>
  );
}
