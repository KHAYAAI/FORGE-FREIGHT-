/* ==========================================================================
 * ACTIONS
 *
 * Every mutation the console can perform. The seeded book is built by calling
 * these, not by hand-writing rows — so the freight already on the screen came
 * through exactly the code path your next booking will, and a bug in accrual
 * shows up in the seed rather than hiding until you click something.
 * ======================================================================== */

const uid = (S, p) => `${p}-${(++S.seq).toString(36)}`;

/* Append-only, and the only place events are created. Every projection below
   is derived from what this writes. */
function emit(S, { type, tenantId, shipmentId, payload, src = "console", actor = "system", minutes = 0 }) {
  S.now += minutes * 60000;
  const e = {
    eventId: uid(S, "evt"), type, tenantId, shipmentId: shipmentId || null,
    occurredAt: S.now, recordedAt: S.now, src, actor, payload: payload || {},
    published: true,
  };
  S.events.push(e);
  return e;
}

function tenantOf(S) { return S.users.find((u) => u.id === S.session.userId).tenantId; }
function currentUser(S) { return S.users.find((u) => u.id === S.session.userId); }
function tenant(S, id) { return S.tenants.find((t) => t.id === id || t.id === tenantOf(S)); }
function hasRole(S, role) { return currentUser(S).roles.includes(role); }

/* The portal's scope, and the only place data crosses a tenant boundary: a
   shipper's cargo lives in the forwarder's tenant, so the query resolves
   parties.customerTenantId to a set of party ids and filters bookings by it.
   No link, no visibility — invisible is the default. */
function customerScope(S, customerTenantId) {
  return S.parties.filter((p) => p.customerTenantId === customerTenantId).map((p) => p.id);
}

function visibleShipments(S) {
  const t = tenantOf(S);
  const tt = S.tenants.find((x) => x.id === t).type;
  if (tt === "CUSTOMER") {
    const scope = customerScope(S, t);
    return S.shipments.filter((s) => scope.includes(s.customerId));
  }
  return S.shipments.filter((s) => s.tenantId === t);
}

/* ------------------------------------------------------------ consignment */

function createConsignment(S, tenantId, input, mode) {
  const totals = computeTotals(input.items, mode);
  const c = {
    id: uid(S, "cons"), tenantId,
    description: input.description, cargoType: input.cargoType, urgency: input.urgency,
    portOfExit: (input.portOfExit || "").trim().toUpperCase(),
    portOfEntry: (input.portOfEntry || "").trim().toUpperCase(),
    pickupLocode: input.pickupLocode ? input.pickupLocode.trim().toUpperCase() : null,
    pickupAddress: input.pickupAddress || null,
    pickupContact: input.pickupContact || null,
    unNumber: input.unNumber ? input.unNumber.trim().toUpperCase() : null,
    imoClass: input.imoClass || null, packingGroup: input.packingGroup || null,
    tempMinDeciC: input.tempMinDeciC ?? null, tempMaxDeciC: input.tempMaxDeciC ?? null,
    items: input.items.map((i) => ({ ...i, id: uid(S, "ci") })),
    ...totals, createdAt: S.now,
  };
  const blocking = handlingRequirements(c).filter((r) => r.blocking);
  if (blocking.length) { const e = new Error(blocking[0].description); e.kind = "BLOCKED"; throw e; }
  S.consignments.push(c);
  return c;
}

/* ------------------------------------------------------------------ quote */

function createQuote(S, tenantId, input) {
  const result = buildQuote(S, input);
  const q = {
    id: uid(S, "q"), tenantId, customerId: input.customerId, status: "ISSUED",
    origin: input.origin, destination: input.destination, mode: input.mode,
    containerType: input.containerType, containerQuantity: input.containerQuantity,
    incoterm: input.incoterm, consignmentId: input.consignment ? input.consignment.id : null,
    rateCardId: result.card.id, marginRuleId: result.rule.id,
    lines: result.lines, totalZar: result.totalZar, buyZar: result.buyZar,
    transitDays: result.transitDays, carrier: result.card.carrier,
    validUntil: S.now + 14 * DAY, createdAt: S.now,
  };
  S.quotes.push(q);
  emit(S, { type: "quote.issued", tenantId, payload: {
    quoteId: q.id, lane: `${q.origin}→${q.destination}`, total: money(q.totalZar, "ZAR"),
    carrier: q.carrier, marginRule: result.rule.id } });
  return q;
}

/* -------------------------------------------------------------- booking -- */

let REF_SEQ = 40;

function bookQuote(S, quoteId, carrierBookingRef) {
  const q = S.quotes.find((x) => x.id === quoteId);
  if (!q) throw new Error("Quote not found");
  if (q.status === "ACCEPTED") { const e = new Error("This quote has already been booked."); e.kind = "CONFLICT"; throw e; }
  if (S.now > q.validUntil) { const e = new Error("This quote has expired — reprice it before booking."); e.kind = "EXPIRED"; throw e; }

  q.status = "ACCEPTED";
  const ref = `FF-2026-${String(++REF_SEQ).padStart(5, "0")}`;
  const cons = S.consignments.find((c) => c.id === q.consignmentId);

  const s = {
    id: uid(S, "sh"), tenantId: q.tenantId, quoteId: q.id, customerId: q.customerId,
    reference: ref, status: "BOOKED", origin: q.origin, destination: q.destination,
    mode: q.mode, incoterm: q.incoterm, consignmentId: q.consignmentId,
    carrierBookingRef: carrierBookingRef || null, carrier: q.carrier,
    blNumber: null, vesselName: null, voyage: null,
    containers: Array.from({ length: q.containerQuantity }, (_, i) => ({
      id: uid(S, "ct"), number: null, type: q.containerType })),
    step: 0, freeTimeDays: 5,
    dischargedAt: null, gateOutAt: null, emptyReturnedAt: null,
    etd: S.now + 6 * DAY, eta: S.now + 6 * DAY + (q.transitDays || 21) * DAY,
    createdAt: S.now,
  };
  S.shipments.push(s);

  emit(S, { type: "quote.accepted", tenantId: s.tenantId, shipmentId: s.id, payload: { quoteId: q.id } });
  emit(S, { type: "shipment.booked", tenantId: s.tenantId, shipmentId: s.id, payload: {
    reference: ref, lane: `${s.origin}→${s.destination}`, carrierBookingRef: s.carrierBookingRef } });
  accrueFor(S, s, "shipment.booked");
  return s;
}

