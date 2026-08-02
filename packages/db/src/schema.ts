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


// ---------------------------------------------------------------------------
// Consignment — what is actually being shipped
// ---------------------------------------------------------------------------

/**
 * How the goods are presented for carriage. This is not decoration: a carrier
 * quotes, a terminal handles and a customs officer inspects against these
 * words, and "40 pallets" and "40 loose pieces" are different prices and
 * different risks.
 */
export const packageType = pgEnum("package_type", [
  "PALLET",
  "CARTON",
  "CRATE",
  "DRUM",
  "BAG",
  "BALE",
  "ROLL",
  "IBC",
  "BULK",
  "LOOSE",
]);

/**
 * What the goods *are*, in the sense the operation cares about. Each value
 * changes the paperwork, the equipment and the price:
 * `HAZARDOUS` needs a UN number, IMO class and packing group before anything
 * can be booked; `REEFER` needs a temperature range and plugged equipment;
 * `OVERSIZED` cannot travel in a standard box at all.
 */
export const cargoType = pgEnum("cargo_type", [
  "GENERAL",
  "HAZARDOUS",
  "REEFER",
  "PERISHABLE",
  "OVERSIZED",
  "VALUABLE",
  "LIVE_ANIMALS",
]);

/**
 * How fast the customer needs it, which is a commercial choice rather than a
 * physical one. It filters rate cards by transit time and carries a service
 * uplift — a shipper who says "express" and is quoted a 34-day sailing has
 * been sold the wrong thing.
 */
export const urgency = pgEnum("urgency", ["ECONOMY", "STANDARD", "EXPRESS", "CRITICAL"]);

/**
 * A consignment: the goods, where they are collected, where they leave the
 * country, and how quickly they must move.
 *
 * Created with the quote and carried through to the shipment by reference
 * rather than copied, so the cargo a customer was quoted for and the cargo
 * that sails are provably the same rows.
 *
 * Weights are integer grams and volumes integer cubic centimetres, for the
 * same reason money is integer cents: floating point in a chargeable-weight
 * calculation is a rounding dispute with a carrier waiting to happen.
 */
export const consignments = pgTable(
  "consignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),

    /** Free-text description of the goods, as it will read on the B/L. */
    description: text("description").notNull(),
    cargoType: cargoType("cargo_type").notNull().default("GENERAL"),
    urgency: urgency("urgency").notNull().default("STANDARD"),

    /** Where the goods are collected. Null when the shipper delivers to port. */
    pickupLocode: text("pickup_locode"),
    pickupAddress: text("pickup_address"),
    pickupContact: text("pickup_contact"),
    pickupFrom: timestamp("pickup_from", { withTimezone: true }),
    pickupTo: timestamp("pickup_to", { withTimezone: true }),

    /** UN/LOCODE the goods leave the country through, and arrive at. */
    portOfExit: text("port_of_exit").notNull(),
    portOfEntry: text("port_of_entry").notNull(),

    /** Derived from the items and stored, so a quote stays reproducible. */
    pieces: integer("pieces").notNull().default(0),
    grossWeightGrams: bigint("gross_weight_grams", { mode: "number" }).notNull().default(0),
    volumeCm3: bigint("volume_cm3", { mode: "number" }).notNull().default(0),
    /** max(gross, volumetric) for the mode — what the carrier actually bills. */
    chargeableWeightGrams: bigint("chargeable_weight_grams", { mode: "number" }).notNull().default(0),

    /** Dangerous goods. Required together when cargo_type = HAZARDOUS. */
    unNumber: text("un_number"),
    imoClass: text("imo_class"),
    packingGroup: text("packing_group"),

    /** Reefer setpoint range in tenths of a degree Celsius, to avoid floats. */
    tempMinDeciC: integer("temp_min_deci_c"),
    tempMaxDeciC: integer("temp_max_deci_c"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consignments_tenant_idx").on(t.tenantId),
    index("consignments_lane_idx").on(t.portOfExit, t.portOfEntry),
  ],
);

