/* ==========================================================================
 * STORE
 *
 * Everything the running platform keeps in Postgres, kept here in memory: an
 * append-only event log plus the projections built from it. Same shape, same
 * tenant predicate on every read, same idempotency rules.
 *
 * Seeded deterministically. A demo that reshuffles its own book on every
 * reload is a demo nobody can point at twice.
 * ======================================================================== */

/* mulberry32 — small, fast, and the same sequence every time. */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The clock. Fixed so every figure on the screen is reproducible; the demo
   advances it as work happens rather than reading the wall. */
const T0 = new Date("2026-08-14T09:20:00Z").getTime();
const DAY = 86400000;

const TENANTS = [
  { id: "t-op",   type: "OPERATOR",      name: "FORGE Freight (Pty) Ltd", short: "FORGE Freight", av: "FF" },
  { id: "t-pa",   type: "PARTNER_AGENT", name: "Cape Coastal Forwarding", short: "Cape Coastal",  av: "CC", platformFeeBps: 500 },
  { id: "t-cust", type: "CUSTOMER",      name: "Ubuntu Trading (Pty) Ltd", short: "Ubuntu Trading", av: "UT" },
];

const USERS = [
  { id: "u-1", tenantId: "t-op",   name: "Thabo Nkosi",   title: "Operations lead",     roles: ["admin", "ops", "finance"] },
  { id: "u-2", tenantId: "t-op",   name: "Lerato Dlamini", title: "Finance",            roles: ["finance"] },
  { id: "u-3", tenantId: "t-op",   name: "Sipho Ndlovu",   title: "Ops desk",           roles: ["ops"] },
  { id: "u-4", tenantId: "t-pa",   name: "Nadia Fourie",   title: "Partner principal",  roles: ["admin", "ops", "finance"] },
  { id: "u-5", tenantId: "t-cust", name: "Ayanda Mokoena", title: "Logistics manager",  roles: [] },
];

const PORTS = {
  CNSHA: "Shanghai", ZADUR: "Durban", ZACPT: "Cape Town", ZAJNB: "Johannesburg",
  DEHAM: "Hamburg", NLRTM: "Rotterdam", BRSSZ: "Santos", INNSA: "Nhava Sheva",
  AEJEA: "Jebel Ali", ZAPLZ: "Gqeberha", KEMBA: "Mombasa", SGSIN: "Singapore",
};

const FX = { USD: 18.62, EUR: 20.15, ZAR: 1 };

/* --------------------------------------------------------------- seed ---- */

