import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Human shipment references: FF-<year>-<zero-padded counter>. */
export const shipmentRefSeq = pgSequence("shipment_ref_seq", {
  startWith: 1,
  increment: 1,
});

/**
 * System of record. Everything here except `events` is a PROJECTION — the
 * append-only `events` table (mirrored to Redpanda) is the source of truth.
 *
 * Money: integer cents + ISO 4217 currency column, always. ZAR-first.
 * Tenancy: every business row carries tenant_id (Keycloak organisation).
 */

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const tenantType = pgEnum("tenant_type", [
  "OPERATOR",
  "PARTNER_AGENT",
  "CUSTOMER",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: tenantType("type").notNull(),
  name: text("name").notNull(),
  /** Keycloak organisation id. */
  keycloakOrgId: text("keycloak_org_id"),
  /** PARTNER_AGENT only: platform fee the operator charges on shipment freight, basis points. */
  platformFeeBps: integer("platform_fee_bps"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Parties — one table, roles via join
// ---------------------------------------------------------------------------

export const partyRole = pgEnum("party_role", [
  "SHIPPER",
  "CONSIGNEE",
  "NOTIFY",
  "CARRIER",
  "AGENT",
  "TRUCKER",
]);

export const screeningStatus = pgEnum("screening_status", [
  "UNSCREENED",
  "CLEAR",
  "REVIEW",
  "HIT",
]);

export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    country: text("country"), // ISO 3166-1 alpha-2
    address: text("address"),
    taxId: text("tax_id"),
    email: text("email"),
    phone: text("phone"),
    screeningStatus: screeningStatus("screening_status")
      .notNull()
      .default("UNSCREENED"),
    /**
     * Links this party to a CUSTOMER tenant, so the shipper can sign in and
     * watch its own cargo.
     *
     * A shipper is a `parties` row inside the forwarder's tenant — it has no
     * tenant of its own until someone gives it one. This column is that
     * grant, and it is the *only* way data crosses a tenant boundary
     * anywhere in the platform: the portal reads shipments belonging to the
     * forwarder by way of the parties that point back at the caller. Null
     * means no portal access, which is the default for every party.
     */
    customerTenantId: uuid("customer_tenant_id").references(() => tenants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("parties_tenant_idx").on(t.tenantId),
    // The portal's every query starts by resolving this; without the index
    // it is a sequential scan of every party on the platform.
    index("parties_customer_tenant_idx").on(t.customerTenantId),
  ],
);

export const shipmentParties = pgTable(
  "shipment_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    partyId: uuid("party_id").notNull().references(() => parties.id),
    role: partyRole("role").notNull(),
  },
  (t) => [
    uniqueIndex("shipment_party_role_uq").on(t.shipmentId, t.partyId, t.role),
  ],
);

// ---------------------------------------------------------------------------
// Rates & margin rules
// ---------------------------------------------------------------------------

export const transportMode = pgEnum("transport_mode", [
  "OCEAN",
  "AIR",
  "ROAD",
  "RAIL",
]);

export const containerType = pgEnum("container_type", [
  "20GP",
  "40GP",
  "40HC",
  "45HC",
  "20RF",
  "40RF",
  "LCL",
]);

export const rateKind = pgEnum("rate_kind", ["CONTRACT", "SPOT"]);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    kind: rateKind("kind").notNull(),
    carrierId: uuid("carrier_id").references(() => parties.id),
    carrierName: text("carrier_name").notNull(),
    mode: transportMode("mode").notNull(),
    origin: text("origin").notNull(), // UN/LOCODE
    destination: text("destination").notNull(), // UN/LOCODE
    containerType: containerType("container_type"), // null = per-shipment (e.g. road FTL)
    buyAmountCents: bigint("buy_amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    transitDays: integer("transit_days"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rate_cards_lane_idx").on(t.origin, t.destination, t.mode),
    index("rate_cards_validity_idx").on(t.validFrom, t.validTo),
  ],
);

export const surchargeBasis = pgEnum("surcharge_basis", [
  "PER_CONTAINER",
  "PER_SHIPMENT",
  "PER_BL",
  "PERCENT_OF_FREIGHT",
]);

