import { ledgerEvents, type Db } from "@forge-freight/db";
import { getEventDefinition } from "@forge-freight/events";
import { mapFreightEvent } from "@forge-freight/ontology-bridge";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

/**
 * Feeds the Revenue Ontology: financial freight events run through the
 * ontology bridge and land in ledger_events, which ForgePay consumes and the
 * trade-finance views read. Replay-safe via the (sourceEventId, type) unique
 * index — duplicates are dropped on conflict.
 */
export class LedgerSink implements EventHandler {
  readonly name = "ledger-sink";

  async handle(event: StoredEvent, db: Db): Promise<void> {
    const def = getEventDefinition(event.type, event.version);
    if (!def?.financial) return;

    const mapped = mapFreightEvent({
      eventId: event.eventId,
      shipmentId: event.shipmentId,
      tenantId: event.tenantId,
      type: event.type,
      version: event.version,
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: event.recordedAt.toISOString(),
      actor: { kind: "SYSTEM", id: "ledger-sink" },
      payload: event.payload,
    });

    for (const ledger of mapped) {
      await db
        .insert(ledgerEvents)
        .values({
          ledgerEventId: ledger.ledgerEventId,
          type: ledger.type,
          sourceEventId: ledger.sourceEventId,
          sourceEventType: ledger.sourceEventType,
          tenantId: ledger.tenantId,
          shipmentId: ledger.shipmentId,
          counterpartyId: ledger.counterpartyId,
          amountCents: ledger.amount?.amountCents ?? null,
          currency: ledger.amount?.currency ?? null,
          trigger: ledger.trigger,
          signal: ledger.signal,
          occurredAt: new Date(ledger.occurredAt),
          metadata: ledger.metadata,
        })
        .onConflictDoNothing();
    }
  }
}