function seed() {
  const r = rng(20260814);
  const S = {
    now: T0,
    tenants: TENANTS.map((t) => ({ ...t })),
    users: USERS.map((u) => ({ ...u })),
    session: { userId: "u-1" },
    parties: [], rateCards: [], marginRules: [], consignments: [], quotes: [],
    shipments: [], events: [], charges: [], invoices: [], payments: [],
    exceptions: [], entries: [], documents: [], billingProfiles: {},
    aliases: [], invoiceExceptions: [], filings: [], seq: 0,
  };

  const P = (id, tenantId, name, country, over = {}) => {
    const p = { id, tenantId, name, country, screening: "CLEAR", address: null,
      taxId: null, email: null, customerTenantId: null, createdAt: T0 - 220 * DAY, ...over };
    S.parties.push(p); return p;
  };

  P("p-ubuntu", "t-op", "Ubuntu Trading (Pty) Ltd", "ZA", {
    address: "12 Marine Drive\nDurban 4001", taxId: "4930287711",
    email: "ops@ubuntutrading.example", customerTenantId: "t-cust" });
  P("p-kalahari", "t-op", "Kalahari Textiles (Pty) Ltd", "ZA", {
    address: "Unit 4, Isando Industrial Park\nKempton Park 1600", taxId: "4110992873",
    email: "imports@kalaharitextiles.example" });
  P("p-savanna", "t-op", "Savanna Agri Exports", "ZA", {
    address: "Plot 18, Bethlehem Road\nHarrismith 9880", taxId: "4772019934",
    email: "logistics@savannaagri.example" });
  P("p-nordwind", "t-op", "Nordwind Maschinenbau GmbH", "DE", {
    address: "Hafenstrasse 44\n20359 Hamburg", email: "export@nordwind.example" });
  P("p-maersk", "t-op", "Maersk Line", "DK");
  P("p-cmacgm", "t-op", "CMA CGM", "FR");
  P("p-n3", "t-op", "N3 Corridor Logistics", "ZA");
  P("p-sipg", "t-op", "Shanghai Port Agency", "CN");
  P("p-tpt", "t-op", "Transnet Port Terminals", "ZA");
  P("p-sars", "t-op", "South African Revenue Service", "ZA");
  P("p-orion", "t-op", "Orion Metals Trading", "AE", { screening: "REVIEW",
    address: "Warehouse 12, Jebel Ali Free Zone\nDubai", email: "trade@orionmetals.example" });
  P("p-cc-cust", "t-pa", "Overberg Fruit Co-op", "ZA", {
    address: "R43, Grabouw 7160", taxId: "4881227740", email: "exports@overbergfruit.example" });

  const RC = (id, o) => { S.rateCards.push({ id, tenantId: "t-op", kind: "CONTRACT",
    validFrom: T0 - 60 * DAY, validTo: T0 + 100 * DAY, ...o }); };
  RC("rc-1", { carrierId: "p-maersk", carrier: "Maersk Line", mode: "OCEAN", origin: "CNSHA",
    destination: "ZADUR", eq: "40HC", buyCents: 235000, currency: "USD", transitDays: 28,
    surcharges: [
      { code: "BAF", desc: "Bunker adjustment", basis: "PERCENT_OF_FREIGHT", amount: 1150, currency: "USD" },
      { code: "THC", desc: "Terminal handling, Durban", basis: "PER_CONTAINER", amount: 21000, currency: "USD" },
      { code: "ISPS", desc: "Port security", basis: "PER_BL", amount: 4500, currency: "USD" },
    ] });
  RC("rc-2", { carrierId: "p-maersk", carrier: "Maersk Line", mode: "OCEAN", origin: "DEHAM",
    destination: "ZADUR", eq: "40HC", buyCents: 198000, currency: "USD", transitDays: 24,
    surcharges: [{ code: "THC", desc: "Terminal handling, Durban", basis: "PER_CONTAINER", amount: 19500, currency: "USD" }] });
  RC("rc-3", { carrierId: "p-cmacgm", carrier: "CMA CGM", mode: "OCEAN", origin: "ZACPT",
    destination: "BRSSZ", eq: "40RF", buyCents: 199000, currency: "USD", transitDays: 18,
    surcharges: [
      { code: "THC", desc: "Terminal handling, Santos", basis: "PER_CONTAINER", amount: 21000, currency: "USD" },
      { code: "ISPS", desc: "Port security", basis: "PER_BL", amount: 4500, currency: "USD" },
    ] });
  RC("rc-4", { carrierId: "p-n3", carrier: "N3 Corridor Logistics", mode: "ROAD", origin: "ZADUR",
    destination: "ZAJNB", eq: "40HC", buyCents: 1850000, currency: "ZAR", transitDays: 2,
    surcharges: [
      { code: "BAF", desc: "Fuel levy", basis: "PERCENT_OF_FREIGHT", amount: 900, currency: "ZAR" },
      { code: "TOL", desc: "N3 tolls", basis: "PER_SHIPMENT", amount: 68000, currency: "ZAR" },
    ] });
  RC("rc-5", { carrierId: "p-cmacgm", carrier: "CMA CGM", mode: "OCEAN", origin: "INNSA",
    destination: "ZADUR", eq: "20GP", buyCents: 142000, currency: "USD", transitDays: 16,
    surcharges: [{ code: "THC", desc: "Terminal handling, Durban", basis: "PER_CONTAINER", amount: 19500, currency: "USD" }] });
  RC("rc-6", { carrierId: "p-maersk", carrier: "Maersk Line", mode: "OCEAN", origin: "ZADUR",
    destination: "NLRTM", eq: "40RF", buyCents: 268000, currency: "USD", transitDays: 19,
    surcharges: [
      { code: "BAF", desc: "Bunker adjustment", basis: "PERCENT_OF_FREIGHT", amount: 1050, currency: "USD" },
      { code: "THC", desc: "Terminal handling, Rotterdam", basis: "PER_CONTAINER", amount: 24500, currency: "USD" },
    ] });
  /* Expired on purpose. The rates screen has to show it as expired rather than
     quietly using it — a quote priced from a lapsed tariff is the commonest
     way a forwarder sells below cost. */
  RC("rc-7", { carrierId: "p-maersk", carrier: "Maersk Line", mode: "OCEAN", origin: "CNSHA",
    destination: "ZACPT", eq: "40HC", buyCents: 228000, currency: "USD", transitDays: 30,
    validFrom: T0 - 200 * DAY, validTo: T0 - 12 * DAY, surcharges: [] });

  const PRC = (id, o) => { S.rateCards.push({ id, tenantId: "t-pa", kind: "CONTRACT",
    validFrom: T0 - 40 * DAY, validTo: T0 + 120 * DAY, ...o }); };
  PRC("pc-1", { carrierId: "p-cmacgm", carrier: "CMA CGM", mode: "OCEAN", origin: "ZACPT",
    destination: "BRSSZ", eq: "40RF", buyCents: 206000, currency: "USD", transitDays: 18,
    surcharges: [
      { code: "THC", desc: "Terminal handling, Santos", basis: "PER_CONTAINER", amount: 21000, currency: "USD" },
      { code: "BAF", desc: "Bunker adjustment", basis: "PERCENT_OF_FREIGHT", amount: 1080, currency: "USD" },
    ] });
  PRC("pc-2", { carrierId: "p-maersk", carrier: "Maersk Line", mode: "OCEAN", origin: "ZACPT",
    destination: "NLRTM", eq: "40RF", buyCents: 251000, currency: "USD", transitDays: 20,
    surcharges: [{ code: "THC", desc: "Terminal handling, Rotterdam", basis: "PER_CONTAINER", amount: 24500, currency: "USD" }] });
  PRC("pc-3", { carrierId: "p-n3", carrier: "Boland Haulage", mode: "ROAD", origin: "ZACPT",
    destination: "ZAPLZ", eq: "40HC", buyCents: 1420000, currency: "ZAR", transitDays: 1,
    surcharges: [{ code: "BAF", desc: "Fuel levy", basis: "PERCENT_OF_FREIGHT", amount: 950, currency: "ZAR" }] });

  S.marginRules = [
    { id: "mr-1", tenantId: "t-op", customerId: null, origin: "CNSHA", destination: "ZADUR",
      mode: "OCEAN", marginBps: 1200, minMarginCents: 100000, createdAt: T0 - 90 * DAY },
    { id: "mr-2", tenantId: "t-op", customerId: null, origin: null, destination: null,
      mode: null, marginBps: 1800, minMarginCents: 150000, createdAt: T0 - 180 * DAY },
    { id: "mr-3", tenantId: "t-op", customerId: "p-ubuntu", origin: null, destination: null,
      mode: null, marginBps: 1500, minMarginCents: 120000, createdAt: T0 - 40 * DAY },
    /* The partner's own sell side, at its own margin. Nobody on the operator's
       side can see it, and it is not derived from theirs. */
    { id: "pmr-1", tenantId: "t-pa", customerId: null, origin: null, destination: null,
      mode: null, marginBps: 2200, minMarginCents: 180000, createdAt: T0 - 30 * DAY },
    { id: "pmr-2", tenantId: "t-pa", customerId: null, origin: "ZACPT", destination: "BRSSZ",
      mode: "OCEAN", marginBps: 1600, minMarginCents: 140000, createdAt: T0 - 20 * DAY },
  ];

  S.billingProfiles["t-op"] = {
    tenantId: "t-op", legalName: "FORGE Freight (Pty) Ltd", tradingName: "FORGE Freight",
    registrationNumber: "2019/447281/07", vatNumber: "4820291837", customsClientNumber: "20418877",
    addressLines: "Unit 7, Bayhead Business Park\n14 Langeberg Road\nBayhead, Durban 4001",
    country: "ZA", email: "billing@forgefreight.example", phone: "+27 31 100 4400",
    bankName: "Standard Bank", bankAccountName: "FORGE Freight (Pty) Ltd",
    bankAccountNumber: "042 118 774", bankBranchCode: "051001", bankSwift: "SBZAZAJJ",
    invoiceNumberPrefix: "FF", nextInvoiceNumber: 1, defaultPaymentTermsDays: 30,
    defaultCurrency: "ZAR", vatBps: 1500,
    invoiceFooter: "Payment strictly per terms. Queries must be raised within 14 days of invoice date, quoting the invoice number and shipment reference.",
  };
  /* Deliberately incomplete: a forwarder mid-onboarding must be able to bill
     today, and the platform has to say what is missing rather than print
     somebody else's bank account. */
  S.billingProfiles["t-pa"] = {
    tenantId: "t-pa", legalName: "Cape Coastal Forwarding CC", tradingName: "Cape Coastal",
    registrationNumber: "2021/338190/23", vatNumber: null, customsClientNumber: null,
    addressLines: "5 Dock Road\nV&A Waterfront, Cape Town 8001", country: "ZA",
    email: "accounts@capecoastal.example", phone: "+27 21 418 2200",
    bankName: null, bankAccountName: null, bankAccountNumber: null,
    bankBranchCode: null, bankSwift: null,
    invoiceNumberPrefix: "CCF", nextInvoiceNumber: 1, defaultPaymentTermsDays: 21,
    defaultCurrency: "ZAR", vatBps: 1500, invoiceFooter: null,
  };

  /* The origin agency agreement. A forwarder is held to two contracts, not
     one: what it sold the customer, and what its own agents agreed to charge
     it. Handling billed above the agreed tariff is the commonest error in the
     trade and the audit needs the number to catch it. */
  S.agencyTariff = [
    { tenantId: "t-op", code: "OHC", unitCents: 185000, currency: "ZAR", source: "Origin agency agreement, Q3 2026" },
    { tenantId: "t-op", code: "DEM", unitCents: 95000, currency: "ZAR", source: "Terminal tariff, Durban" },
    { tenantId: "t-pa", code: "OHC", unitCents: 198000, currency: "ZAR", source: "Cape Town terminal tariff, 2026" },
  ];

  S.aliases = [
    { id: "al-1", tenantId: "t-op", alias: "OTHCHARGE", canonical: "OHC", vendor: "Shanghai Port Agency" },
    { id: "al-2", tenantId: "t-op", alias: "FUELADJ", canonical: "BAF", vendor: "Maersk Line" },
    { id: "al-3", tenantId: "t-pa", alias: "QUAYHANDLING", canonical: "OHC", vendor: "Cape Town Terminal" },
  ];

  return S;
}

