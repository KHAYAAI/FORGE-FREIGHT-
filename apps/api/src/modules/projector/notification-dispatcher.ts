import { eq } from "drizzle-orm";
import { bookings, parties, shipments, type Db } from "@forge-freight/db";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

/** Customer-facing milestones worth a WhatsApp/SMS/email ping — not every internal event. */
const MILESTONE_LABELS: Record<string, string> = {
  "vessel.departed": "Vessel departed",
  "vessel.arrived": "Vessel arrived at destination port",
  "entry.released": "Customs cleared",
  "pod.confirmed": "Delivered",
};

/**
 * Forwards shipment milestones to Novu, which routes them to WhatsApp/SMS/
 * email per the workflow's own channel configuration. A no-op — not a
 * failure — when NOVU_API_KEY isn't set (NotificationsService.enabled).
 */
export class NotificationDispatcher implements EventHandler {
  readonly name = "notification-dispatcher";

  constructor(private readonly notifications: NotificationsService) {}

  async handle(event: StoredEvent, db: Db): Promise<void> {
    const label = MILESTONE_LABELS[event.type];
    if (!label || !event.shipmentId || !this.notifications.enabled) return;

    const [shipment] = await db
      .select({ reference: shipments.reference, bookingId: shipments.bookingId })
      .from(shipments)
      .where(eq(shipments.id, event.shipmentId));
    if (!shipment) return;

    const [booking] = await db
      .select({ customerId: bookings.customerId })
      .from(bookings)
      .where(eq(bookings.id, shipment.bookingId));
    if (!booking) return;

    const [customer] = await db
      .select({ id: parties.id, email: parties.email, phone: parties.phone })
      .from(parties)
      .where(eq(parties.id, booking.customerId));
    if (!customer) return;

    await this.notifications.trigger(
      this.notifications.milestoneWorkflowId,
      { subscriberId: customer.id, email: customer.email, phone: customer.phone },
      {
        reference: shipment.reference,
        milestone: label,
        eventType: event.type,
        occurredAt: event.occurredAt.toISOString(),
      },
    );
  }
}
