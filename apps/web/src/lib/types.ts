/** Domain types shared by server and client code — no server-only imports here. */

export type ShipmentStatus =
  | "BOOKED"
  | "IN_TRANSIT"
  | "AT_DESTINATION_PORT"
  | "CUSTOMS"
  | "ON_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface Shipment {
  id: string;
  tenantId: string;
  reference: string;
  bookingId: string;
  status: ShipmentStatus;
  origin: string;
  destination: string;
  createdAt: string;
}

/** A keyset-paginated slice of a list endpoint. */
export interface Page<T> {
  rows: T[];
  /** Null on the last page; pass back as `cursor` to fetch the next one. */
  nextCursor: string | null;
  /** Total matching the filters, ignoring the cursor. */
  total: number;
}

/** One lane of freight in motion, aggregated across the whole book. */
export interface Corridor {
  origin: string;
  destination: string;
  n: number;
  /** Open exceptions on that lane — non-zero flags it on the map. */
  exceptions: number;
}

export interface ShipmentEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type ExceptionCode =
  | "BOOKING_ROLLED"
  | "CUSTOMS_QUERY"
  | "CUSTOMS_STOPPED"
  | "COMPLIANCE_HOLD"
  | "CONGESTION_DELAY"
  | "DEPARTURE_SLA_BREACH"
  | "TRANSIT_OVERRUN"
  | "CUSTOMS_RELEASE_SLA_BREACH";

export interface ShipmentException {
  exceptionId: string;
  code: ExceptionCode;
  detail: string | null;
  raisedAt: string;
  shipmentId: string;
  reference: string;
  status: ShipmentStatus;
  origin: string;
  destination: string;
}

export interface Quote {
  id: string;
  tenantId: string;
  customerId: string;
  status: string;
  origin: string;
  destination: string;
  mode: string;
  containerType: string | null;
  quantity: number;
  incoterm: string;
  totalCents: string;
  currency: string;
  expiresAt: string;
  lines?: QuoteLine[];
}

export interface QuoteLine {
  id: string;
  description: string;
  amountCents: string;
  currency: string;
}

export interface Party {
  id: string;
  tenantId: string;
  name: string;
  country: string | null;
  address: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  screening?: { verdict: string; [k: string]: unknown };
}

export type DocumentType =
  | "COMMERCIAL_INVOICE"
  | "PACKING_LIST"
  | "BL"
  | "SAD500"
  | "CERTIFICATE_OF_ORIGIN"
  | "CLEARING_INSTRUCTION"
  | "POD"
  | "OTHER";

export type DocumentReviewStatus =
  | "PENDING_EXTRACTION"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";

export interface FreightDocument {
  id: string;
  tenantId: string;
  shipmentId: string | null;
  docType: DocumentType;
  fileName: string;
  extractedData: Record<string, unknown> | null;
  extractionConfidence: number | null;
  reviewStatus: DocumentReviewStatus;
  reviewedBy: string | null;
  createdAt: string;
}

export type CustomsEntryStatus =
  | "DRAFT"
  | "PREPARED"
  | "SUBMITTED"
  | "QUERY"
  | "RELEASED"
  | "STOPPED";

export interface CustomsEntryLine {
  id: string;
  description: string;
  customsValueCents: string;
  hsCode: string | null;
  hsConfidence: number | null;
  dutyRateBps: number | null;
  sacuOrigin: boolean;
  confirmedAt: string | null;
}

export interface CustomsEntry {
  id: string;
  tenantId: string;
  shipmentId: string;
  status: CustomsEntryStatus;
  bureauRef: string | null;
  releaseRef: string | null;
  dutiesTotalCents: string | null;
  vatTotalCents: string | null;
  currency: string;
  createdAt: string;
  lines?: CustomsEntryLine[];
}

export interface ClassificationCandidate {
  hsCode: string;
  description: string;
  generalRateBps: number;
  confidence: number;
}

export type InvoiceStatus = "ISSUED" | "PART_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

export interface Invoice {
  id: string;
  tenantId: string;
  customerId: string;
  shipmentId: string | null;
  number: string;
  status: InvoiceStatus;
  totalCents: number;
  currency: string;
  dueDate: string;
  createdAt: string;
  /** Sum of payments recorded against this invoice. Absent on the portal feed. */
  paidCents?: number;
  /** Negative when the customer has overpaid — money to refund, not revenue. */
  outstandingCents?: number;
}

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  /** The bank's reference. Unique per invoice — this is the idempotency key. */
  paymentRef: string;
  receivedAt: string;
  createdAt: string;
}

