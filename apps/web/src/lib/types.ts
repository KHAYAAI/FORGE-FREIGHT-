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
  /** Present once cargo detail was captured; null on older shipments. */
  consignment?: Consignment | null;
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

// --- Consignment: what is actually being shipped ---------------------------

export type PackageType =
  | "PALLET" | "CARTON" | "CRATE" | "DRUM" | "BAG"
  | "BALE" | "ROLL" | "IBC" | "BULK" | "LOOSE";

export type CargoTypeCode =
  | "GENERAL" | "HAZARDOUS" | "REEFER" | "PERISHABLE"
  | "OVERSIZED" | "VALUABLE" | "LIVE_ANIMALS";

export type UrgencyCode = "ECONOMY" | "STANDARD" | "EXPRESS" | "CRITICAL";

export interface CargoItem {
  id: string;
  consignmentId: string;
  description: string;
  packageType: PackageType;
  pieces: number;
  /** Gross weight of the line, not of one piece. */
  grossWeightGrams: number;
  /** Dimensions of a single piece. */
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  stackable: boolean;
  marksAndNumbers: string | null;
  hsCode: string | null;
}

export interface HandlingRequirement {
  code: string;
  description: string;
  /** Blocking requirements stop a booking; advisory ones are shown and logged. */
  blocking: boolean;
}

export interface Consignment {
  id: string;
  tenantId: string;
  description: string;
  cargoType: CargoTypeCode;
  urgency: UrgencyCode;
  pickupLocode: string | null;
  pickupAddress: string | null;
  pickupContact: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  portOfExit: string;
  portOfEntry: string;
  pieces: number;
  grossWeightGrams: number;
  volumeCm3: number;
  /** max(gross, volumetric) — what the carrier actually bills. */
  chargeableWeightGrams: number;
  unNumber: string | null;
  imoClass: string | null;
  packingGroup: string | null;
  tempMinDeciC: number | null;
  tempMaxDeciC: number | null;
  createdAt: string;
  items: CargoItem[];
  requirements: HandlingRequirement[];
  volumetricWeightGrams: number;
  volumetricApplies: boolean;
}

/** `POST /consignments/measure` — priced before anything is saved. */
export interface Measurement {
  mode: TransportMode;
  divisorCm3PerKg: number;
  pieces: number;
  grossWeightGrams: number;
  volumeCm3: number;
  volumetricWeightGrams: number;
  chargeableWeightGrams: number;
  volumetricApplies: boolean;
  requirements: HandlingRequirement[];
}

export interface ConsignmentReference {
  packageTypes: { code: PackageType; label: string }[];
  cargoTypes: { code: CargoTypeCode; label: string; upliftBps: number }[];
  urgencies: { code: UrgencyCode; upliftBps: number; maxTransitDays: number | null; label: string }[];
  volumetricDivisors: Record<TransportMode, number>;
}

// ---------------------------------------------------------------------------
// The standardised freight-forwarder invoice
// ---------------------------------------------------------------------------

export type ChargeCategory =
  | "ORIGIN"
  | "FREIGHT"
  | "FUEL_SURCHARGE"
  | "DESTINATION"
  | "CUSTOMS"
  | "DUTY_TAX"
  | "DOCUMENTATION"
  | "DEMURRAGE_DETENTION"
  | "INSURANCE"
  | "PLATFORM_FEE"
  | "OTHER";

export type ChargeProvenance = "PASS_THROUGH" | "MARKED_UP" | "FORWARDER_ORIGINATED";

export type ChargeBasis =
  | "PER_SHIPMENT"
  | "PER_CONTAINER"
  | "PER_KG"
  | "PER_CBM"
  | "PER_DOCUMENT"
  | "PER_DAY"
  | "PERCENTAGE";

export interface ChargeCodeDef {
  code: string;
  label: string;
  category: ChargeCategory;
  kind: string;
  basis: ChargeBasis;
  typicalProvenance: ChargeProvenance;
  taxable: boolean;
  errorRate: "LOW" | "MEDIUM" | "HIGH";
  note?: string;
  aliases: string[];
}

export interface InvoiceIssuer {
  legalName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  customsClientNumber?: string | null;
  addressLines?: string | null;
  country: string;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  bankSwift?: string | null;
  invoiceFooter?: string | null;
}

export interface InvoiceBillTo {
  name: string;
  addressLines?: string | null;
  country?: string | null;
  taxId?: string | null;
  email?: string | null;
  contact?: string | null;
}

