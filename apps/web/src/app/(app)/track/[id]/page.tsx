import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { ShipmentStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ConsignmentPanel } from "@/components/ui/consignment-panel";

/**
 * Milestone wording for a shipper rather than an operator: "your container was
 * loaded", not "container.loaded". Anything not in this map is a milestone the
 * customer has no stake in and is dropped rather than shown raw — the API
 * already withholds charge and quote events.
 */
const MILESTONES: Record<string, string> = {
  "shipment.booked": "Booking confirmed",
  "booking.rolled": "Carrier moved the booking to a later sailing",
  "container.gated_in": "Container received at the origin terminal",
  "container.loaded": "Container loaded on the vessel",
  "vessel.departed": "Vessel departed",
  "vessel.arrived": "Vessel arrived at the destination port",
  "container.discharged": "Container discharged",
  "container.gated_out": "Out for delivery",
  "entry.submitted": "Customs entry submitted",
  "entry.queried": "Customs raised a query",
  "entry.stopped": "Held by customs",
  "entry.released": "Cleared by customs",
  "pod.confirmed": "Delivered",
  "invoice.issued": "Invoice issued",
  "payment.received": "Payment received",
};

export const dynamic = "force-dynamic";

export default async function TrackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let error: string | null = null;

  const [shipment, events] = await Promise.all([
    api.portalShipment(id).catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.portalTimeline(id).catch(() => []),
  ]);

  if (error) return <ErrorState message={error} />;

  if (!shipment) {
    return (
      <div>
        <PageHeader eyebrow="Your cargo" title="Shipment" />
        <EmptyState
          title="Not found"
          description="This shipment either doesn't exist or isn't one of yours."
        />
        <Link href="/track" className="mt-4 inline-block text-[12px] text-accent hover:underline">
          ← Back to my shipments
        </Link>
      </div>
    );
  }

  const milestones = events.filter((e) => MILESTONES[e.type]);

  return (
    <div>
      <PageHeader
        eyebrow="Your cargo"
        title={shipment.reference}
        description={`${shipment.origin} → ${shipment.destination}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ShipmentStatusTag status={shipment.status} />
        <span className="text-[12px] text-secondary">Booked {fmtDate(shipment.createdAt)}</span>
      </div>

      {shipment.consignment && (
        <div className="mb-4">
          {/* The customer's own declaration coming back to them. Handling
              requirements are the forwarder's obligations to carriers and
              terminals, so `commercial` stays off. */}
          <ConsignmentPanel consignment={shipment.consignment} />
        </div>
      )}

      <Panel>
        <PanelHeader title="Journey" eyebrow="What has happened so far" />
        {milestones.length === 0 ? (
          <EmptyState
            title="Nothing to report yet"
            description="Milestones appear here as your cargo moves."
          />
        ) : (
          <ol className="flex flex-col gap-0">
            {milestones.map((event, i) => (
              <li key={event.eventId} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  {i < milestones.length - 1 && <span className="w-px flex-1 bg-hairline" />}
                </div>
                <div className="pb-5">
                  <div className="text-[13px] font-medium text-primary">
                    {MILESTONES[event.type]}
                  </div>
                  <div className="text-[11.5px] text-tertiary">{fmtDate(event.occurredAt)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Link href="/track" className="mt-4 inline-block text-[12px] text-accent hover:underline">
        ← Back to my shipments
      </Link>
    </div>
  );
}