/* --------------------------------------------------------------- quote --- */

const LANE_KEY = (o, d, m) => `${o}→${d}·${m}`;

function selectRateCards(S, { tenantId, origin, destination, mode, containerType, at, urgency }) {
  const maxTransit = URGENCY[urgency || "STANDARD"].maxTransitDays;
  return S.rateCards
    /* Scoped to the company doing the quoting. This was pinned to the operator,
       which meant a partner agent pricing its own lane was quoting off the
       operator's buy rates — and seeing them on the Rates screen. A tenant
       predicate written as a constant is a tenant predicate that will be wrong
       the first time a second company signs up. */
    .filter((c) => c.tenantId === tenantId)
    .filter((c) => c.origin === origin && c.destination === destination && c.mode === mode)
    .filter((c) => !containerType || c.eq === containerType)
    .filter((c) => at >= c.validFrom && at <= c.validTo)
    /* Unknown transit is unknown, not slow: a carrier that has not published
       one is not dropped from an express search. */
    .filter((c) => maxTransit == null || c.transitDays == null || c.transitDays <= maxTransit);
}

/* Most specific rule wins; ties break by recency. Without the tiebreak the
   same quote could price at 15% or 18% depending on row order, which is a
   number a customer will eventually notice. */
function resolveMarginRule(S, { tenantId, customerId, origin, destination, mode }) {
  const scored = S.marginRules
    .filter((r) => r.tenantId === tenantId)
    .filter((r) => (!r.customerId || r.customerId === customerId)
      && (!r.origin || r.origin === origin)
      && (!r.destination || r.destination === destination)
      && (!r.mode || r.mode === mode))
    .map((r) => ({ r, dims: [r.customerId, r.origin, r.destination, r.mode].filter(Boolean).length }))
    .sort((a, b) => b.dims - a.dims || b.r.createdAt - a.r.createdAt);
  return scored[0] ? scored[0].r : { marginBps: 1800, minMarginCents: 0, id: "default" };
}

