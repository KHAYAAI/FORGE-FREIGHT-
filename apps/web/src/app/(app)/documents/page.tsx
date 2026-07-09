import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { UploadForm } from "@/components/forms/upload-form";
import { DocumentReviewCard } from "@/components/forms/document-review-card";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  let error: string | null = null;
  const queue = await api.reviewQueue().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  return (
    <div>
      <PageHeader
        eyebrow="Compliance"
        title="Documents"
        description="Claude-extracted shipping documents, gated for human review below 0.85 confidence."
      />

      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel>
            <PanelHeader title={`In review (${queue.length})`} />
            {queue.length === 0 && !error ? (
              <EmptyState title="Queue is empty" description="Nothing waiting on a human right now." />
            ) : (
              <div className="flex flex-col gap-3">
                {queue.map((doc) => (
                  <DocumentReviewCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <UploadForm />
        </div>
      </div>
    </div>
  );
}