export interface PaymentResult {
  invoiceId: string;
  status: InvoiceStatus;
  paidCents: number;
  outstandingCents: number;
  overpaidCents: number;
  /** True when this reference had already been applied and nothing changed. */
  duplicate: boolean;
}

export interface Charge {
  id: string;
  tenantId: string;
  shipmentId: string;
  kind: string;
  amountCents: string;
  currency: string;
  createdAt: string;
}

export interface FinanceViews {
  dutyFinancing: {
    shipmentId: string;
    amountCents: string;
    currency: string;
    occurredAt: string;
  }[];
  factoring: {
    shipment_id: string;
    amount_cents: string;
    currency: string;
    recognised_at: string;
    factoring_clock_started_at: string | null;
    settled_at: string | null;
  }[];
}

export type TenantType = "OPERATOR" | "PARTNER_AGENT" | "CUSTOMER";

/**
 * What a shipper sees of its own cargo. Deliberately a subset of the operator
 * view — no margin, no carrier buy rates, no other customers.
 */
export interface PortalTimelineEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface Tenant {
  id: string;
  type: TenantType;
  name: string;
  platformFeeBps: number | null;
}

export interface Partner {
  id: string;
  name: string;
  platformFeeBps: number | null;
  createdAt: string;
  shipmentCount: number;
  feeRevenue: { currency: string; amountCents: number }[];
}

export interface NetworkOverview {
  tenantsByType: { type: TenantType; n: number }[];
  totalShipments: number;
  corridorVolume: { origin: string; destination: string; n: number }[];
  shipmentsByStatus: { status: ShipmentStatus; n: number }[];
  platformFeeRevenue: { currency: string; totalCents: number }[];
}

export interface PlatformFeeCharge {
  id: string;
  tenantId: string;
  shipmentId: string;
  chargeCode: string;
  description: string;
  kind: string;
  sellCents: string;
  currency: string;
  triggeredBy: string | null;
  createdAt: string;
}

export interface PlatformFees {
  charges: PlatformFeeCharge[];
  totals: { currency: string; amountCents: number }[];
}

export interface SystemMonitor {
  generatedAt: string;
  /** Platform health is the operator's; a partner agent gets null here. */
  infra: {
    database: boolean;
    kafkaConfigured: boolean;
    temporalConfigured: boolean;
    outboxPollMs: number;
  } | null;
  events: {
    total: number;
    lastHour: number;
    outboxUnpublished: number;
    latestRecordedAt: string | null;
  };
  consumers: {
    name: string;
    lastEventId: string | null;
    lastRecordedAt: string | null;
    lagMs: number | null;
    healthy: boolean;
  }[];
  exceptions: {
    total: number;
    byCode: { code: string; n: number }[];
  };
  entities: {
    shipmentsByStatus: { status: string; n: number }[];
    documentsInReview: number;
    customsByStatus: { status: string; n: number }[];
    invoicesOutstanding: number;
    parties: number;
  };
}

// --- Rates administration ---------------------------------------------------

export type TransportMode = "OCEAN" | "AIR" | "ROAD" | "RAIL";
export type ContainerTypeCode = "20GP" | "40GP" | "40HC" | "45HC" | "20RF" | "40RF" | "LCL";
export type SurchargeBasis =
  | "PER_CONTAINER"
  | "PER_SHIPMENT"
  | "PER_BL"
  | "PERCENT_OF_FREIGHT";

export interface RateSurcharge {
  id: string;
  rateCardId: string;
  code: string;
  description: string;
  basis: SurchargeBasis;
  /** Basis points when `basis` is PERCENT_OF_FREIGHT, minor currency units otherwise. */
  amountCents: number;
  currency: string;
}

export interface RateCard {
  id: string;
  tenantId: string;
  kind: "CONTRACT" | "SPOT";
  carrierId: string | null;
  carrierName: string;
  mode: TransportMode;
  origin: string;
  destination: string;
  containerType: ContainerTypeCode | null;
  buyAmountCents: number;
  currency: string;
  transitDays: number | null;
  validFrom: string;
  validTo: string;
  createdAt: string;
  surcharges: RateSurcharge[];
}

export interface MarginRule {
  id: string;
  tenantId: string;
  customerId: string | null;
  origin: string | null;
  destination: string | null;
  mode: TransportMode | null;
  marginBps: number;
  minMarginCents: number;
  createdAt: string;
}