/* ------------------------------------------------------------ lifecycle -- */

function advance(S, shipmentId, hours = 14) {
  const s = S.shipments.find((x) => x.id === shipmentId);
  if (!s || s.step >= LIFECYCLE.length - 1) return null;
  s.step += 1;
  const m = LIFECYCLE[s.step];
  S.now += hours * 3600000;
  s.status = m.status;

  if (m.type === "container.loaded") {
    s.containers.forEach((c, i) => { if (!c.number) c.number = containerNumber(S, i); });
    s.blNumber = s.blNumber || blNumber(S, s);
  }
  if (m.type === "container.discharged") s.dischargedAt = S.now;
  if (m.type === "container.gated_out") s.gateOutAt = S.now;
  if (m.type === "pod.confirmed") s.emptyReturnedAt = S.now + 2 * DAY;

  emit(S, { type: m.type, tenantId: s.tenantId, shipmentId: s.id, src: m.src, payload: {
    status: m.status, ...(s.blNumber ? { blNumber: s.blNumber } : {}) } });

  if (m.type === "entry.submitted") { const e = entryFor(S, s); if (e) e.status = "SUBMITTED"; }
  if (m.type === "entry.released") { const e = entryFor(S, s); if (e) e.status = "RELEASED"; }
  accrueFor(S, s, m.type);
  return m;
}

/* ISO 6346 — four letters then seven digits, with the check digit that makes a
   terminal accept it. Generated rather than faked because the number appears
   on the bill of lading and on the invoice, and a malformed one is the sort of
   detail somebody in the room will check. */
function containerNumber(S, i) {
  const owner = "MAEU";
  const serial = String(2411800 + S.seq * 7 + i * 13).slice(0, 6);
  const body = owner + "U" + serial;
  const VAL = { A:10,B:12,C:13,D:14,E:15,F:16,G:17,H:18,I:19,J:20,K:21,L:23,M:24,N:25,
    O:26,P:27,Q:28,R:29,S:30,T:31,U:32,V:34,W:35,X:36,Y:37,Z:38 };
  let sum = 0;
  for (let k = 0; k < 10; k++) {
    const ch = body[k];
    sum += (VAL[ch] != null ? VAL[ch] : Number(ch)) * Math.pow(2, k);
  }
  return `${owner}${serial}${sum % 11 % 10}`;
}
const blNumber = (S, s) => `${s.carrier === "Maersk Line" ? "MAEU" : "CMDU"}${240000000 + S.seq * 137}`;

/* --------------------------------------------------------------- charges */

/* What the billing consumer writes when an event lands. The taxonomy comes
   from the code itself: left on defaults, an automatically-accrued line claims
   to be an uncategorised charge the forwarder originated with no cost behind
   it — the exact shape the audit is built to pass. */
function pushCharge(S, s, code, o) {
  const def = CODE[code] || CODE.MSC;
  const qty = o.qty ?? 1;
  const ch = {
    id: uid(S, "ch"), tenantId: s.tenantId, shipmentId: s.id,
    code, description: o.description || def.label,
    kind: o.kind || def.kind, cat: def.cat, prov: o.prov || def.prov,
    basis: o.basis || def.basis, qty,
    unitSellCents: o.unitCents, sellCents: o.unitCents * qty,
    buyCents: o.buyCents ?? null, contractRef: o.contractRef || null,
    vendorName: o.vendorName || null, vendorInvoiceRef: o.vendorInvoiceRef || null,
    currency: o.currency || "ZAR", vatBps: def.tax ? (S.billingProfiles[s.tenantId]?.vatBps ?? 0) : 0,
    triggeredBy: o.on, invoiceId: null, disputed: false, match: "exact",
    createdAt: S.now,
  };
  S.charges.push(ch);
  emit(S, { type: "charge.accrued", tenantId: s.tenantId, shipmentId: s.id, src: "billing-accrual",
    payload: { chargeId: ch.id, code, sell: money(ch.sellCents, ch.currency), triggeredBy: o.on } });
  return ch;
}

