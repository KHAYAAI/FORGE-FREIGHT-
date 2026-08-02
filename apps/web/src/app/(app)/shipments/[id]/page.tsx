import Link from "next/link";
import type { ReactNode } from "react";
import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { ShipmentStatusTag } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/empty-state";
import { Mono } from "@/components/ui/table";
import { ConsignmentPanel } from "@/components/ui/consignment-panel";

const EVENT_LABELS: Record<string, string> = {
  "shipment.booked": "Booking confirmed",
  "booking.rolled": "Booking rolled by carrier",
  "container.gated_in": "Container gated in at origin terminal",
  "container.loaded": "Container loaded on vessel",
  "vessel.departed": "Vessel departed",
  "vessel.arrived": "Vessel arrived",
  "container.discharged": "Container discharged",
  "container.gated_out": "Container gated out — on delivery",
  "entry.prepared": "Customs entry prepared",
  "entry.submitted": "Customs entry submitted",
  "entry.queried": "Customs query raised",
  "entry.stopped": "Customs stop",
  "entry.released": "Customs released",
  "pod.confirmed": "Delivered — proof of delivery confirmed",
  "invoice.issued": "Invoice issued",
  "payment.received": "Payment received",
  "shipment.exception_raised": "Exception raised",
  "shipment.exception_cleared": "Exception resolved",
  "quote.issued": "Quote issued",
  "quote.accepted": "Quote accepted",
  "charge.accrued": "Charge accrued",
  "document.uploaded": "Document uploaded",
  "document.extracted": "Document data extracted",
  "document.approved": "Document approved",
  "party.screened": "Compliance screening completed",
  "compliance.hold_placed": "Compliance hold placed",
};

export const dynamic = "force-dynamic";

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let error: string | null = null;

  const [shipment, events, charges, customsEntry] = await Promise.all([
    api.getShipment(id).catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.shipmentTimeline(id).catch(() => []),
    api.shipmentCharges(id).catch(() => []),
    api.entryByShipment(id).catch(() => null),
  ]);

  const totalsByCurrency = new Map<string, number>();
  for (const c of charges) {
    totalsByCurrency.set(c.currency, (totalsByCurrency.get(c.currency) ?? 0) + Number(c.amountCents));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Shipment"
        title={shipment?.reference ?? id}
        description={shipment ? `${shipment.origin} → ${shipment.destination}` : undefined}
        actions={shipment ? <ShipmentStatusTag status={shipment.status} /> : undefined}
      />

      {error && <ErrorState message={error} />}

      {shipment?.consignment && (
        <div className="mb-4">
          <ConsignmentPanel consignment={shipment.consignment} commercial />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3">
          <PanelHeader title="Event timeline" eyebrow="Where is my stuff" />
          {events.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-tertiary">No events yet.</div>
          ) : (
            <ol className="relative">
              {events.map((event, i) => {
                const isLast = i === events.length - 1;
                return (
                  <li key={event.eventId} className="flex gap-3 pb-6 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isLast ? "bg-accent" : "bg-strong"}`}
                      />
                      {!isLast && <span className="w-px flex-1 bg-hairline" />}
                    </div>
                    <div className="pb-1">
                      <div className="text-[12.5px] font-medium text-primary">
                        {EVENT_LABELS[event.type] ?? event.type}
                      </div>
                      <div className="mt-0.5 text-[11px] text-tertiary">{fmtDate(event.occurredAt)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <Panel>
            <PanelHeader title="Shipment info" />
            <dl className="flex flex-col gap-3 text-[12.5px]">
              <Row label="Reference" value={<Mono>{shipment?.reference ?? "—"}</Mono>} />
              <Row label="Origin" value={<Mono>{shipment?.origin ?? "—"}</Mono>} />
              <Row label="Destination" value={<Mono>{shipment?.destination ?? "—"}</Mono>} />
              <Row label="Booked" value={fmtDate(shipment?.createdAt)} />
            </dl>
          </Panel>

          <Panel>
            <PanelHeader
              title="Charges"
              actions={
                <Link href="/invoices" className="text-[11px] font-medium text-accent hover:underline">
                  Invoices →
                </Link>
              }
            />
            {charges.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-tertiary">No charges accrued yet.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {charges.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-secondary">{c.kind.replaceAll("_", " ")}</span>
                    <span className="tabular text-primary">{money(c.amountCents, c.currency)}</span>
                  </div>
                ))}
                <div className="mt-1 border-t border-hairline pt-2">
                  {Array.from(totalsByCurrency.entries()).map(([currency, total]) => (
                    <div key={currency} className="flex items-center justify-between text-[12.5px] font-semibold">
                      <span className="text-primary">Total ({currency})</span>
                      <span className="tabular text-accent-strong">{money(total, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Related" />
            <div className="flex flex-col gap-2 text-[12px]">
              {customsEntry ? (
                <Link href={`/customs/${customsEntry.id}`} className="text-accent hover:underline">
                  View customs entry ({customsEntry.status}) →
                </Link>
              ) : (
                <Link href="/customs" className="text-accent hover:underline">
                  Create customs entry →
                </Link>
              )}
              <Link href="/documents" className="text-accent hover:underline">
                View shipment documents →
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">{label}</dt>
      <dd className="text-right text-primary">{value}</dd>
    </div>
  );
}
