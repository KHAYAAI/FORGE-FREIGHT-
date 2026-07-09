import { apiGet } from "@/lib/api";

interface TimelineEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Human labels for the "where is my stuff" timeline. */
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

export default async function ShipmentTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let events: TimelineEvent[] = [];
  let error: string | null = null;
  try {
    events = await apiGet<TimelineEvent[]>(`/shipments/${id}/events`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.4rem" }}>Where is my stuff</h1>
      {error && <p style={{ color: "#dc2626" }}>API unavailable: {error}</p>}
      <ol style={{ listStyle: "none", padding: 0, position: "relative" }}>
        {events.map((event, i) => {
          const isLast = i === events.length - 1;
          return (
            <li
              key={event.eventId}
              style={{ display: "flex", gap: "1rem", paddingBottom: "1.5rem" }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: isLast ? "#2563eb" : "#9ca3af",
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                />
                {!isLast && <span style={{ width: 2, flex: 1, background: "#e5e7eb" }} />}
              </div>
              <div>
                <strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                  {new Date(event.occurredAt).toLocaleString("en-ZA")}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {events.length === 0 && !error && <p>No events yet.</p>}
    </main>
  );
}
