import { events, type Db } from "@forge-freight/db";
import type { EventEnvelope } from "@forge-freight/events";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Append a catalogue event inside the caller's transaction — the outbox
 * relay ships it to Redpanda from here. Never call outside the transaction
 * that writes the projection, or the two can diverge.
 */
export async function appendEvent(tx: Db | Tx, event: EventEnvelope): Promise<void> {
  await tx.insert(events).values({
    eventId: event.eventId,
    shipmentId: event.shipmentId,
    tenantId: event.tenantId,
    type: event.type,
    version: event.version,
    occurredAt: new Date(event.occurredAt),
    recordedAt: new Date(event.recordedAt),
    actor: event.actor,
    sourceRef: event.sourceRef ?? null,
    payload: event.payload,
  });
}
