import { events, type Db } from "@forge-freight/db";
import type { EventEnvelope } from "@forge-freight/events";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Append a catalogue event inside the caller's transaction — the outbox
 * relay ships it to Redpanda from here. Never call outside the transaction
 * that writes the projection, or the two can diverge.
 */
export async function appendEvent(tx: Db | Tx, event: EventEnvelope): Promise<void> {
  await tx.insert(events).values(toRow(event));
}

/**
 * Adapter variant: duplicate deliveries of the same external message (same
 * type + sourceRef) are dropped by the partial unique index — webhooks and
 * EDI feeds redeliver, canonical history must not.
 */
export async function appendEventIdempotent(
  tx: Db | Tx,
  event: EventEnvelope,
): Promise<boolean> {
  const inserted = await tx
    .insert(events)
    .values(toRow(event))
    .onConflictDoNothing()
    .returning({ eventId: events.eventId });
  return inserted.length > 0;
}

function toRow(event: EventEnvelope) {
  return {
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
  };
}