export const rateSurcharges = pgTable("rate_surcharges", {
  id: uuid("id").primaryKey().defaultRandom(),
  rateCardId: uuid("rate_card_id")
    .notNull()
    .references(() => rateCards.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // e.g. BAF, THC, ISPS, DOC
  description: text("description").notNull(),
  basis: surchargeBasis("basis").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // basis points when PERCENT_OF_FREIGHT
  currency: text("currency").notNull(),
});

export const marginRules = pgTable(
  "margin_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** Null customer/lane/mode = wildcard; most specific rule wins. */
    customerId: uuid("customer_id").references(() => parties.id),
    origin: text("origin"),
    destination: text("destination"),
    mode: transportMode("mode"),
    /** Margin in basis points on buy (e.g. 1800 = 18%). */
    marginBps: integer("margin_bps").notNull(),
    /** Floor per quote line, in the line currency. */
    minMarginCents: bigint("min_margin_cents", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("margin_rules_tenant_idx").on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Quote → Booking → Shipment
// ---------------------------------------------------------------------------

export const incoterm = pgEnum("incoterm", [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);

export const quoteStatus = pgEnum("quote_status", [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "EXPIRED",
  "DECLINED",
]);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    customerId: uuid("customer_id").notNull().references(() => parties.id),
    status: quoteStatus("status").notNull().default("DRAFT"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    mode: transportMode("mode").notNull(),
    containerType: containerType("container_type"),
    containerQuantity: integer("container_quantity").notNull().default(1),
    incoterm: incoterm("incoterm").notNull(),
    totalSellCents: bigint("total_sell_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_tenant_customer_idx").on(t.tenantId, t.customerId)],
);

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  chargeCode: text("charge_code").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  buyCents: bigint("buy_cents", { mode: "number" }).notNull(),
  sellCents: bigint("sell_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  customerId: uuid("customer_id").notNull().references(() => parties.id),
  carrierBookingRef: text("carrier_booking_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentStatus = pgEnum("shipment_status", [
  "BOOKED",
  "IN_TRANSIT",
  "AT_DESTINATION_PORT",
  "CUSTOMS",
  "ON_DELIVERY",
  "DELIVERED",
  "CANCELLED",
]);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    reference: text("reference").notNull(), // human ref, e.g. FF-2026-00001
    status: shipmentStatus("status").notNull().default("BOOKED"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    incoterm: incoterm("incoterm").notNull(),
    /** Temporal workflow id running this shipment's lifecycle. */
    workflowId: text("workflow_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_reference_uq").on(t.reference),
    index("shipments_tenant_status_idx").on(t.tenantId, t.status),
    // Backs keyset pagination, which orders by (created_at, id) within a
    // tenant. Postgres scans an ascending index backwards, so this serves the
    // DESC page order without a second index.
    index("shipments_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  ],
);

export const legs = pgTable("legs", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipments.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  mode: transportMode("mode").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  vesselImo: text("vessel_imo"),
  vesselName: text("vessel_name"),
  voyageNumber: text("voyage_number"),
  truckerId: uuid("trucker_id").references(() => parties.id),
  traccarDeviceId: text("traccar_device_id"),
  etd: timestamp("etd", { withTimezone: true }),
  eta: timestamp("eta", { withTimezone: true }),
  atd: timestamp("atd", { withTimezone: true }),
  ata: timestamp("ata", { withTimezone: true }),
});

export const containers = pgTable("containers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipments.id, { onDelete: "cascade" }),
  containerNumber: text("container_number"), // ISO 6346, null until assigned
  containerType: containerType("container_type").notNull(),
  sealNumber: text("seal_number"),
  grossWeightKg: doublePrecision("gross_weight_kg"),
});

export const exceptionCode = pgEnum("exception_code", [
  "BOOKING_ROLLED",
  "CUSTOMS_STOP",
  "CUSTOMS_QUERY",
  "CONGESTION_DELAY",
  "COMPLIANCE_HOLD",
]);

/** Ops kanban projection: open exceptions = what needs a human today. */
export const shipmentExceptions = pgTable(
  "shipment_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    code: exceptionCode("code").notNull(),
    detail: text("detail"),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [index("shipment_exceptions_open_idx").on(t.tenantId, t.shipmentId)],
);

/** Watermarks for in-process event consumers (projector, billing, ledger). */
export const consumerOffsets = pgTable("consumer_offsets", {
  consumer: text("consumer").primaryKey(),
  lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true }).notNull(),
  lastEventId: uuid("last_event_id").notNull(),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentType = pgEnum("document_type", [
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "BL",
  "SAD500",
  "CERTIFICATE_OF_ORIGIN",
  "CLEARING_INSTRUCTION",
  "POD",
  "OTHER",
]);

export const documentReviewStatus = pgEnum("document_review_status", [
  "PENDING_EXTRACTION",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    docType: documentType("doc_type").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Structured JSON extracted by the LLM pipeline. */
    extractedData: jsonb("extracted_data"),
    extractionConfidence: doublePrecision("extraction_confidence"),
    reviewStatus: documentReviewStatus("review_status")
      .notNull()
      .default("PENDING_EXTRACTION"),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_shipment_idx").on(t.shipmentId)],
);

// ---------------------------------------------------------------------------
// Customs
// ---------------------------------------------------------------------------

export const customsEntryStatus = pgEnum("customs_entry_status", [
  "DRAFT",
  "PREPARED",
  "SUBMITTED",
  "QUERY",
  "RELEASED",
  "STOPPED",
]);

export const customsEntries = pgTable("customs_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  status: customsEntryStatus("status").notNull().default("DRAFT"),
  bureauRef: text("bureau_ref"),
  releaseRef: text("release_ref"),
  dutiesTotalCents: bigint("duties_total_cents", { mode: "number" }),
  vatTotalCents: bigint("vat_total_cents", { mode: "number" }),
  currency: text("currency").notNull().default("ZAR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customsEntryLines = pgTable("customs_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  customsEntryId: uuid("customs_entry_id")
    .notNull()
    .references(() => customsEntries.id, { onDelete: "cascade" }),
  hsCode: text("hs_code").notNull(),
  description: text("description").notNull(),
  customsValueCents: bigint("customs_value_cents", { mode: "number" }).notNull(),
  dutyCents: bigint("duty_cents", { mode: "number" }).notNull(),
  vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("ZAR"),
  classificationConfidence: doublePrecision("classification_confidence"),
  humanConfirmed: boolean("human_confirmed").notNull().default(false),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const chargeKind = pgEnum("charge_kind", [
  "FREIGHT",
  "SURCHARGE",
  "DISBURSEMENT",
  "FEE",
]);

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    chargeCode: text("charge_code").notNull(),
    description: text("description").notNull(),
    kind: chargeKind("kind").notNull(),
    buyCents: bigint("buy_cents", { mode: "number" }),
    sellCents: bigint("sell_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** Event type that accrued this charge, e.g. vessel.departed. */
    triggeredBy: text("triggered_by"),
    invoiceId: uuid("invoice_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("charges_shipment_idx").on(t.shipmentId)],
);

export const invoiceStatus = pgEnum("invoice_status", [
  "ISSUED",
  "PART_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull().references(() => parties.id),
  shipmentId: uuid("shipment_id").references(() => shipments.id),
  number: text("number").notNull(),
  status: invoiceStatus("status").notNull().default("ISSUED"),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Revenue Ontology feed: ledger events produced by the ontology bridge from
 * financial freight events. ForgePay consumes this; the trade-finance views
 * (duty-financing eligibility, factoring status) are computed over it.
 */
export const ledgerEvents = pgTable(
  "ledger_events",
  {
    ledgerEventId: uuid("ledger_event_id").primaryKey(),
    type: text("type").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    sourceEventType: text("source_event_type").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    shipmentId: uuid("shipment_id"),
    counterpartyId: uuid("counterparty_id"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    trigger: text("trigger"),
    signal: text("signal"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull(),
  },
  (t) => [
    // Replay-safe: one ledger event per (source event, ledger type).
    uniqueIndex("ledger_events_source_uq").on(t.sourceEventId, t.type),
    index("ledger_events_shipment_idx").on(t.shipmentId),
  ],
);

// ---------------------------------------------------------------------------
// Events — append-only, mirrored to Redpanda. THE source of truth.
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    eventId: uuid("event_id").primaryKey(),
    shipmentId: uuid("shipment_id"),
    tenantId: uuid("tenant_id").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actor: jsonb("actor").notNull(),
    sourceRef: text("source_ref"),
    payload: jsonb("payload").notNull(),
    /** Transactional outbox: null until the relay ships the event to Redpanda. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("events_shipment_idx").on(t.shipmentId, t.occurredAt),
    index("events_type_idx").on(t.type),
    index("events_unpublished_idx")
      .on(t.recordedAt)
      .where(sql`published_at is null`),
    // Adapter idempotency: same source message never lands twice.
    uniqueIndex("events_source_ref_uq")
      .on(t.type, t.sourceRef)
      .where(sql`source_ref is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Relations (query-layer convenience)
// ---------------------------------------------------------------------------

export const shipmentsRelations = relations(shipments, ({ many, one }) => ({
  legs: many(legs),
  containers: many(containers),
  documents: many(documents),
  charges: many(charges),
  parties: many(shipmentParties),
  booking: one(bookings, {
    fields: [shipments.bookingId],
    references: [bookings.id],
  }),
}));

export const quotesRelations = relations(quotes, ({ many }) => ({
  lines: many(quoteLines),
}));

export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
}));

export const rateCardsRelations = relations(rateCards, ({ many }) => ({
  surcharges: many(rateSurcharges),
}));

export const rateSurchargesRelations = relations(rateSurcharges, ({ one }) => ({
  rateCard: one(rateCards, {
    fields: [rateSurcharges.rateCardId],
    references: [rateCards.id],
  }),
}));

export const legsRelations = relations(legs, ({ one }) => ({
  shipment: one(shipments, { fields: [legs.shipmentId], references: [shipments.id] }),
}));

export const containersRelations = relations(containers, ({ one }) => ({
  shipment: one(shipments, {
    fields: [containers.shipmentId],
    references: [shipments.id],
  }),
}));
