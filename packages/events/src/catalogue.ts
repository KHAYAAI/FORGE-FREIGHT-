import { z } from "zod";
import {
  ContainerNumber,
  ContainerType,
  ImoNumber,
  Incoterm,
  Money,
  TransportMode,
  Unlocode,
} from "./common.js";

/**
 * The versioned event catalogue.
 *
 * Rules:
 * - Event types are dot-namespaced `domain.fact`, past tense — they record
 *   facts, not commands.
 * - Payload schemas are additive within a version. Any breaking change bumps
 *   the version and BOTH versions stay in the catalogue (consumers migrate
 *   at their own pace).
 * - Adapters (AIS, DCSA, EDIFACT, Traccar) emit ONLY events from this
 *   catalogue. No adapter writes to projections directly.
 * - Events flagged `financial: true` are consumed by the ontology bridge and
 *   mapped to Revenue Ontology canonical events (see
 *   @forge-freight/ontology-bridge).
 */
export interface EventDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  version: number;
  schema: T;
  /** True if this event has financial meaning and crosses the ontology bridge. */
  financial: boolean;
  description: string;
}

function defineEvent<T extends z.ZodTypeAny>(
  def: EventDefinition<T>,
): EventDefinition<T> {
  return def;
}

// ---------------------------------------------------------------------------
// Quote & booking
// ---------------------------------------------------------------------------

export const QuoteIssued = defineEvent({
  type: "quote.issued",
  version: 1,
  financial: false,
  description: "An itemised quote was issued to a customer.",
  schema: z.object({
    quoteId: z.string().uuid(),
    customerId: z.string().uuid(),
    origin: Unlocode,
    destination: Unlocode,
    mode: TransportMode,
    containerType: ContainerType.nullable(),
    incoterm: Incoterm,
    validUntil: z.string().datetime({ offset: true }),
    lines: z.array(
      z.object({
        chargeCode: z.string(),
        description: z.string(),
        buy: Money,
        sell: Money,
        quantity: z.number().int().positive(),
      }),
    ),
    totalSell: Money,
  }),
});

export const QuoteAccepted = defineEvent({
  type: "quote.accepted",
  version: 1,
  financial: false,
  description: "Customer accepted a quote; a booking may now be created.",
  schema: z.object({
    quoteId: z.string().uuid(),
    customerId: z.string().uuid(),
  }),
});

export const ShipmentBooked = defineEvent({
  type: "shipment.booked",
  version: 1,
  financial: true,
  description:
    "A booking was confirmed and a shipment opened. Starts the Temporal lifecycle workflow.",
  schema: z.object({
    bookingId: z.string().uuid(),
    quoteId: z.string().uuid().nullable(),
    customerId: z.string().uuid(),
    origin: Unlocode,
    destination: Unlocode,
    mode: TransportMode,
    incoterm: Incoterm,
    containers: z.array(
      z.object({ containerType: ContainerType, quantity: z.number().int().positive() }),
    ),
    carrierBookingRef: z.string().nullable(),
  }),
});