function accrueFor(S, s, eventType) {
  /* Idempotent on the triggering event, exactly like the real consumer: the
     same milestone arriving twice from two carrier feeds must not bill twice. */
  if (S.charges.some((c) => c.shipmentId === s.id && c.triggeredBy === eventType)) return;
  const q = S.quotes.find((x) => x.id === s.quoteId);
  const boxes = s.containers.length;

  if (eventType === "shipment.booked" && q) {
    for (const l of q.lines) {
      const n = normaliseCode(l.code, aliasMap(S, s.tenantId));
      /* Everything on the quote is priced buy + margin by construction, so it
         is MARKED_UP whatever the code's default says. Calling a quoted
         surcharge a pass-through disbursement makes the audit fire on the
         platform's own arithmetic — which it did, until this line. */
      pushCharge(S, s, n.code, {
        description: l.description, qty: l.quantity, basis: l.basis,
        unitCents: roundHalfUp(l.sellZar / l.quantity), buyCents: l.buyZar,
        prov: l.buyCents > 0 ? "MARKED_UP" : "FORWARDER_ORIGINATED",
        vendorName: s.carrier, contractRef: `Quote ${q.id}`, on: eventType,
      });
    }
    /* The origin agent's own invoice, which arrives separately from the
       carrier's and is where handling errors live. */
    pushCharge(S, s, "OHC", { qty: boxes, unitCents: 215000, buyCents: 215000 * boxes,
      description: `Origin terminal handling, ${PORTS[s.origin] || s.origin}`,
      vendorName: "Shanghai Port Agency", vendorInvoiceRef: `SIPG-2026-${88100 + S.seq}`, on: eventType });
    pushCharge(S, s, "DOC", { qty: 1, unitCents: 85000, description: "Documentation fee", on: eventType });
  }

  if (eventType === "vessel.departed") {
    const t = S.tenants.find((x) => x.id === s.tenantId);
    if (t.type === "PARTNER_AGENT" && t.platformFeeBps) {
      const freight = S.charges.filter((c) => c.shipmentId === s.id && c.code === "FRT")
        .reduce((a, c) => a + c.sellCents, 0);
      const fee = roundHalfUp(freight * t.platformFeeBps / 10000);
      if (fee > 0) pushCharge(S, s, "PLF", { qty: 1, unitCents: fee, buyCents: 0,
        description: `Platform fee (${pct(t.platformFeeBps)} of freight)`, on: eventType });
    }
  }

  if (eventType === "entry.released") {
    const e = entryFor(S, s);
    const totals = e ? entryTotals(e) : { total: 0 };
    if (totals.total > 0) pushCharge(S, s, "DTY", { qty: 1, unitCents: totals.total,
      buyCents: totals.total, description: "Customs duty and VAT disbursed to SARS",
      vendorName: "South African Revenue Service", vendorInvoiceRef: e ? e.reference : null, on: eventType });
    pushCharge(S, s, "CCL", { qty: 1, unitCents: 195000, buyCents: 45000,
      description: "Customs clearance", on: eventType });
  }

  if (eventType === "container.gated_out") {
    const dwell = s.dischargedAt ? Math.ceil((S.now - s.dischargedAt) / DAY) : 0;
    const days = Math.max(0, dwell - s.freeTimeDays);
    if (days > 0) pushCharge(S, s, "DEM", { qty: days, unitCents: 95000, buyCents: 95000 * days,
      description: `Demurrage, ${PORTS[s.destination] || s.destination} container terminal`,
      vendorName: "Transnet Port Terminals", vendorInvoiceRef: `TPT-DEM-${9900 + S.seq}`, on: eventType });
    pushCharge(S, s, "DEL", { qty: s.containers.length, unitCents: 148000, buyCents: 112000 * s.containers.length,
      description: `Delivery, ${PORTS[s.destination] || s.destination} to consignee`,
      vendorName: "N3 Corridor Logistics", on: eventType });
  }
}

const aliasMap = (S, tenantId) =>
  new Map(S.aliases.filter((a) => a.tenantId === tenantId).map((a) => [normKey(a.alias), a.canonical]));

/* -------------------------------------------------------------- customs -- */

const TARIFF = [
  { hs: "6109.10", desc: "T-shirts, singlets, knitted, of cotton", rateBps: 4500, kw: "shirt cotton knit apparel tee" },
  { hs: "6203.42", desc: "Men's trousers, of cotton", rateBps: 4000, kw: "trousers pants cotton mens" },
  { hs: "8471.30", desc: "Portable data-processing machines, ≤10 kg", rateBps: 0, kw: "laptop notebook computer portable" },
  { hs: "8544.42", desc: "Electric conductors, fitted with connectors", rateBps: 1500, kw: "cable wire connector electric" },
  { hs: "0805.10", desc: "Oranges, fresh or dried", rateBps: 0, kw: "orange citrus fruit fresh" },
  { hs: "0806.10", desc: "Grapes, fresh", rateBps: 0, kw: "grape fruit fresh table" },
  { hs: "8408.20", desc: "Compression-ignition engines for vehicles", rateBps: 2000, kw: "engine diesel motor vehicle" },
  { hs: "7326.90", desc: "Other articles of iron or steel", rateBps: 1000, kw: "steel iron bracket fabricated part" },
  { hs: "3926.90", desc: "Other articles of plastics", rateBps: 2000, kw: "plastic moulded component article" },
  { hs: "8703.23", desc: "Motor cars, spark-ignition, 1500–3000 cc", rateBps: 2500, kw: "car vehicle motor passenger" },
  { hs: "9403.60", desc: "Other wooden furniture", rateBps: 2000, kw: "furniture wooden table chair" },
  { hs: "2204.21", desc: "Wine of fresh grapes, ≤2 litre containers", rateBps: 2500, kw: "wine bottle grape alcohol" },
];