/** One line of the packing list. A consignment is the sum of these. */
export const cargoItems = pgTable(
  "cargo_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consignmentId: uuid("consignment_id")
      .notNull()
      .references(() => consignments.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    packageType: packageType("package_type").notNull(),
    pieces: integer("pieces").notNull().default(1),
    grossWeightGrams: bigint("gross_weight_grams", { mode: "number" }).notNull(),
    /** Per-piece dimensions in millimetres; null when not measured. */
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    /** Non-stackable freight costs the slot above it, so carriers price it up. */
    stackable: boolean("stackable").notNull().default(true),
    /** Shipping marks as they appear on the packages. */
    marksAndNumbers: text("marks_and_numbers"),
    hsCode: text("hs_code"),
  },
  (t) => [index("cargo_items_consignment_idx").on(t.consignmentId)],
);

export const consignmentsRelations = relations(consignments, ({ many }) => ({
  items: many(cargoItems),
}));

export const cargoItemsRelations = relations(cargoItems, ({ one }) => ({
  consignment: one(consignments, {
    fields: [cargoItems.consignmentId],
    references: [consignments.id],
  }),
}));

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
    /** Nullable for quotes raised before consignment detail was captured. */
    consignmentId: uuid("consignment_id").references(() => consignments.id),
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
    /** Carried from the quote, not copied — same rows, provably. */
    consignmentId: uuid("consignment_id").references(() => consignments.id),
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

/**
 * Where a line sits in the freight-forwarder invoice taxonomy.
 *
 * A forwarder invoice is a consolidated billing document: it aggregates what
 * the carrier, the port agent, the customs broker and the local handler each
 * charged, plus the forwarder's own fees. Grouping by `kind` alone (FREIGHT /
 * SURCHARGE / DISBURSEMENT / FEE) says how a line behaves for tax, not what it
 * is for — and "what is it for" is the axis every audit runs on. The three
 * categories with the highest documented error rates are FUEL_SURCHARGE,
 * DESTINATION (terminal handling) and DOCUMENTATION, precisely because they
 * receive the least scrutiny and carry the most forwarder discretion.
 */
export const chargeCategory = pgEnum("charge_category", [
  "ORIGIN",
  "FREIGHT",
  "FUEL_SURCHARGE",
  "DESTINATION",
  "CUSTOMS",
  "DUTY_TAX",
  "DOCUMENTATION",
  "DEMURRAGE_DETENTION",
  "INSURANCE",
  "PLATFORM_FEE",
  "OTHER",
]);

/**
 * How the forwarder came by this line's money.
 *
 * - PASS_THROUGH: billed on at exactly the third party's cost (a disbursement).
 * - MARKED_UP: a third-party cost with the forwarder's margin added.
 * - FORWARDER_ORIGINATED: the forwarder's own service, no underlying cost.
 *
 * This is the single most useful field on the whole invoice, and no forwarder
 * invoice in the wild carries it. It is what makes margin explicable to a
 * customer, and it is what tells an auditor which lines can be matched against
 * a vendor invoice at all — a FORWARDER_ORIGINATED line has nothing to match
 * against and a PASS_THROUGH line with a margin on it is a contract breach.
 */
export const chargeProvenance = pgEnum("charge_provenance", [
  "PASS_THROUGH",
  "MARKED_UP",
  "FORWARDER_ORIGINATED",
]);

/** What the rate is multiplied by. Determines how a line is re-derivable. */
export const chargeBasis = pgEnum("charge_basis", [
  "PER_SHIPMENT",
  "PER_CONTAINER",
  "PER_KG",
  "PER_CBM",
  "PER_DOCUMENT",
  "PER_DAY",
  "PERCENTAGE",
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

    // -- Invoice-grade detail -------------------------------------------------
    // Everything below defaults, so charges accrued by the existing lifecycle
    // engine keep working; the quote engine and the manual line editor fill
    // them in properly.
    category: chargeCategory("category").notNull().default("OTHER"),
    provenance: chargeProvenance("provenance").notNull().default("FORWARDER_ORIGINATED"),
    basis: chargeBasis("basis").notNull().default("PER_SHIPMENT"),
    /** Units of `basis`. Kept as an integer: containers, kilos, days, documents. */
    quantity: integer("quantity").notNull().default(1),
    /** sell_cents = unit_sell_cents × quantity, except where rounding says otherwise. */
    unitSellCents: bigint("unit_sell_cents", { mode: "number" }),
    /** The third party whose cost this line carries. Null for forwarder-originated. */
    vendorPartyId: uuid("vendor_party_id").references(() => parties.id),
    /** The carrier's/agent's own invoice number, so a 4-way match has a key. */
    vendorInvoiceRef: text("vendor_invoice_ref"),
    /** The contract or tariff this line claims to price from. */
    contractRef: text("contract_ref"),
    /** VAT applied to this line, basis points. Disbursements are typically 0. */
    vatBps: integer("vat_bps").notNull().default(0),
    /** Set when this line is under dispute and must not be paid yet. */
    disputed: boolean("disputed").notNull().default(false),
  },
  (t) => [
    index("charges_shipment_idx").on(t.shipmentId),
    index("charges_invoice_idx").on(t.invoiceId),
  ],
);