export interface InvoiceDocumentLine {
  id: string;
  chargeCode: string;
  codeLabel: string;
  description: string;
  category: ChargeCategory;
  provenance: ChargeProvenance;
  basis: ChargeBasis;
  quantity: number;
  unitSellCents: number | null;
  sellCents: number;
  buyCents: number | null;
  currency: string;
  vatBps: number;
  vatCents: number;
  marginCents: number | null;
  marginBps: number | null;
  vendorName?: string | null;
  vendorInvoiceRef?: string | null;
  contractRef?: string | null;
  disputed?: boolean;
}

export interface InvoiceSection {
  category: ChargeCategory;
  label: string;
  lines: InvoiceDocumentLine[];
  subtotalCents: number;
  vatCents: number;
}

export interface InvoiceDocument {
  number: string;
  type: "FREIGHT_INVOICE" | "CREDIT_NOTE" | "PROFORMA";
  typeLabel: string;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  paymentTermsLabel: string;
  issuer: InvoiceIssuer;
  billTo: InvoiceBillTo;
  shipment: {
    reference: string;
    origin: string;
    destination: string;
    mode: string;
    incoterm?: string | null;
    transportDocumentRef?: string | null;
    carrierBookingRef?: string | null;
    containers?: { number: string | null; type: string | null }[];
  } | null;
  cargo: {
    description: string;
    cargoType: string;
    pieces: number;
    grossWeightGrams: number;
    volumeCm3: number;
    chargeableWeightGrams: number;
    marksAndNumbers?: string | null;
  } | null;
  sections: InvoiceSection[];
  totals: {
    subtotalCents: number;
    vatCents: number;
    totalCents: number;
    disbursementCents: number;
    markedUpCents: number;
    forwarderOriginatedCents: number;
    paidCents: number;
    outstandingCents: number;
    disputedCents: number;
  };
  margin: {
    buyCents: number;
    sellCents: number;
    marginCents: number;
    marginBps: number;
    linesWithoutBuy: number;
  };
  customerReference?: string | null;
  notes?: string | null;
  documentNotice: string;
  currencies: string[];
  /** What the issuing company still has to fill in on its billing profile. */
  profileMissing: string[];
}

export interface BillingProfile {
  tenantId: string;
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
  customsClientNumber: string | null;
  addressLines: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankSwift: string | null;
  invoiceNumberPrefix: string;
  nextInvoiceNumber: number;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
  vatBps: number;
  invoiceFooter: string | null;
  completeness: { ready: boolean; missing: string[] };
}

export type ExceptionSeverity = "INFO" | "WARN" | "CRITICAL";
export type ExceptionStatus = "OPEN" | "ACCEPTED" | "DISPUTED" | "RESOLVED";

export interface InvoiceException {
  id: string;
  invoiceId: string;
  chargeId: string | null;
  code: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  message: string;
  varianceCents: number | null;
  evidence: Record<string, unknown> | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface ExceptionRow {
  exception: InvoiceException;
  invoiceNumber: string | null;
}

export type MatchSource = "CONTRACT" | "VENDOR_COST" | "SHIPMENT_DATA" | "SERVICE_EVENTS";

export interface AuditResult {
  findings: {
    code: string;
    chargeId: string | null;
    severity: ExceptionSeverity;
    message: string;
    varianceCents: number | null;
    sources: MatchSource[];
    evidence: Record<string, unknown>;
  }[];
  summary: {
    linesChecked: number;
    findings: number;
    criticalCount: number;
    netVarianceCents: number;
    matchDepth: Record<MatchSource, boolean>;
    matchedSources: number;
  };
}

export interface DisputePacket {
  subject: string;
  body: string;
  claimedCents: number;
  lineCount: number;
}

export interface IntegrationState {
  key: string;
  name: string;
  domain: string;
  purpose: string;
  provider: string;
  requires: string[];
  optional?: string[];
  accreditation: string | null;
  degradesTo: string;
  requiredForProduction: boolean;
  status: "CONFIGURED" | "NOT_CONFIGURED" | "PARTIAL";
  missing: string[];
  missingOptional: string[];
}

export interface IntegrationsOverview {
  integrations: IntegrationState[];
  summary: {
    total: number;
    configured: number;
    partial: number;
    notConfigured: number;
    blockingProduction: string[];
    needingAccreditation: { name: string; accreditation: string }[];
  };
}

export interface ComplianceFiling {
  id: string;
  shipmentId: string | null;
  kind: string;
  authority: string;
  status: string;
  submissionRef: string | null;
  authorityRef: string | null;
  lastError: string | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface FilingsView {
  filings: ComplianceFiling[];
  channel: { enabled: boolean; missing: string[] };
}
