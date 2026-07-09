import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, InfoBanner } from "@/components/ui/empty-state";
import { QuoteForm } from "@/components/forms/quote-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  let error: string | null = null;
  const parties = await api.listParties().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  return (
    <div>
      <PageHeader
        eyebrow="Commercial"
        title="Instant quote"
        description="Itemised multicurrency pricing in seconds — book in one click, no back-and-forth."
      />
      {error && <ErrorState message={error} />}
      {!error && parties.length === 0 && (
        <InfoBanner>
          No parties on file yet. <Link href="/parties" className="font-medium text-accent hover:underline">Create a customer</Link> before quoting.
        </InfoBanner>
      )}
      {parties.length > 0 && <QuoteForm parties={parties} />}
    </div>
  );
}