export const invoiceStatus = pgEnum("invoice_status", [
  "ISSUED",
  "PART_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
]);

/**
 * What kind of document this is.
 *
 * Worth stating in the schema because the three documents in a freight file
 * get conflated constantly, and only the first is issued from here:
 *
 * - FREIGHT_INVOICE — the forwarder billing its customer for services. This.
 * - CREDIT_NOTE — a negative freight invoice reversing all or part of one.
 * - PROFORMA — an advance statement of charges; not a demand for payment and
 *   never enters the receivables ledger.
 *
 * A *commercial invoice* (seller → buyer, the value of the goods, the basis
 * for customs duty) is a customer document that arrives as an upload and lives
 * in `documents`. A *bill of lading* is the carrier's contract of carriage and
 * document of title and lives in `documents` too. Neither is ever generated
 * here, and a forwarder invoice that gets used as either one causes a customs
 * valuation problem, not a billing one.
 */
export const invoiceType = pgEnum("invoice_type", [
  "FREIGHT_INVOICE",
  "CREDIT_NOTE",
  "PROFORMA",
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

  // -- Standardised document fields ------------------------------------------
  type: invoiceType("type").notNull().default("FREIGHT_INVOICE"),
  /** Net of tax. total_cents = subtotal + vat. */
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  vatCents: bigint("vat_cents", { mode: "number" }).notNull().default(0),
  /** Of the subtotal, how much is pass-through disbursement (typically zero-rated). */
  disbursementCents: bigint("disbursement_cents", { mode: "number" }).notNull().default(0),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  /**
   * The billing profile as it stood when the invoice was issued.
   *
   * Snapshotted, not joined. A company changes its VAT number, its bank
   * account or its trading name, and every historical invoice must keep saying
   * what it said when it was sent — a reissued PDF that disagrees with the one
   * the customer holds is a tax problem in every jurisdiction this runs in.
   */
  issuerSnapshot: jsonb("issuer_snapshot"),
  billToSnapshot: jsonb("bill_to_snapshot"),
  /** Carrier's bill of lading / air waybill, carried onto the invoice for matching. */
  transportDocumentRef: text("transport_document_ref"),
  /** Customer's own PO or file reference — the field AP teams match on. */
  customerReference: text("customer_reference"),
  /** Free text printed under the totals: terms, remittance instructions. */
  notes: text("notes"),
  /** Null until an audit has run. See `invoice_exceptions`. */
  auditedAt: timestamp("audited_at", { withTimezone: true }),
});

/**
 * Per-company invoice identity and defaults — the part that makes this
 * multi-tenant rather than one forwarder's billing system.
 *
 * Every company on the platform issues invoices under its own registration,
 * its own numbering, its own bank account and its own terms. None of that can
 * be a constant in code, and none of it can be shared: a customer receiving an
 * invoice must be able to pay it into the right account and reclaim the right
 * VAT.
 */