export const BookingRolled = defineEvent({
  type: "booking.rolled",
  version: 1,
  financial: false,
  description:
    "Carrier rolled the booking to a later vessel/voyage. Ugly-path exception handled by the shipment workflow.",
  schema: z.object({
    bookingId: z.string().uuid(),
    previousVesselImo: ImoNumber.nullable(),
    newVesselImo: ImoNumber.nullable(),
    newEtd: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Container & vessel milestones (tracking-ingest adapters)
// ---------------------------------------------------------------------------

export const ContainerGatedIn = defineEvent({
  type: "container.gated_in",
  version: 1,
  financial: false,
  description: "Container gated in at origin terminal (CODECO / DCSA T&T).",
  schema: z.object({
    containerNumber: ContainerNumber,
    location: Unlocode,
    source: z.enum(["DCSA", "EDIFACT", "MANUAL"]),
  }),
});

export const ContainerLoaded = defineEvent({
  type: "container.loaded",
  version: 1,
  financial: false,
  description: "Container loaded on board vessel.",
  schema: z.object({
    containerNumber: ContainerNumber,
    vesselImo: ImoNumber.nullable(),
    location: Unlocode,
    source: z.enum(["DCSA", "EDIFACT", "MANUAL"]),
  }),
});

export const VesselDeparted = defineEvent({
  type: "vessel.departed",
  version: 1,
  financial: true,
  description:
    "Vessel departed origin port. Accrues ocean freight charges (billing) and is the first AIS-verifiable milestone.",
  schema: z.object({
    vesselImo: ImoNumber,
    vesselName: z.string().nullable(),
    port: Unlocode,
    source: z.enum(["AIS", "DCSA", "EDIFACT", "MANUAL"]),
    etaDestination: z.string().datetime({ offset: true }).nullable(),
  }),
});

export const VesselArrived = defineEvent({
  type: "vessel.arrived",
  version: 1,
  financial: false,
  description: "Vessel arrived at destination port.",
  schema: z.object({
    vesselImo: ImoNumber,
    port: Unlocode,
    source: z.enum(["AIS", "DCSA", "EDIFACT", "MANUAL"]),
  }),
});

export const ContainerDischarged = defineEvent({
  type: "container.discharged",
  version: 1,
  financial: false,
  description: "Container discharged from vessel at destination.",
  schema: z.object({
    containerNumber: ContainerNumber,
    location: Unlocode,
    source: z.enum(["DCSA", "EDIFACT", "MANUAL"]),
  }),
});

export const ContainerGatedOut = defineEvent({
  type: "container.gated_out",
  version: 1,
  financial: false,
  description: "Container gated out of destination terminal (start of road leg).",
  schema: z.object({
    containerNumber: ContainerNumber,
    location: Unlocode,
    truckerId: z.string().uuid().nullable(),
    source: z.enum(["DCSA", "EDIFACT", "TRACCAR", "MANUAL"]),
  }),
});

export const RoadPositionReported = defineEvent({
  type: "road.position_reported",
  version: 1,
  financial: false,
  description: "GPS ping for a road leg (Traccar webhook).",
  schema: z.object({
    legId: z.string().uuid(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    speedKph: z.number().nonnegative().nullable(),
    deviceId: z.string(),
  }),
});

export const PodConfirmed = defineEvent({
  type: "pod.confirmed",
  version: 1,
  financial: true,
  description:
    "Proof of delivery confirmed. Closes the shipment workflow and starts the invoice-factoring clock in the Revenue Ontology.",
  schema: z.object({
    legId: z.string().uuid(),
    signedBy: z.string().nullable(),
    documentId: z.string().uuid().nullable(),
  }),
});

export const ShipmentExceptionRaised = defineEvent({
  type: "shipment.exception_raised",
  version: 1,
  financial: false,
  description:
    "An exception needs a human: rolled booking, customs stop/query, congestion delay, compliance hold. Feeds the ops kanban.",
  schema: z.object({
    code: z.enum([
      "BOOKING_ROLLED",
      "CUSTOMS_STOP",
      "CUSTOMS_QUERY",
      "CONGESTION_DELAY",
      "COMPLIANCE_HOLD",
    ]),
    detail: z.string().nullable(),
  }),
});

export const ShipmentExceptionCleared = defineEvent({
  type: "shipment.exception_cleared",
  version: 1,
  financial: false,
  description: "A previously raised exception was resolved.",
  schema: z.object({
    code: z.enum([
      "BOOKING_ROLLED",
      "CUSTOMS_STOP",
      "CUSTOMS_QUERY",
      "CONGESTION_DELAY",
      "COMPLIANCE_HOLD",
    ]),
    detail: z.string().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Customs
// ---------------------------------------------------------------------------

export const EntryPrepared = defineEvent({
  type: "entry.prepared",
  version: 1,
  financial: false,
  description: "Customs entry prepared and ready for bureau submission.",
  schema: z.object({
    customsEntryId: z.string().uuid(),
    hsLines: z.array(
      z.object({
        hsCode: z.string().regex(/^\d{4}\.\d{2}(\.\d{2})?$/),
        customsValue: Money,
        dutyComputed: Money,
        vatComputed: Money,
        classificationConfidence: z.number().min(0).max(1),
        humanConfirmed: z.boolean(),
      }),
    ),
  }),
});

export const EntrySubmitted = defineEvent({
  type: "entry.submitted",
  version: 1,
  financial: false,
  description: "Entry transmitted to SARS via the accredited bureau.",
  schema: z.object({
    customsEntryId: z.string().uuid(),
    bureauRef: z.string(),
  }),
});

export const EntryQueried = defineEvent({
  type: "entry.queried",
  version: 1,
  financial: false,
  description: "SARS raised a query on the entry. Exception path — needs a human.",
  schema: z.object({
    customsEntryId: z.string().uuid(),
    queryText: z.string(),
  }),
});

export const EntryReleased = defineEvent({
  type: "entry.released",
  version: 1,
  financial: true,
  description:
    "Customs released the entry. Accrues duties/VAT as disbursement and triggers duty-financing settlement logic in the Revenue Ontology.",
  schema: z.object({
    customsEntryId: z.string().uuid(),
    dutiesTotal: Money,
    vatTotal: Money,
    releaseRef: z.string().nullable(),
  }),
});

export const EntryStopped = defineEvent({
  type: "entry.stopped",
  version: 1,
  financial: false,
  description: "Customs stop/detention. Ugly-path exception handled by the workflow.",
  schema: z.object({
    customsEntryId: z.string().uuid(),
    reason: z.string().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentUploaded = defineEvent({
  type: "document.uploaded",
  version: 1,
  financial: false,
  description: "A raw document file was attached to a shipment.",
  schema: z.object({
    documentId: z.string().uuid(),
    docType: z.enum([
      "COMMERCIAL_INVOICE",
      "PACKING_LIST",
      "BL",
      "SAD500",
      "CERTIFICATE_OF_ORIGIN",
      "CLEARING_INSTRUCTION",
      "POD",
      "OTHER",
    ]),
    fileName: z.string(),
    storageKey: z.string(),
  }),
});

export const DocumentExtracted = defineEvent({
  type: "document.extracted",
  version: 1,
  financial: false,
  description:
    "LLM extraction produced structured data with a confidence score; below-threshold extractions enter the human review queue.",
  schema: z.object({
    documentId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    reviewRequired: z.boolean(),
    extractedData: z.record(z.unknown()),
  }),
});

export const DocumentApproved = defineEvent({
  type: "document.approved",
  version: 1,
  financial: false,
  description: "A human approved extracted data; it may now flow into projections.",
  schema: z.object({
    documentId: z.string().uuid(),
    reviewerId: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export const PartyScreened = defineEvent({
  type: "party.screened",
  version: 1,
  financial: false,
  description: "Sanctions screening (yente/OpenSanctions) result for a party.",
  schema: z.object({
    partyId: z.string().uuid(),
    result: z.enum(["CLEAR", "HIT", "REVIEW"]),
    matchScore: z.number().min(0).max(1).nullable(),
    listRefs: z.array(z.string()),
  }),
});

export const ComplianceHold = defineEvent({
  type: "compliance.hold_placed",
  version: 1,
  financial: false,
  description: "Shipment blocked pending compliance escalation after a screening hit.",
  schema: z.object({
    partyId: z.string().uuid(),
    reason: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const ChargeAccrued = defineEvent({
  type: "charge.accrued",
  version: 1,
  financial: true,
  description:
    "A charge accrued against the shipment (triggered by operational events, e.g. vessel.departed accrues ocean freight).",
  schema: z.object({
    chargeId: z.string().uuid(),
    chargeCode: z.string(),
    description: z.string(),
    kind: z.enum(["FREIGHT", "SURCHARGE", "DISBURSEMENT", "FEE"]),
    buy: Money.nullable(),
    sell: Money,
    triggeredBy: z.string().nullable(),
  }),
});

export const InvoiceIssued = defineEvent({
  type: "invoice.issued",
  version: 1,
  financial: true,
  description: "Customer invoice issued from accrued charges.",
  schema: z.object({
    invoiceId: z.string().uuid(),
    customerId: z.string().uuid(),
    total: Money,
    dueDate: z.string().datetime({ offset: true }),
    chargeIds: z.array(z.string().uuid()),
  }),
});

export const PaymentReceived = defineEvent({
  type: "payment.received",
  version: 1,
  financial: true,
  description: "Payment received against an invoice (reconciled via ForgePay).",
  schema: z.object({
    invoiceId: z.string().uuid(),
    amount: Money,
    paymentRef: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const catalogue = [
  QuoteIssued,
  QuoteAccepted,
  ShipmentBooked,
  BookingRolled,
  ContainerGatedIn,
  ContainerLoaded,
  VesselDeparted,
  VesselArrived,
  ContainerDischarged,
  ContainerGatedOut,
  RoadPositionReported,
  PodConfirmed,
  ShipmentExceptionRaised,
  ShipmentExceptionCleared,
  EntryPrepared,
  EntrySubmitted,
  EntryQueried,
  EntryReleased,
  EntryStopped,
  DocumentUploaded,
  DocumentExtracted,
  DocumentApproved,
  PartyScreened,
  ComplianceHold,
  ChargeAccrued,
  InvoiceIssued,
  PaymentReceived,
] as const;

const registry = new Map<string, EventDefinition>(
  catalogue.map((d) => [`${d.type}@${d.version}`, d]),
);

export function getEventDefinition(
  type: string,
  version: number,
): EventDefinition | undefined {
  return registry.get(`${type}@${version}`);
}

export type FreightEventType = (typeof catalogue)[number]["type"];