const toZar = (cents, ccy) => roundHalfUp(cents * (FX[ccy] || 1));

/* Buy + margin, with the floor applied per line — converted into the line's
   own currency first. Applying a R1,500 floor as though it were $1,500 turns
   an 18% margin into 69%, which is not a number any shipper accepts. */
function priceLine(code, description, quantity, buyEach, currency, rule, basis) {
  const buy = buyEach * quantity;
  const floor = roundHalfUp(rule.minMarginCents / (FX[currency] || 1));
  const sell = Math.max(roundHalfUp(buy * (1 + rule.marginBps / 10000)), buy + floor);
  /* The basis travels with the line. Without it a percent-of-freight surcharge
     priced at quantity 1 inherits the code's default PER_CONTAINER, and the
     audit then reports every one of them as billed for the wrong number of
     containers — the platform firing on its own arithmetic. */
  return { code, description, quantity, basis: basis || "PER_SHIPMENT",
    buyCents: buy, sellCents: sell, currency,
    buyZar: toZar(buy, currency), sellZar: toZar(sell, currency) };
}

const SURCHARGE_BASIS = {
  PERCENT_OF_FREIGHT: "PERCENTAGE", PER_CONTAINER: "PER_CONTAINER",
  PER_BL: "PER_DOCUMENT", PER_SHIPMENT: "PER_SHIPMENT",
};