export const tenantBillingProfiles = pgTable("tenant_billing_profiles", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name"),
  registrationNumber: text("registration_number"),
  vatNumber: text("vat_number"),
  /**
   * SARS customs client number (CCN). The 8-digit code a registered importer,
   * exporter or clearing agent trades under. Required on any customs
   * declaration and printed on the invoice so the customer's own broker can
   * reconcile the entry against the billing.
   */
  customsClientNumber: text("customs_client_number"),
  addressLines: text("address_lines"),
  country: text("country").notNull().default("ZA"),
  email: text("email"),
  phone: text("phone"),
  /** Data URI or object key. Rendered on the document; optional. */
  logoUrl: text("logo_url"),

  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  bankBranchCode: text("bank_branch_code"),
  bankSwift: text("bank_swift"),

  /** "INV" → INV-2026-000123. Per tenant so two companies never collide. */
  invoiceNumberPrefix: text("invoice_number_prefix").notNull().default("INV"),
  /**
   * The next number this company will issue.
   *
   * A column rather than a Postgres sequence: every tenant needs its own
   * unbroken run starting at 1, and tax authorities in several jurisdictions
   * require invoice numbering to be sequential and gapless per issuer. A
   * shared sequence gives company B the numbers company A didn't use, which
   * looks like missing invoices in an audit. Incremented with
   * `update ... returning` inside the issuing transaction, so it is atomic
   * under concurrency and rolls back with a failed issue.
   */
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  defaultPaymentTermsDays: integer("default_payment_terms_days").notNull().default(30),
  defaultCurrency: text("default_currency").notNull().default("ZAR"),
  /** Standard rate applied to taxable lines. ZA is 15% = 1500 bps. */
  vatBps: integer("vat_bps").notNull().default(1500),
  /** Printed under the totals on every invoice this company issues. */
  invoiceFooter: text("invoice_footer"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Charge-code normalisation.
 *
 * The same charge arrives as "OHC", "Origin Handling", "ORIG HANDLING CHG" or
 * bundled into "Origin Services" depending on which carrier or agent produced
 * it. Comparing spend across vendors, or matching a vendor invoice against a
 * contract, is impossible until those collapse onto one canonical code. This
 * table is that mapping, per tenant, because every forwarder's vendors speak a
 * different dialect.
 */
export const chargeCodeAliases = pgTable(
  "charge_code_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** As it appears on the vendor's document, upper-cased and trimmed. */
    alias: text("alias").notNull(),
    /** The canonical code in CHARGE_CODES. */
    canonicalCode: text("canonical_code").notNull(),
    /** Which vendor uses this vocabulary. Null = applies to all of them. */
    vendorPartyId: uuid("vendor_party_id").references(() => parties.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("charge_code_alias_uq").on(t.tenantId, t.alias)],
);

export const exceptionSeverity = pgEnum("exception_severity", [
  "INFO",
  "WARN",
  "CRITICAL",
]);

export const exceptionStatus = pgEnum("exception_status", [
  "OPEN",
  "ACCEPTED",
  "DISPUTED",
  "RESOLVED",
]);

/**
 * A finding from the invoice audit — one line that failed one match.
 *
 * Most AP teams run a 2-way match: does the invoice total agree with the
 * quote. That catches nothing, because the discrepancies are inside lines that
 * were never quoted. The audit here matches each line against four sources —
 * the customer contract, the underlying vendor cost or a published benchmark,
 * the shipment's own facts, and the service event record — and every failure
 * becomes a row here, before the invoice is paid rather than after.
 */
export const invoiceExceptions = pgTable(
  "invoice_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id").references(() => charges.id, { onDelete: "cascade" }),
    /** Stable rule identifier, e.g. FUEL_INDEX_VARIANCE. */
    code: text("code").notNull(),
    severity: exceptionSeverity("severity").notNull(),
    status: exceptionStatus("status").notNull().default("OPEN"),
    message: text("message").notNull(),
    /** What the audit believes the line should have been. Negative = undercharge. */
    varianceCents: bigint("variance_cents", { mode: "number" }),
    /** Rule inputs, so a finding can be explained months later. */
    evidence: jsonb("evidence"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    index("invoice_exceptions_invoice_idx").on(t.invoiceId),
    // One finding per rule per line per invoice: re-running an audit updates
    // rather than accumulating a duplicate every time someone opens the screen.
    //
    // Two indexes, not one, because `charge_id` is nullable for findings about
    // the invoice as a whole — and in Postgres NULL never equals NULL, so a
    // single three-column unique index would let every re-run insert another
    // copy of exactly the findings that matter most.
    uniqueIndex("invoice_exceptions_line_uq")
      .on(t.invoiceId, t.code, t.chargeId)
      .where(sql`charge_id is not null`),
    uniqueIndex("invoice_exceptions_doc_uq")
      .on(t.invoiceId, t.code)
      .where(sql`charge_id is null`),
  ],
);

/**
 * Cached quotes from a fuel index — the reference a BAF/EBS line is validated
 * against.
 *
 * EXTERNAL API. Bunker and jet-fuel indices are commercial feeds (Platts /
 * Argus for bunker, IATA for jet fuel) or carrier-published tariff pages. This
 * table is the local mirror; `FUEL_INDEX_URL` points at whichever the operator
 * has licensed. With it unset the audit simply does not run its fuel rule and
 * says so, rather than inventing a benchmark.
 */
export const fuelIndexQuotes = pgTable(
  "fuel_index_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. PLATTS_VLSFO_ROTTERDAM, IATA_JET_FUEL_AFRICA, MAERSK_BAF_ZA_EUR. */
    indexCode: text("index_code").notNull(),
    /** Where the number came from, so a dispute can cite it. */
    source: text("source").notNull(),
    quotedFor: timestamp("quoted_for", { withTimezone: true }).notNull(),
    /** Index level in cents of `currency` per tonne (bunker) or per litre (jet). */
    valueCents: bigint("value_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fuel_index_quote_uq").on(t.indexCode, t.quotedFor)],
);

