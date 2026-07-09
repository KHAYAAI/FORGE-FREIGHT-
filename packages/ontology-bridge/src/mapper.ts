import { randomUUID } from "node:crypto";
import {
  ChargeAccrued,
  EntryReleased,
  InvoiceIssued,
  PaymentReceived,
  PodConfirmed,
  ShipmentBooked,
  VesselDeparted,
  parseEvent,
  type EventEnvelope,
  type Money,
} from "@forge-freight/events";
import { LedgerEvent } from "./ontology.js";

/**
 * The freight-event → Revenue Ontology mapping. See docs/ontology-bridge.md
 * for the full specification; this module is its executable form.
 *
 * Contract:
 * - Only events flagged `financial: true` in the catalogue produce ledger
 *   events. Everything else returns [].
 * - One freight event may fan out to multiple ledger events (e.g.
 *   entry.released → disbursement + finance trigger).
 * - Mapping is pure and deterministic apart from ledgerEventId generation:
 *   same input, same financial meaning. Replays are safe because the ledger
 *   dedupes on (sourceEventId, type).
 */
export function mapFreightEvent(raw: unknown): LedgerEvent[] {
  const event = parseEvent(raw);

  switch (event.type) {
    case ShipmentBooked.type:
      return mapShipmentBooked(event);
    case VesselDeparted.type:
      return mapVesselDeparted(event);
    case ChargeAccrued.type:
      return mapChargeAccrued(event);
    case EntryReleased.type:
      return mapEntryReleased(event);
    case PodConfirmed.type:
      return mapPodConfirmed(event);
    case InvoiceIssued.type:
      return mapInvoiceIssued(event);
    case PaymentReceived.type:
      return mapPaymentReceived(event);
    default:
      return [];
  }
}

function base(event: EventEnvelope) {
  return {
    ledgerEventId: randomUUID(),
    sourceEventId: event.eventId,
    sourceEventType: event.type,
    tenantId: event.tenantId,
    shipmentId: event.shipmentId,
    counterpartyId: null as string | null,
    amount: null as Money | null,
    trigger: null,
    signal: null,
    occurredAt: event.occurredAt,
    metadata: {} as Record<string, unknown>,
  };
}

function mapShipmentBooked(event: EventEnvelope): LedgerEvent[] {
  const p = ShipmentBooked.schema.parse(event.payload);
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "credit.signal",
      signal: "SHIPMENT_OPENED",
      counterpartyId: p.customerId,
      metadata: { origin: p.origin, destination: p.destination, mode: p.mode },
    }),
  ];
}

function mapVesselDeparted(event: EventEnvelope): LedgerEvent[] {
  const p = VesselDeparted.schema.parse(event.payload);
  // Milestone performance history is credit signal; the freight charge itself
  // arrives separately as charge.accrued (billing owns amounts, not tracking).
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "credit.signal",
      signal: "MILESTONE_ON_TIME",
      metadata: { milestone: "vessel.departed", port: p.port, source: p.source },
    }),
  ];
}

function mapChargeAccrued(event: EventEnvelope): LedgerEvent[] {
  const p = ChargeAccrued.schema.parse(event.payload);
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "obligation.created",
      amount: p.sell,
      metadata: { chargeCode: p.chargeCode, kind: p.kind, triggeredBy: p.triggeredBy },
    }),
  ];
}

function mapEntryReleased(event: EventEnvelope): LedgerEvent[] {
  const p = EntryReleased.schema.parse(event.payload);
  const dutiesAndVat: Money = {
    amountCents: p.dutiesTotal.amountCents + p.vatTotal.amountCents,
    currency: p.dutiesTotal.currency,
  };
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "disbursement.incurred",
      amount: dutiesAndVat,
      metadata: { customsEntryId: p.customsEntryId, releaseRef: p.releaseRef },
    }),
    LedgerEvent.parse({
      ...base(event),
      type: "finance.trigger",
      trigger: "DUTY_FINANCING_ELIGIBLE",
      amount: dutiesAndVat,
      metadata: { customsEntryId: p.customsEntryId },
    }),
  ];
}

function mapPodConfirmed(event: EventEnvelope): LedgerEvent[] {
  const p = PodConfirmed.schema.parse(event.payload);
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "finance.trigger",
      trigger: "FACTORING_CLOCK_START",
      metadata: { legId: p.legId, documentId: p.documentId },
    }),
  ];
}

function mapInvoiceIssued(event: EventEnvelope): LedgerEvent[] {
  const p = InvoiceIssued.schema.parse(event.payload);
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "receivable.recognised",
      counterpartyId: p.customerId,
      amount: p.total,
      metadata: { invoiceId: p.invoiceId, dueDate: p.dueDate, chargeIds: p.chargeIds },
    }),
  ];
}

function mapPaymentReceived(event: EventEnvelope): LedgerEvent[] {
  const p = PaymentReceived.schema.parse(event.payload);
  return [
    LedgerEvent.parse({
      ...base(event),
      type: "receivable.settled",
      amount: p.amount,
      metadata: { invoiceId: p.invoiceId, paymentRef: p.paymentRef },
    }),
  ];
}
