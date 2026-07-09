import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContainerGatedIn,
  EntryReleased,
  InvoiceIssued,
  makeEvent,
  PodConfirmed,
  ShipmentBooked,
} from "@forge-freight/events";
import { mapFreightEvent } from "../src/index.js";

const actor = { kind: "SYSTEM" as const, id: "test" };
const tenantId = randomUUID();
const shipmentId = randomUUID();

describe("ontology bridge mapper", () => {
  it("entry.released fans out to disbursement + duty-financing trigger", () => {
    const event = makeEvent({
      definition: EntryReleased,
      tenantId,
      actor,
      shipmentId,
      payload: {
        customsEntryId: randomUUID(),
        dutiesTotal: { amountCents: 84_500_00, currency: "ZAR" },
        vatTotal: { amountCents: 63_200_00, currency: "ZAR" },
        releaseRef: "REL-123",
      },
    });

    const ledger = mapFreightEvent(event);
    expect(ledger).toHaveLength(2);
    const disbursement = ledger.find((l) => l.type === "disbursement.incurred");
    const trigger = ledger.find((l) => l.type === "finance.trigger");
    expect(disbursement?.amount).toEqual({
      amountCents: 147_700_00,
      currency: "ZAR",
    });
    expect(trigger?.trigger).toBe("DUTY_FINANCING_ELIGIBLE");
    expect(ledger.every((l) => l.sourceEventId === event.eventId)).toBe(true);
  });

  it("pod.confirmed starts the factoring clock", () => {
    const event = makeEvent({
      definition: PodConfirmed,
      tenantId,
      actor,
      shipmentId,
      payload: { legId: randomUUID(), signedBy: "T. Mokoena", documentId: null },
    });
    const ledger = mapFreightEvent(event);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.type).toBe("finance.trigger");
    expect(ledger[0]?.trigger).toBe("FACTORING_CLOCK_START");
  });

  it("invoice.issued recognises a receivable against the customer", () => {
    const customerId = randomUUID();
    const event = makeEvent({
      definition: InvoiceIssued,
      tenantId,
      actor,
      shipmentId,
      payload: {
        invoiceId: randomUUID(),
        customerId,
        total: { amountCents: 412_350_00, currency: "ZAR" },
        dueDate: new Date("2026-08-15T00:00:00Z").toISOString(),
        chargeIds: [randomUUID()],
      },
    });
    const ledger = mapFreightEvent(event);
    expect(ledger[0]?.type).toBe("receivable.recognised");
    expect(ledger[0]?.counterpartyId).toBe(customerId);
  });

  it("shipment.booked emits an exposure credit signal", () => {
    const event = makeEvent({
      definition: ShipmentBooked,
      tenantId,
      actor,
      shipmentId,
      payload: {
        bookingId: randomUUID(),
        quoteId: null,
        customerId: randomUUID(),
        origin: "CNSHA",
        destination: "ZADUR",
        mode: "OCEAN",
        incoterm: "FOB",
        containers: [{ containerType: "40HC", quantity: 2 }],
        carrierBookingRef: null,
      },
    });
    const ledger = mapFreightEvent(event);
    expect(ledger[0]?.type).toBe("credit.signal");
    expect(ledger[0]?.signal).toBe("SHIPMENT_OPENED");
  });

  it("non-financial events produce no ledger events", () => {
    const event = makeEvent({
      definition: ContainerGatedIn,
      tenantId,
      actor,
      shipmentId,
      payload: {
        containerNumber: "MSKU1234565",
        location: "CNSHA",
        source: "DCSA",
      },
    });
    expect(mapFreightEvent(event)).toEqual([]);
  });
});