function buildQuote(S, input) {
  const cards = selectRateCards(S, { ...input, at: S.now });
  if (!cards.length) {
    const anyLane = S.rateCards.some((c) => c.tenantId === input.tenantId
      && c.origin === input.origin && c.destination === input.destination && c.mode === input.mode);
    const err = new Error(anyLane
      ? `No rate on ${input.origin}→${input.destination} meets a ${URGENCY[input.urgency].label.toLowerCase()} service level. The fastest available transit is ${Math.min(...S.rateCards.filter((c) => c.tenantId === input.tenantId && c.origin === input.origin && c.destination === input.destination).map((c) => c.transitDays || 999))} days.`
      : `No valid rate card for ${input.origin}→${input.destination} by ${input.mode}.`);
    err.kind = anyLane ? "NO_SERVICE_LEVEL" : "NO_RATE";
    throw err;
  }
  const card = cards.slice().sort((a, b) => a.buyCents - b.buyCents)[0];
  const rule = resolveMarginRule(S, input);
  const qty = input.containerQuantity;

  const lines = [priceLine("FRT",
    `${card.mode} freight ${PORTS[card.origin]}→${PORTS[card.destination]} (${card.carrier})`,
    qty, card.buyCents, card.currency, rule, "PER_CONTAINER")];

  const freightBuy = card.buyCents * qty;
  for (const s of card.surcharges) {
    if (s.basis === "PERCENT_OF_FREIGHT") {
      lines.push(priceLine(s.code, `${s.desc} (${pct(s.amount)} of freight)`, 1,
        roundHalfUp(freightBuy * s.amount / 10000), s.currency, rule, SURCHARGE_BASIS[s.basis]));
    } else if (s.basis === "PER_CONTAINER") {
      lines.push(priceLine(s.code, s.desc, qty, s.amount, s.currency, rule, "PER_CONTAINER"));
    } else {
      lines.push(priceLine(s.code, s.desc, 1, s.amount, s.currency, rule, SURCHARGE_BASIS[s.basis]));
    }
  }

  /* Handling uplift as its own line rather than folded into the freight rate:
     a customer asking why dangerous goods cost more deserves a line that says
     so, and an operator renegotiating a carrier rate needs the base untouched. */
  const cons = input.consignment;
  if (cons) {
    const uplift = CARGO_TYPES[cons.cargoType].upliftBps;
    if (uplift > 0) {
      const base = lines[0].sellCents;
      lines.push({ code: "HND", description: `${CARGO_TYPES[cons.cargoType].label} cargo handling (${pct(uplift)})`,
        quantity: 1, basis: "PER_SHIPMENT", buyCents: 0, sellCents: roundHalfUp(base * uplift / 10000), currency: card.currency,
        buyZar: 0, sellZar: toZar(roundHalfUp(base * uplift / 10000), card.currency) });
    }
    const svc = URGENCY[cons.urgency].upliftBps;
    if (svc > 0) {
      const base = lines[0].sellCents;
      lines.push({ code: "SVC", description: `${URGENCY[cons.urgency].label} service level (${pct(svc)})`,
        quantity: 1, basis: "PER_SHIPMENT", buyCents: 0, sellCents: roundHalfUp(base * svc / 10000), currency: card.currency,
        buyZar: 0, sellZar: toZar(roundHalfUp(base * svc / 10000), card.currency) });
    }
  }

  const totalsByCurrency = {};
  for (const l of lines) totalsByCurrency[l.currency] = (totalsByCurrency[l.currency] || 0) + l.sellCents;

  return { card, rule, lines, totalsByCurrency,
    totalZar: lines.reduce((a, l) => a + l.sellZar, 0),
    buyZar: lines.reduce((a, l) => a + l.buyZar, 0),
    transitDays: card.transitDays };
}

