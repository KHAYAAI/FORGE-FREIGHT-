import { createDb } from "@forge-freight/db";
import { makeEvent, ShipmentExceptionRaised } from "@forge-freight/events";
import { events } from "@forge-freight/db";

const db = createDb();

/**
 * Raise an exception by appending the catalogue event — the API's projector
 * turns it into a shipment_exceptions row on the ops kanban. Idempotency is
 * handled downstream (projector skips already-open codes).
 */
export async function raiseException(
  shipmentId: string,
  tenantId: string,
  code:
    | "BOOKING_ROLLED"
    | "CUSTOMS_STOP"
    | "CUSTOMS_QUERY"
    | "CONGESTION_DELAY"
    | "COMPLIANCE_HOLD",
  detail: string,
): Promise<void> {
  const event = makeEvent({
    definition: ShipmentExceptionRaised,
    tenantId,
    actor: { kind: "WORKFLOW", id: "shipment-lifecycle" },
    shipmentId,
    payload: { code, detail },
  });
  await db.insert(events).values({
    eventId: event.eventId,
    shipmentId: event.shipmentId,
    tenantId: event.tenantId,
    type: event.type,
    version: event.version,
    occurredAt: new Date(event.occurredAt),
    recordedAt: new Date(event.recordedAt),
    actor: event.actor,
    payload: event.payload,
  });
}