function classify(query) {
  const q = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) return [];
  return TARIFF.map((t) => {
    const hay = (t.desc + " " + t.kw).toLowerCase();
    const hits = q.filter((w) => hay.includes(w)).length;
    return { ...t, confidence: hits / q.length };
  }).filter((t) => t.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

const entryFor = (S, s) => S.entries.find((e) => e.shipmentId === s.id);

function createEntry(S, shipmentId, lines) {
  const s = S.shipments.find((x) => x.id === shipmentId);
  const e = {
    id: uid(S, "en"), tenantId: s.tenantId, shipmentId,
    reference: `CUS-2026-${String(4100 + S.entries.length).padStart(5, "0")}`,
    status: "DRAFT", lines: lines.map((l) => ({ ...l, id: uid(S, "el"), confirmed: !!l.hsCode })),
    createdAt: S.now,
  };
  S.entries.push(e);
  emit(S, { type: "entry.prepared", tenantId: s.tenantId, shipmentId, payload: {
    entryId: e.id, reference: e.reference, lines: e.lines.length } });
  return e;
}

/* -------------------------------------------------------------- billing -- */

/* The issuing company's own gapless series, consumed atomically. Several
   jurisdictions require an issuer's numbering to be sequential with no gaps,
   and a shared sequence hands company B the numbers company A did not use. */
function nextInvoiceNumber(S, tenantId) {
  const p = S.billingProfiles[tenantId];
  const n = p.nextInvoiceNumber++;
  return `${p.invoiceNumberPrefix}-${new Date(S.now).getUTCFullYear()}-${String(n).padStart(6, "0")}`;
}

function profileCompleteness(p) {
  const missing = [];
  if (!p.registrationNumber) missing.push("Company registration number");
  if (!p.vatNumber) missing.push("VAT registration number");
  if (!p.addressLines) missing.push("Registered address");
  if (!p.bankAccountNumber || !p.bankName) missing.push("Bank account for payment");
  if (!p.customsClientNumber) missing.push("Customs client number (needed to lodge declarations)");
  return { ready: missing.length === 0, missing };
}

function issueInvoice(S, shipmentId, opts = {}) {
  const s = S.shipments.find((x) => x.id === shipmentId);
  const unbilled = S.charges.filter((c) => c.shipmentId === shipmentId && !c.invoiceId);
  if (!unbilled.length) { const e = new Error("No uninvoiced charges on this shipment."); e.kind = "CONFLICT"; throw e; }

  const p = S.billingProfiles[s.tenantId];
  const cust = S.parties.find((x) => x.id === s.customerId);
  const terms = opts.paymentTermsDays ?? p.defaultPaymentTermsDays;

  const byCcy = new Map();
  for (const c of unbilled) byCcy.set(c.currency, [...(byCcy.get(c.currency) || []), c]);

  const issued = [];
  for (const [currency, group] of byCcy) {
    const sub = group.reduce((a, c) => a + c.sellCents, 0);
    const vat = group.reduce((a, c) => a + lineVat(c.sellCents, c.vatBps), 0);
    const inv = {
      id: uid(S, "inv"), tenantId: s.tenantId, shipmentId, customerId: s.customerId,
      number: nextInvoiceNumber(S, s.tenantId), type: "FREIGHT_INVOICE", status: "ISSUED",
      subtotalCents: sub, vatCents: vat, totalCents: sub + vat,
      disbursementCents: group.filter((c) => c.prov === "PASS_THROUGH").reduce((a, c) => a + c.sellCents, 0),
      currency, paymentTermsDays: terms, dueDate: S.now + terms * DAY,
      blNumber: opts.blNumber ?? s.blNumber, customerReference: opts.customerReference || null,
      /* Snapshotted, not joined: a company that changes its bank account
         tomorrow must not change what today's invoice says. */
      issuer: { ...p }, billTo: cust ? {
        name: cust.name, addressLines: cust.address, country: cust.country,
        taxId: cust.taxId, email: cust.email } : { name: "Customer" },
      auditedAt: null, createdAt: S.now,
    };
    group.forEach((c) => { c.invoiceId = inv.id; });
    S.invoices.push(inv);
    emit(S, { type: "invoice.issued", tenantId: s.tenantId, shipmentId, payload: {
      invoiceId: inv.id, number: inv.number, total: money(inv.totalCents, currency),
      dueDate: new Date(inv.dueDate).toISOString().slice(0, 10) } });
    issued.push(inv);
  }
  return issued;
}

/* Settlement is decided by the running total, not by this one payment: two
   half payments used to leave an invoice PART_PAID forever. A part payment
   does not cure lateness, or an overdue invoice would drop off the list the
   moment a customer paid a token amount. */
function recordPayment(S, invoiceId, { amountCents, paymentRef, receivedAt }) {
  const inv = S.invoices.find((x) => x.id === invoiceId);
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "CANCELLED") { const e = new Error(`${inv.number} is cancelled and cannot be paid.`); e.kind = "CONFLICT"; throw e; }

  /* The reference is the bank's, and banks redeliver. Unique per invoice, so a
     replayed webhook is a no-op rather than a second credit — and it emits
     nothing, because a second payment.received would reach the ledger sink and
     the customer's notifications as though money had arrived twice. */
  if (S.payments.some((p) => p.invoiceId === invoiceId && p.paymentRef === paymentRef)) {
    const paid = paidOn(S, invoiceId);
    return { duplicate: true, paidCents: paid, outstandingCents: inv.totalCents - paid, status: inv.status };
  }

  S.payments.push({ id: uid(S, "pay"), tenantId: inv.tenantId, invoiceId,
    amountCents, currency: inv.currency, paymentRef, receivedAt: receivedAt || S.now, fresh: true });

  const paid = paidOn(S, invoiceId);
  const outstanding = inv.totalCents - paid;
  const late = inv.dueDate < S.now;
  inv.status = paid >= inv.totalCents ? "PAID" : paid > 0 ? (late ? "OVERDUE" : "PART_PAID") : inv.status;

  emit(S, { type: "payment.received", tenantId: inv.tenantId, shipmentId: inv.shipmentId, src: "ForgePay",
    payload: { invoiceId, amount: money(amountCents, inv.currency), paymentRef } });

  return { duplicate: false, paidCents: paid, outstandingCents: outstanding,
    overpaidCents: outstanding < 0 ? -outstanding : 0, status: inv.status };
}