export const filingStatus = pgEnum("filing_status", [
  "DRAFT",
  "QUEUED",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "QUERIED",
  "ACCEPTED",
  "REJECTED",
]);

/**
 * A statutory submission and its life outside this system.
 *
 * EXTERNAL API. Customs and tax filings leave the platform through an
 * authority's channel — in South Africa, SARS Customs EDI (CUSDEC/CUSRES over
 * the SARS gateway) for declarations, and eFiling for VAT. Both require the
 * *operator* to hold the accreditation: a registered customs client number, an
 * EDI user profile issued by SARS, and a client certificate. No amount of code
 * substitutes for that registration.
 *
 * So this table is the seam. Every filing is built, validated and stored here
 * with a full audit trail whether or not a transport is configured; when
 * `SARS_EDI_URL` is set the transport ships the payload and writes back the
 * authority's reference and response. Unconfigured, filings stop at QUEUED and
 * the screen says exactly what is missing — which is the honest state, and the
 * one a forwarder can act on.
 */
export const complianceFilings = pgTable(
  "compliance_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    /** SARS_CUSDEC | SARS_VAT201 | SARS_EXPORT_RELEASE | ... */
    kind: text("kind").notNull(),
    authority: text("authority").notNull().default("SARS"),
    status: filingStatus("status").notNull().default("DRAFT"),
    /** The built submission, in the authority's field vocabulary. */
    payload: jsonb("payload").notNull(),
    /** Our idempotency key on the authority's side. */
    submissionRef: text("submission_ref"),
    /** Theirs: LRN / MRN / case number. */
    authorityRef: text("authority_ref"),
    responsePayload: jsonb("response_payload"),
    /** Populated when unconfigured or refused, so the screen never shows a blank. */
    lastError: text("last_error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("compliance_filings_shipment_idx").on(t.shipmentId),
    // Partial: a draft has no submission reference yet, and NULLs do not
    // conflict in Postgres, so an unqualified unique index would be a no-op
    // for drafts and a trap for anyone who assumed otherwise.
    uniqueIndex("compliance_filings_submission_uq")
      .on(t.tenantId, t.kind, t.submissionRef)
      .where(sql`submission_ref is not null`),
  ],
);

/**
 * Money actually received against an invoice.
 *
 * Payments used to exist only as events, and the invoice's status was decided
 * by comparing a single payment against the whole total — so two half
 * payments left an invoice `PART_PAID` forever, and a redelivered payment
 * webhook was counted twice. The running total has to be a row someone can
 * sum.
 *
 * `payment_ref` is the bank's or gateway's reference. Unique per invoice
 * rather than per tenant, deliberately: a single bank transfer settling
 * several invoices is an allocation problem this table does not model, and a
 * tenant-wide constraint would reject the second allocation as a duplicate.
 * Within one invoice, the same reference twice is always a redelivery.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    paymentRef: text("payment_ref").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_invoice_ref_idx").on(t.invoiceId, t.paymentRef),
    index("payments_invoice_idx").on(t.invoiceId),
  ],
);

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