/* ----------------------------------------------------------- lifecycle --- */

const LIFECYCLE = [
  { type: "shipment.booked",       status: "BOOKED",     label: "Booking confirmed",                     src: "console", customer: "Booking confirmed" },
  { type: "container.gated_in",    status: "BOOKED",     label: "Container received at origin terminal",  src: "DCSA",    customer: "Container received at the origin terminal" },
  { type: "container.loaded",      status: "IN_TRANSIT", label: "Container loaded on vessel",             src: "DCSA",    customer: "Container loaded on the vessel" },
  { type: "vessel.departed",       status: "IN_TRANSIT", label: "Vessel departed",                        src: "DCSA",    customer: "Vessel departed" },
  { type: "vessel.arrived",        status: "IN_TRANSIT", label: "Vessel arrived at destination",          src: "DCSA",    customer: "Vessel arrived at the destination port" },
  { type: "container.discharged",  status: "CUSTOMS",    label: "Container discharged",                   src: "DCSA",    customer: "Container discharged" },
  { type: "entry.submitted",       status: "CUSTOMS",    label: "Customs entry submitted",                src: "console", customer: "Customs entry submitted" },
  { type: "entry.released",        status: "CUSTOMS",    label: "Released by customs",                    src: "SARS",    customer: "Cleared by customs" },
  { type: "container.gated_out",   status: "IN_TRANSIT", label: "Gated out for delivery",                 src: "DCSA",    customer: "Out for delivery" },
  { type: "pod.confirmed",         status: "DELIVERED",  label: "Proof of delivery confirmed",            src: "Traccar", customer: "Delivered" },
];

const STATUS_TONE = { BOOKED: "accent", IN_TRANSIT: "", CUSTOMS: "warn", DELIVERED: "good", CANCELLED: "" };
const INV_TONE = { ISSUED: "accent", PART_PAID: "warn", PAID: "good", OVERDUE: "bad", CANCELLED: "" };
