import Link from "next/link";
import { api, relativeTime } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Tag, exceptionSeverity } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Mono } from "@/components/ui/table";

const CODE_LABELS: Record<string, string> = {
  BOOKING_ROLLED: "Rolled booking",
  CUSTOMS_STOPPED: "Customs stop",
  CUSTOMS_QUERY: "Customs query",
  CONGESTION_DELAY: "Congestion delay",
  COMPLIANCE_HOLD: "Compliance hold",
  DEPARTURE_SLA_BREACH: "Departure SLA breach",
  TRANSIT_OVERRUN: "Transit overrun",
  CUSTOMS_RELEASE_SLA_BREACH: "Customs release SLA breach",
};

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  let error: string | null = null;
  const exceptions = await api.openExceptions().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  const byCode = new Map<string, typeof exceptions>();
  for (const ex of exceptions) {
    byCode.set(ex.code, [...(byCode.get(ex.code) ?? []), ex]);
  }
  // Order columns by severity so critical work sits leftmost.
  const order = Array.from(byCode.keys()).sort((a, b) => {
    const rank = (t: string) => (exceptionSeverity(t) === "critical" ? 0 : exceptionSeverity(t) === "warning" ? 1 : 2);
    return rank(a) - rank(b);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Commercial"
        title="Ops console"
        description="What needs a human today, grouped by exception type."
      />

      {error && <ErrorState message={error} />}

      {exceptions.length === 0 && !error && (
        <EmptyState title="Board is clear" description="No open exceptions right now." />
      )}

      {exceptions.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {order.map((code) => {
            const items = byCode.get(code)!;
            const tone = exceptionSeverity(code);
            return (
              <section key={code} className="w-72 shrink-0">
                <div className="mb-3 flex items-center justify-between">
                  <Tag tone={tone} dot>
                    {CODE_LABELS[code] ?? code}
                  </Tag>
                  <span className="tabular text-[11px] text-tertiary">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((ex) => (
                    <Link
                      key={ex.exceptionId}
                      href={`/shipments/${ex.shipmentId}`}
                      className="block rounded border border-hairline bg-surface p-3 transition-colors hover:border-strong hover:bg-hover"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <Mono className="font-medium text-primary">{ex.reference}</Mono>
                      </div>
                      <div className="text-[11.5px] text-secondary">
                        {ex.origin} → {ex.destination}
                      </div>
                      {ex.detail && (
                        <div className="mt-1.5 text-[11.5px] text-tertiary">{ex.detail}</div>
                      )}
                      <div className="mt-2 text-[10.5px] text-tertiary">
                        raised {relativeTime(ex.raisedAt)}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