const paidOn = (S, invoiceId) =>
  S.payments.filter((p) => p.invoiceId === invoiceId).reduce((a, p) => a + p.amountCents, 0);

/* The hourly sweep. The status existed in the enum and the console rendered it
   as a red badge with its own filter, but nothing ever set it — so the overdue
   count was permanently zero and the screen quietly lied. */
function markOverdue(S) {
  let n = 0;
  for (const inv of S.invoices) {
    if (["ISSUED", "PART_PAID"].includes(inv.status) && inv.dueDate < S.now) { inv.status = "OVERDUE"; n++; }
  }
  return n;
}

/* ---------------------------------------------------------------- audit -- */

function invoiceLines(S, invoiceId) {
  return S.charges.filter((c) => c.invoiceId === invoiceId);
}

function contractFor(S, inv) {
  const s = S.shipments.find((x) => x.id === inv.shipmentId);
  if (!s) return [];
  const q = S.quotes.find((x) => x.id === s.quoteId);
  if (!q) return [];
  /* The accepted quote, not the rate card. The quote is what this customer was
     actually sold, at the margin that applied on the day, and it is the
     document they would produce in a dispute. */
  const fromQuote = q.lines.filter((l) => l.quantity > 0).map((l) => ({
    code: normaliseCode(l.code, aliasMap(S, inv.tenantId)).code,
    unitCents: roundHalfUp(l.sellZar / l.quantity),
    currency: "ZAR", source: `Accepted quote of ${day(q.createdAt)}`,
  }));
  /* Plus the agency tariff, for the lines that never appear on a customer
     quote at all — origin handling, terminal charges. Those arrive on an
     agent's own invoice and are exactly where handling errors live. */
  const covered = new Set(fromQuote.map((c) => c.code));
  return fromQuote.concat((S.agencyTariff || []).filter((c) => !covered.has(c.code)));
}

function runAudit(S, invoiceId) {
  const inv = S.invoices.find((x) => x.id === invoiceId);
  const s = S.shipments.find((x) => x.id === inv.shipmentId);
  const lines = invoiceLines(S, invoiceId).map((c) => ({ ...c }));
  const p = S.billingProfiles[inv.tenantId];

  const facts = {
    containers: s ? s.containers.length : 0,
    /* One transport document per shipment until multi-B/L consolidation
       exists. Stated rather than assumed: the documentation-fee rule keys off
       it, and a wrong count there produces a wrong finding. */
    documents: 1,
    events: s ? [...new Set(S.events.filter((e) => e.shipmentId === s.id).map((e) => e.type))] : [],
    dischargedAt: s ? s.dischargedAt : null,
    gateOutAt: s ? s.gateOutAt : null,
    emptyReturnedAt: s ? s.emptyReturnedAt : null,
    /* Free time comes off the bill of lading. Where the terminal feed is dark
       it stays null and the demurrage rule reports unverifiable rather than
       computing against a default nobody agreed to. */
    freeTimeDays: INTEGRATIONS.find((i) => i.key === "terminal").live ? (s ? s.freeTimeDays : null) : null,
  };

  const fuel = INTEGRATIONS.find((i) => i.key === "fuel_index").live
    ? { index: "PLATTS_VLSFO_ROTTERDAM", quotedFor: new Date(S.now).toISOString().slice(0, 10),
        unitCents: 380000, currency: "ZAR" }
    : null;

  const res = auditInvoice({
    lines, facts, contract: contractFor(S, inv), fuelBenchmark: fuel,
    issuerVatRegistered: !!p.vatNumber, currency: inv.currency,
    statedSub: inv.subtotalCents, statedVat: inv.vatCents, statedTotal: inv.totalCents,
  });

  /* Persisted, upserted on re-run so opening the screen twice does not double
     the list — and a human's decision is never reset by a re-run. */
  for (const f of res.findings) {
    const key = `${invoiceId}|${f.code}|${f.chargeId || ""}`;
    const prior = S.invoiceExceptions.find((x) => x.key === key);
    if (prior) {
      Object.assign(prior, { sev: f.sev, msg: f.msg, variance: f.variance, detectedAt: S.now });
    } else {
      S.invoiceExceptions.push({ id: uid(S, "ex"), key, tenantId: inv.tenantId, invoiceId,
        chargeId: f.chargeId, code: f.code, sev: f.sev, status: "OPEN", msg: f.msg,
        variance: f.variance, detectedAt: S.now, resolvedAt: null, note: null });
    }
  }
  /* Findings that no longer reproduce are resolved, not deleted: the record
     that an exception existed and went away is the audit trail. */
  const live = new Set(res.findings.map((f) => `${invoiceId}|${f.code}|${f.chargeId || ""}`));
  for (const x of S.invoiceExceptions) {
    if (x.invoiceId === invoiceId && x.status === "OPEN" && !live.has(x.key)) {
      x.status = "RESOLVED"; x.resolvedAt = S.now; x.note = "No longer reproduced by the audit";
    }
  }
  inv.auditedAt = S.now;
  emit(S, { type: "invoice.audited", tenantId: inv.tenantId, shipmentId: inv.shipmentId, src: "audit",
    payload: { invoiceId, findings: res.findings.length, matchedSources: `${res.summary.matched}/4`,
      queryable: money(res.findings.reduce((a, f) => a + Math.max(0, f.variance || 0), 0), inv.currency) } });
  return res;
}

function resolveException(S, exceptionId, status, note) {
  const x = S.invoiceExceptions.find((e) => e.id === exceptionId);
  if (!x) return null;
  x.status = status;
  x.note = note || null;
  x.resolvedAt = status === "DISPUTED" ? null : S.now;
  /* Querying a line marks the charge, and the document holds that amount back
     from the balance while still showing it — netting it off would quietly
     reissue the invoice. */
  if (x.chargeId) {
    const c = S.charges.find((ch) => ch.id === x.chargeId);
    if (c) c.disputed = status === "DISPUTED";
  }
  return x;
}

/* ------------------------------------------------------------- filings --- */

function lodgeFiling(S, shipmentId, kind, payload) {
  const s = S.shipments.find((x) => x.id === shipmentId);
  const edi = INTEGRATIONS.find((i) => i.key === "sars_edi");
  const missing = edi.keys.filter(() => !edi.live);
  const ref = `SUB-${kind}-${s.reference}`;

  const prior = S.filings.find((f) => f.submissionRef === ref);
  if (prior) { prior.payload = payload; return prior; }

  const f = {
    id: uid(S, "fil"), tenantId: s.tenantId, shipmentId, kind, authority: "SARS",
    status: edi.live ? "SUBMITTED" : "QUEUED", payload, submissionRef: ref,
    authorityRef: edi.live ? `MRN26ZA${400000 + S.seq}` : null,
    /* Unconfigured, the declaration is still built, validated and stored. It
       stops here with the reason on it rather than being refused, because a
       complete declaration waiting on somebody's accreditation is worth
       something and a lost one is not. */
    lastError: edi.live ? null : `Not transmitted: SARS Customs EDI is not configured (${missing.join(", ")}). The declaration is stored and can be captured on eFiling.`,
    submittedAt: edi.live ? S.now : null, createdAt: S.now,
  };
  S.filings.push(f);
  emit(S, { type: edi.live ? "filing.submitted" : "filing.queued", tenantId: s.tenantId,
    shipmentId, src: "sars-filing", payload: { kind, submissionRef: ref, status: f.status } });
  return f;
}

/* ------------------------------------------------------------- populate -- */

/* The book, built by driving the actions above. Nothing below writes a row
   directly. */
function populate(S) {
  const cargo = (over) => ({
    description: "General merchandise", cargoType: "GENERAL", urgency: "STANDARD",
    portOfExit: "CNSHA", portOfEntry: "ZADUR",
    items: [{ description: "Cartons", packageType: "CARTON", pieces: 300,
      grossWeightGrams: 6_000_000, lengthMm: 600, widthMm: 400, heightMm: 400, stackable: true }],
    ...over,
  });

  /* The entry has to exist before the shipment reaches the customs milestones,
     or `advance` finds nothing to move to SUBMITTED and the duty disbursement
     accrues against a total of zero. Order matters here for the same reason it
     matters in the real system: these are consumers reacting to events, not a
     script filling in a table. */
  const ENTRY_AT = 5; // container.discharged — the point an entry is lodgeable

  const book = (spec) => {
    const cons = createConsignment(S, "t-op", cargo(spec.cargo), spec.mode);
    const q = createQuote(S, "t-op", {
      customerId: spec.customerId, origin: spec.origin, destination: spec.destination,
      mode: spec.mode, containerType: spec.eq, containerQuantity: spec.qty,
      incoterm: spec.incoterm || "CIF", consignment: cons,
      urgency: cons.urgency,
    });
    const s = bookQuote(S, q.id, spec.carrierRef);

    for (let i = 0; i < Math.min(spec.steps, ENTRY_AT); i++) advance(S, s.id, 10 + (i % 5) * 6);
    if (spec.steps >= ENTRY_AT) {
      const guess = classify(cons.description)[0];
      createEntry(S, s.id, [{
        description: cons.description,
        hsCode: guess ? guess.hs : null,
        dutyRateBps: guess ? guess.rateBps : 0,
        /* Declared value of the goods, not the freight. Duty on a container of
           apparel routinely exceeds what it cost to move it, which is exactly
           why a forwarder fronting it needs the disbursement tracked. */
        customsValueCents: 45_000_000 + s.containers.length * 38_000_000,
        sacuOrigin: false,
      }]);
    }
    for (let i = ENTRY_AT; i < spec.steps; i++) advance(S, s.id, 10 + (i % 5) * 6);
    return s;
  };

  const jobs = [
    { customerId: "p-ubuntu", origin: "CNSHA", destination: "ZADUR", mode: "OCEAN", eq: "40HC", qty: 2, steps: 9,
      carrierRef: "MAEU8841203", cargo: { description: "Cotton knitted T-shirts, printed, for retail distribution",
        items: [{ description: "Cotton T-shirts", packageType: "CARTON", pieces: 420,
          grossWeightGrams: 8_400_000, lengthMm: 600, widthMm: 400, heightMm: 400,
          stackable: true, marksAndNumbers: "UBT/DUR/1-420", hsCode: "6109.10" }] } },
    { customerId: "p-kalahari", origin: "DEHAM", destination: "ZADUR", mode: "OCEAN", eq: "40HC", qty: 1, steps: 9,
      carrierRef: "MAEU7710942", cargo: { description: "Industrial fabric rolls and haberdashery",
        portOfExit: "DEHAM",
        items: [{ description: "Fabric rolls", packageType: "ROLL", pieces: 88,
          grossWeightGrams: 15_400_000, lengthMm: 1800, widthMm: 500, heightMm: 500, stackable: false }] } },
    { customerId: "p-savanna", origin: "ZADUR", destination: "NLRTM", mode: "OCEAN", eq: "40RF", qty: 3, steps: 5,
      carrierRef: "MAEU5520118", cargo: { description: "Fresh table grapes, export grade",
        cargoType: "REEFER", urgency: "EXPRESS", portOfExit: "ZADUR", portOfEntry: "NLRTM",
        tempMinDeciC: -5, tempMaxDeciC: 5,
        items: [{ description: "Grapes, 4.5 kg cartons", packageType: "CARTON", pieces: 4400,
          grossWeightGrams: 19_800_000, lengthMm: 400, widthMm: 300, heightMm: 180, stackable: true }] } },
    { customerId: "p-nordwind", origin: "DEHAM", destination: "ZADUR", mode: "OCEAN", eq: "40HC", qty: 1, steps: 3,
      carrierRef: "MAEU7710988", cargo: { description: "Compression-ignition engine assemblies",
        cargoType: "OVERSIZED", portOfExit: "DEHAM",
        items: [{ description: "Engine assemblies, crated", packageType: "CRATE", pieces: 6,
          grossWeightGrams: 11_200_000, lengthMm: 2400, widthMm: 1200, heightMm: 1400, stackable: false }] } },
    { customerId: "p-ubuntu", origin: "INNSA", destination: "ZADUR", mode: "OCEAN", eq: "20GP", qty: 1, steps: 2,
      carrierRef: "CMDU3390221", cargo: { description: "Moulded plastic components", portOfExit: "INNSA",
        items: [{ description: "Plastic components", packageType: "BAG", pieces: 640,
          grossWeightGrams: 9_600_000, lengthMm: 700, widthMm: 500, heightMm: 400, stackable: true }] } },
    { customerId: "p-kalahari", origin: "CNSHA", destination: "ZADUR", mode: "OCEAN", eq: "40HC", qty: 1, steps: 1,
      carrierRef: null, cargo: { description: "Assorted haberdashery and trims",
        items: [{ description: "Trims and fastenings", packageType: "CARTON", pieces: 210,
          grossWeightGrams: 3_150_000, lengthMm: 500, widthMm: 400, heightMm: 350, stackable: true }] } },
    { customerId: "p-savanna", origin: "ZADUR", destination: "ZAJNB", mode: "ROAD", eq: "40HC", qty: 1, steps: 9,
      carrierRef: null, cargo: { description: "Citrus for domestic distribution",
        cargoType: "PERISHABLE", portOfExit: "ZADUR", portOfEntry: "ZAJNB",
        pickupLocode: "ZADUR", pickupAddress: "Bayhead cold store, Durban",
        items: [{ description: "Oranges, 15 kg cartons", packageType: "CARTON", pieces: 1200,
          grossWeightGrams: 18_000_000, lengthMm: 400, widthMm: 300, heightMm: 260, stackable: true }] } },
    { customerId: "p-orion", origin: "CNSHA", destination: "ZADUR", mode: "OCEAN", eq: "40HC", qty: 2, steps: 9,
      carrierRef: "MAEU8841772", cargo: { description: "Fabricated steel brackets",
        items: [{ description: "Steel brackets, banded", packageType: "PALLET", pieces: 24,
          grossWeightGrams: 21_600_000, lengthMm: 1200, widthMm: 1000, heightMm: 900, stackable: true }] } },
  ];

  /* One unbookable job must not blank the whole console. The engine refuses a
     service level it cannot meet — correctly — and a seed that trips that rule
     should lose one shipment, not the application. */
  const built = [];
  for (const j of jobs) {
    try { built.push(book(j)); }
    catch (err) { console.warn("seed: skipped a job —", err.message); }
  }

  /* Invoice the shipments that have finished moving. */
  for (const s of built) {
    if (s.step < 8) continue;
    const invs = issueInvoice(S, s.id, {
      customerReference: `PO-${88000 + S.seq}`,
    });
    for (const inv of invs) runAudit(S, inv.id);
  }

  /* Money in, in the shapes finance actually sees. */
  const settled = S.invoices[0];
  if (settled) {
    recordPayment(S, settled.id, { amountCents: Math.round(settled.totalCents * 0.4), paymentRef: "FNB-2026-114872" });
    recordPayment(S, settled.id, { amountCents: settled.totalCents - Math.round(settled.totalCents * 0.4), paymentRef: "FNB-2026-115003" });
  }
  const part = S.invoices[1];
  if (part) recordPayment(S, part.id, { amountCents: Math.round(part.totalCents * 0.35), paymentRef: "SBSA-2026-77120" });

  /* An invoice already past its terms, so the overdue sweep has something to
     find and the finance screen is not uniformly green. */
  if (S.invoices[2]) S.invoices[2].dueDate = S.now - 9 * DAY;
  markOverdue(S);

  /* Exceptions the ops desk is actually looking at. */
  const rolled = built[3];
  if (rolled) {
    emit(S, { type: "booking.rolled", tenantId: rolled.tenantId, shipmentId: rolled.id, src: "DCSA",
      payload: { reason: "Carrier omitted the port call", etaShift: "+7d" } });
    S.exceptions.push({ id: uid(S, "exc"), tenantId: rolled.tenantId, shipmentId: rolled.id,
      code: "BOOKING_ROLLED", status: "OPEN", detail: "Carrier omitted the Durban port call; ETA moves out seven days.",
      raisedAt: S.now });
    rolled.eta += 7 * DAY;
  }
  const held = built[7];
  if (held) {
    emit(S, { type: "compliance.hold_placed", tenantId: held.tenantId, shipmentId: held.id, src: "yente",
      payload: { partyId: "p-orion", verdict: "REVIEW", matchScore: 0.71 } });
    S.exceptions.push({ id: uid(S, "exc"), tenantId: held.tenantId, shipmentId: held.id,
      code: "COMPLIANCE_HOLD", status: "OPEN",
      detail: "Orion Metals Trading matched a watchlist entry at 0.71. A human has to clear or refuse it before this moves.",
      raisedAt: S.now });
  }
  const queried = built[1];
  if (queried) {
    emit(S, { type: "entry.queried", tenantId: queried.tenantId, shipmentId: queried.id, src: "SARS",
      payload: { query: "Tariff heading queried — supporting invoice requested" } });
    S.exceptions.push({ id: uid(S, "exc"), tenantId: queried.tenantId, shipmentId: queried.id,
      code: "CUSTOMS_QUERY", status: "OPEN",
      detail: "SARS queried the tariff heading and asked for the supplier invoice.", raisedAt: S.now });
  }

  /* Documents waiting on a human, with the confidence that put them there. */
  const docs = [
    { name: "commercial-invoice-UBT-4471.pdf", kind: "COMMERCIAL_INVOICE", shipment: built[0], conf: 0.94,
      fields: { invoiceNumber: "UBT-4471", seller: "Shanghai Yicheng Apparel Co.", value: "USD 41,200.00", incoterm: "FOB" } },
    { name: "packing-list-UBT-4471.pdf", kind: "PACKING_LIST", shipment: built[0], conf: 0.88,
      fields: { cartons: "420", grossWeight: "8,400 kg", marks: "UBT/DUR/1-420" } },
    { name: "bill-of-lading-MAEU7710942.pdf", kind: "BILL_OF_LADING", shipment: built[1], conf: 0.71,
      fields: { blNumber: "MAEU7710942", shipper: "Nordwind Maschinenbau GmbH", freeTime: "5 days" } },
    { name: "scan-0041.jpg", kind: "UNKNOWN", shipment: built[4], conf: 0.42,
      fields: { note: "Low-resolution phone photograph; most fields unreadable" } },
  ];
  for (const d of docs) {
    if (!d.shipment) continue;
    S.documents.push({ id: uid(S, "doc"), tenantId: "t-op", shipmentId: d.shipment.id,
      filename: d.name, kind: d.kind, confidence: d.conf,
      /* Below the review threshold is not a failure — it is the system saying
         it will not guess at a number that ends up on a customs declaration. */
      status: d.conf >= 0.85 ? "EXTRACTED" : "NEEDS_REVIEW",
      fields: d.fields, uploadedAt: S.now - Math.round(Math.random() * 3) * DAY });
    emit(S, { type: "document.uploaded", tenantId: "t-op", shipmentId: d.shipment.id,
      payload: { filename: d.name, kind: d.kind } });
  }

  /* A declaration lodged with the channel dark, so the compliance screen has
     the honest state on it rather than an empty table. */
  const filed = built.find((s) => entryFor(S, s));
  if (filed) {
    const e = entryFor(S, filed);
    lodgeFiling(S, filed.id, "SARS_CUSDEC", {
      reference: e.reference, lines: e.lines.length,
      customsValue: money(entryTotals(e).customsValue, "ZAR"),
      duty: money(entryTotals(e).duty, "ZAR"), vat: money(entryTotals(e).vat, "ZAR"),
    });
  }

  /* The partner's own book, on the same rails. Its shipments belong to its
     tenant and never appear in the operator's list. */
  const pcons = createConsignment(S, "t-pa", {
    description: "Export-grade apples and pears, controlled atmosphere",
    cargoType: "REEFER", urgency: "EXPRESS", portOfExit: "ZACPT", portOfEntry: "BRSSZ",
    tempMinDeciC: -5, tempMaxDeciC: 15,
    items: [{ description: "Apples, 12.5 kg cartons", packageType: "CARTON", pieces: 3600,
      grossWeightGrams: 22_500_000, lengthMm: 400, widthMm: 300, heightMm: 260, stackable: true }],
  }, "OCEAN");
  const pq = createQuote(S, "t-pa", {
    customerId: "p-cc-cust", origin: "ZACPT", destination: "BRSSZ", mode: "OCEAN",
    containerType: "40RF", containerQuantity: 2, incoterm: "CIF",
    consignment: pcons, urgency: "EXPRESS",
  });
  const ps = bookQuote(S, pq.id, "CMDU8871220");
  ps.tenantId = "t-pa";
  S.charges.filter((c) => c.shipmentId === ps.id).forEach((c) => { c.tenantId = "t-pa"; });
  S.events.filter((e) => e.shipmentId === ps.id).forEach((e) => { e.tenantId = "t-pa"; });
  for (let i = 0; i < 4; i++) advance(S, ps.id, 12);

  /* Leave the clock where the work left it, one day on. Setting it back to the
     start would stamp everything the user does next as earlier than the seed —
     an append-only log that reads out of order is a log nobody trusts. */
  S.now = Math.max(S.now, ...S.events.map((e) => e.occurredAt)) + DAY;
  return S;
}
