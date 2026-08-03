/* ==========================================================================
 * DOMAIN
 *
 * Ported from the platform's own pure modules — packing.ts, quote-engine.ts,
 * duty-calculator.ts, charge-codes.ts, invoice-document.ts, invoice-audit.ts.
 * Same divisors, same margin-floor conversion, same VAT treatment, same audit
 * rules, same rounding. Nothing here is approximated for the sake of a demo:
 * if a number on this screen disagrees with the running product, one of the
 * two is wrong and it is worth knowing which.
 *
 * Everything is integer minor units. Money in cents, weight in grams, volume
 * in cubic centimetres, temperature in tenths of a degree, rates in basis
 * points. Floating point in a chargeable-weight calculation is how a shipment
 * gets billed at 21,119.999 kg.
 * ======================================================================== */

const roundHalfUp = (v) => Math.floor(v + 0.5);

/* Money, formatted identically everywhere. Deliberately not toLocaleString:
   the separators it picks come from the runtime's ICU build, which is how one
   screen ended up showing `ZAR 8 700,00` beside `ZAR 4,500.00`. */
function money(cents, ccy = "ZAR") {
  const n = Number(cents || 0) / 100;
  const sign = n < 0 ? "-" : "";
  const [w, f] = Math.abs(n).toFixed(2).split(".");
  return `${ccy} ${sign}${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`;
}
const num = (v, d = 0) => {
  const [w, f] = Number(v || 0).toFixed(d).split(".");
  const g = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return d ? `${g}.${f}` : g;
};
const pct = (bps) => (bps / 100).toFixed(bps % 100 ? 2 : 0) + "%";
const kg = (grams) => num(grams / 1000, 1) + " kg";
const cbm = (cm3) => (cm3 / 1e6).toFixed(3) + " m³";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/* UTC and locale-free: an invoice dated the 1st in Durban must not read as the
   31st for someone opening it in São Paulo. */
const day = (d) => d ? `${String(new Date(d).getUTCDate()).padStart(2,"0")} ${MONTHS[new Date(d).getUTCMonth()]} ${new Date(d).getUTCFullYear()}` : "—";
const stamp = (d) => d ? `${day(d)} ${new Date(d).toISOString().slice(11,16)}` : "—";
const ago = (d, now) => {
  const s = Math.max(0, Math.floor((now - new Date(d)) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

/* ------------------------------------------------------------- packing --- */

/* Freight is sold on the greater of what the goods weigh and what their space
   is deemed to weigh. IATA publishes 6000 cm³/kg for air; ocean LCL uses the
   freight tonne (1 m³ = 1000 kg). A pallet of pillows and a pallet of steel
   occupy the same slot, and a quote priced on gross weight loses money on
   every low-density shipment. */
const VOLUMETRIC_DIVISOR = { AIR: 6000, OCEAN: 1000, ROAD: 3000, RAIL: 3000 };

const CARGO_TYPES = {
  GENERAL:     { label: "General",      upliftBps: 0 },
  HAZARDOUS:   { label: "Hazardous",    upliftBps: 3500 },
  REEFER:      { label: "Reefer",       upliftBps: 2500 },
  PERISHABLE:  { label: "Perishable",   upliftBps: 1200 },
  OVERSIZED:   { label: "Oversized",    upliftBps: 4000 },
  VALUABLE:    { label: "Valuable",     upliftBps: 1500 },
  LIVE_ANIMALS:{ label: "Live animals", upliftBps: 5000 },
};

const URGENCY = {
  ECONOMY:  { label: "Economy",  upliftBps: 0,    maxTransitDays: null },
  STANDARD: { label: "Standard", upliftBps: 0,    maxTransitDays: null },
  EXPRESS:  { label: "Express",  upliftBps: 1800, maxTransitDays: 21 },
  CRITICAL: { label: "Critical", upliftBps: 4500, maxTransitDays: 10 },
};

const PACKAGE_TYPES = {
  PALLET: "Pallet", CARTON: "Carton", CRATE: "Crate", DRUM: "Drum",
  BAG: "Bag / sack", BALE: "Bale", ROLL: "Roll", IBC: "IBC tote",
  BULK: "Bulk", LOOSE: "Loose pieces",
};

/* The packing-list convention, stated rather than inferred: a line reads
   "10 CTNS, 40 x 60 x 40 cm, 250 KGS" — dimensions are PER PIECE and the
   weight is the LINE TOTAL. Reading either the other way is a tenfold error. */
function computeTotals(items, mode) {
  const divisor = VOLUMETRIC_DIVISOR[mode] || VOLUMETRIC_DIVISOR.OCEAN;
  let pieces = 0, grossWeightGrams = 0, volumeCm3 = 0;
  for (const it of items) {
    pieces += it.pieces || 0;
    grossWeightGrams += it.grossWeightGrams || 0;
    if (it.lengthMm && it.widthMm && it.heightMm) {
      const perPiece = (it.lengthMm / 10) * (it.widthMm / 10) * (it.heightMm / 10);
      volumeCm3 += Math.round(perPiece * (it.pieces || 0));
    }
  }
  const volumetricWeightGrams = Math.round((volumeCm3 / divisor) * 1000);
  const chargeableWeightGrams = Math.max(grossWeightGrams, volumetricWeightGrams);
  return {
    pieces, grossWeightGrams, volumeCm3, volumetricWeightGrams, chargeableWeightGrams,
    volumetricApplies: volumetricWeightGrams > grossWeightGrams, divisor,
  };
}

/* What a terminal, a carrier or a customs officer will require before this
   box moves. Blocking requirements are refused at quote time rather than at
   the port — an incomplete dangerous-goods declaration is the commonest
   reason a container is turned away at a gate. */
function handlingRequirements(c) {
  const out = [];
  if (c.cargoType === "HAZARDOUS") {
    if (!c.unNumber || !c.imoClass || !c.packingGroup) {
      out.push({ code: "DG_DECLARATION", blocking: true,
        description: "Dangerous goods need a UN number, IMO class and packing group before this can be quoted." });
    } else {
      out.push({ code: "DG_SEGREGATION", blocking: false,
        description: `${c.unNumber}, class ${c.imoClass}, PG ${c.packingGroup} — stowage and segregation apply, and the carrier needs the declaration before cut-off.` });
    }
  }
  if (c.cargoType === "REEFER") {
    if (c.tempMinDeciC == null || c.tempMaxDeciC == null) {
      out.push({ code: "TEMP_RANGE", blocking: true,
        description: "Reefer cargo needs a temperature range before a container can be booked." });
    } else {
      out.push({ code: "TEMP_SETPOINT", blocking: false,
        description: `Setpoint ${(c.tempMinDeciC / 10).toFixed(1)}°C to ${(c.tempMaxDeciC / 10).toFixed(1)}°C — genset required for the inland leg.` });
    }
  }
  if (c.cargoType === "OVERSIZED") out.push({ code: "OOG_SURVEY", blocking: false,
    description: "Out-of-gauge cargo needs a stowage survey and may require breakbulk handling." });
  if (c.cargoType === "VALUABLE") out.push({ code: "HIGH_VALUE", blocking: false,
    description: "High-value cargo — all-risks cover and a sealed-container declaration are advisable." });
  if (c.cargoType === "LIVE_ANIMALS") out.push({ code: "LIVE_ANIMALS", blocking: false,
    description: "Live animals require a veterinary certificate and an IATA LAR-compliant container." });
  if ((c.items || []).some((i) => i.stackable === false)) out.push({ code: "NON_STACKABLE", blocking: false,
    description: "Non-stackable freight costs the slot above it; carriers price this up." });
  return out;
}

/* ------------------------------------------------------------- charges --- */

/* The canonical taxonomy. One vendor writes "OHC", the next "origin
   handling", a third bundles it into freight — until they collapse onto one
   code you cannot compare two vendors, match a line to a contract, or say what
   a lane costs.
   `err` is not decoration: fuel, destination terminal handling and
   documentation carry the highest documented error rates precisely because
   accounts payable scrutinises them least and the forwarder has the most
   discretion over them. */
const CHARGE_CODES = [
  { code: "PCK",  label: "Pick-up / pre-carriage",     cat: "ORIGIN",   kind: "FREIGHT",      basis: "PER_SHIPMENT",  prov: "MARKED_UP",            tax: true,  err: "MEDIUM", aliases: ["PICKUP","PRECARRIAGE","COLLECTION","CARTAGE IN"], note: "Door to port of exit. A shipment delivered to the port by the shipper should not carry this at all." },
  { code: "OHC",  label: "Origin terminal handling",   cat: "ORIGIN",   kind: "SURCHARGE",    basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "MEDIUM", aliases: ["OTHC","ORIGIN HANDLING","ORIG HANDLING CHG","ORIGIN TERMINAL HANDLING"] },
  { code: "EXW",  label: "Export customs clearance",   cat: "ORIGIN",   kind: "FEE",          basis: "PER_SHIPMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "LOW",    aliases: ["EXPORT CLEARANCE","EXPORT ENTRY"] },
  { code: "VGM",  label: "Verified gross mass",        cat: "ORIGIN",   kind: "FEE",          basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "LOW",    aliases: ["VERIFIED GROSS MASS","SOLAS VGM","WEIGHING"], note: "SOLAS-mandated weighing. One per container, never per shipment." },
  { code: "FRT",  label: "Ocean / air freight",        cat: "FREIGHT",  kind: "FREIGHT",      basis: "PER_CONTAINER", prov: "MARKED_UP",            tax: true,  err: "LOW",    aliases: ["OCEAN FREIGHT","AIR FREIGHT","BASIC FREIGHT","BAS","OFR"], note: "The most scrutinised line on the invoice, and therefore the cleanest." },
  { code: "HND",  label: "Cargo handling uplift",      cat: "FREIGHT",  kind: "SURCHARGE",    basis: "PER_SHIPMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "LOW",    aliases: ["HANDLING UPLIFT","SPECIAL CARGO","DG SURCHARGE"] },
  { code: "SVC",  label: "Service level",              cat: "FREIGHT",  kind: "SURCHARGE",    basis: "PER_SHIPMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "LOW",    aliases: ["EXPRESS SURCHARGE","PRIORITY"] },
  { code: "BAF",  label: "Bunker adjustment factor",   cat: "FUEL",     kind: "SURCHARGE",    basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["BUNKER","FUEL SURCHARGE","FAF","LSS","LOW SULPHUR","FUEL"], note: "Should track a published bunker index at the contracted formula. In practice it is applied at whatever last quarter's level was. Highest-value audit target on the document." },
  { code: "EBS",  label: "Emergency bunker surcharge", cat: "FUEL",     kind: "SURCHARGE",    basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["EMERGENCY BUNKER","EBAF","EMERGENCY FUEL"], note: "Temporary by definition. Still on an invoice a year later means nobody removed it." },
  { code: "CAF",  label: "Currency adjustment factor", cat: "FUEL",     kind: "SURCHARGE",    basis: "PERCENTAGE",    prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["CURRENCY ADJUSTMENT","FX SURCHARGE"] },
  { code: "THC",  label: "Destination terminal handling", cat: "DEST",  kind: "SURCHARGE",    basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["DTHC","THC-D","TERMINAL HANDLING","DESTINATION HANDLING"], note: "Set by the terminal, billed per container. Charged at the origin tariff, charged per shipment, or charged twice when an agent also bills it." },
  { code: "ISPS", label: "Port security (ISPS)",       cat: "DEST",     kind: "SURCHARGE",    basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "MEDIUM", aliases: ["SECURITY SURCHARGE","PORT SECURITY","CSC"] },
  { code: "WHF",  label: "Wharfage / port dues",       cat: "DEST",     kind: "DISBURSEMENT", basis: "PER_CONTAINER", prov: "PASS_THROUGH",         tax: true,  err: "MEDIUM", aliases: ["WHARFAGE","PORT DUES","HARBOUR DUES"] },
  { code: "DEL",  label: "Delivery / on-carriage",     cat: "DEST",     kind: "FREIGHT",      basis: "PER_CONTAINER", prov: "MARKED_UP",            tax: true,  err: "MEDIUM", aliases: ["DELIVERY","ONCARRIAGE","CARTAGE OUT","HAULAGE"] },
  { code: "TOL",  label: "Road tolls",                 cat: "DEST",     kind: "DISBURSEMENT", basis: "PER_SHIPMENT",  prov: "PASS_THROUGH",         tax: true,  err: "LOW",    aliases: ["TOLL","TOLLS","GANTRY FEES"] },
  { code: "CCL",  label: "Customs clearance",          cat: "CUSTOMS",  kind: "FEE",          basis: "PER_SHIPMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "MEDIUM", aliases: ["CLEARANCE","BROKERAGE","ENTRY FEE"], note: "The broker's fee for lodging the entry. The fee is the forwarder's; the duty is not." },
  { code: "DSB",  label: "Disbursement fee",           cat: "CUSTOMS",  kind: "FEE",          basis: "PERCENTAGE",    prov: "FORWARDER_ORIGINATED", tax: true,  err: "MEDIUM", aliases: ["DISBURSEMENT FEE","CASH OUTLAY","ADVANCE FEE"], note: "Charge for fronting duty and VAT. Uncapped, it is the quietest overcharge on the document." },
  { code: "DTY",  label: "Customs duty & import VAT",  cat: "DUTY",     kind: "DISBURSEMENT", basis: "PER_SHIPMENT",  prov: "PASS_THROUGH",         tax: false, err: "LOW",    aliases: ["DUTY","IMPORT DUTY","IMPORT VAT"], note: "Paid to the authority on the customer's behalf and recovered at cost. Outside the scope of VAT — a margin on it is not a markup but a misdeclaration." },
  { code: "DOC",  label: "Documentation fee",          cat: "DOCS",     kind: "FEE",          basis: "PER_DOCUMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "HIGH",   aliases: ["DOCUMENTATION","DOC FEE","BL FEE","B/L FEE","AWB FEE"], note: "Entirely at the forwarder's discretion, small enough that nobody queries it. Charged per bill of lading, not per container." },
  { code: "TLX",  label: "Telex / express release",    cat: "DOCS",     kind: "FEE",          basis: "PER_DOCUMENT",  prov: "PASS_THROUGH",         tax: true,  err: "MEDIUM", aliases: ["TELEX RELEASE","SURRENDER BL","SEAWAY BILL"] },
  { code: "COO",  label: "Certificate of origin",      cat: "DOCS",     kind: "DISBURSEMENT", basis: "PER_DOCUMENT",  prov: "PASS_THROUGH",         tax: true,  err: "LOW",    aliases: ["CERTIFICATE OF ORIGIN","EUR1","SADC CERTIFICATE"] },
  { code: "AMS",  label: "Manifest filing",            cat: "DOCS",     kind: "FEE",          basis: "PER_DOCUMENT",  prov: "PASS_THROUGH",         tax: true,  err: "MEDIUM", aliases: ["AMS FEE","ENS","ACI","ISF","ADVANCE MANIFEST"] },
  { code: "DEM",  label: "Demurrage",                  cat: "TIME",     kind: "DISBURSEMENT", basis: "PER_DAY",       prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["DEMURRAGE","STORAGE","PORT STORAGE"], note: "Container inside the terminal beyond free time. Re-derivable exactly from the free-time allowance and the gate timestamps — which is why an unverifiable demurrage line is worth disputing." },
  { code: "DET",  label: "Detention",                  cat: "TIME",     kind: "DISBURSEMENT", basis: "PER_DAY",       prov: "PASS_THROUGH",         tax: true,  err: "HIGH",   aliases: ["DETENTION","PER DIEM","EQUIPMENT DETENTION"], note: "Container outside the terminal beyond free time. Runs gate-out to empty return, and is routinely billed over the same days as demurrage." },
  { code: "INS",  label: "Cargo insurance",            cat: "INS",      kind: "DISBURSEMENT", basis: "PERCENTAGE",    prov: "PASS_THROUGH",         tax: false, err: "LOW",    aliases: ["INSURANCE","MARINE INSURANCE","ALL RISKS"] },
  { code: "PLF",  label: "Platform fee",               cat: "PLATFORM", kind: "FEE",          basis: "PERCENTAGE",    prov: "FORWARDER_ORIGINATED", tax: true,  err: "LOW",    aliases: ["PLATFORM_FEE","PLATFORM FEE","NETWORK FEE"] },
  { code: "MSC",  label: "Other charge",               cat: "OTHER",    kind: "FEE",          basis: "PER_SHIPMENT",  prov: "FORWARDER_ORIGINATED", tax: true,  err: "MEDIUM", aliases: ["MISC","SUNDRY","OTHER"], note: "The bucket. A line that lands here has not been normalised, and an invoice with material spend in MSC is an invoice nobody can analyse." },
];

const CODE = Object.fromEntries(CHARGE_CODES.map((c) => [c.code, c]));

const CAT_ORDER = ["ORIGIN","FREIGHT","FUEL","DEST","CUSTOMS","DUTY","DOCS","TIME","INS","PLATFORM","OTHER"];
const CAT_LABEL = {
  ORIGIN: "Origin charges", FREIGHT: "Main carriage", FUEL: "Fuel & currency surcharges",
  DEST: "Destination & port charges", CUSTOMS: "Customs clearance", DUTY: "Duties & taxes",
  DOCS: "Documentation", TIME: "Demurrage & detention", INS: "Insurance",
  PLATFORM: "Platform fees", OTHER: "Other charges",
};
const PROV_LABEL = { PASS_THROUGH: "At cost", MARKED_UP: "Third party", FORWARDER_ORIGINATED: "Our service" };
const PROV_TAG = { PASS_THROUGH: "", MARKED_UP: "accent", FORWARDER_ORIGINATED: "rails" };
const BASIS_LABEL = {
  PER_SHIPMENT: "shipment", PER_CONTAINER: "container", PER_KG: "kg",
  PER_CBM: "m³", PER_DOCUMENT: "document", PER_DAY: "day", PERCENTAGE: "%",
};

/* "per %" is not a basis anybody says out loud. A percentage line is computed
   on the freight, not multiplied by a unit, so it gets its own phrasing. */
const basisPhrase = (b) => (b === "PERCENTAGE" ? "% of freight" : `per ${BASIS_LABEL[b] || b}`);

const normKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ALIAS_INDEX = (() => {
  const m = new Map();
  for (const d of CHARGE_CODES) {
    for (const a of [d.code, d.label, ...d.aliases]) {
      const k = normKey(a);
      if (!m.has(k)) m.set(k, d.code);
    }
  }
  return m;
})();

/* Never throws, never returns null. An unrecognised code resolves to MSC —
   dropping the line loses money and refusing the invoice stops the forwarder
   billing at all. The fallback is visible so somebody maps it. */
function normaliseCode(raw, tenantAliases) {
  const k = normKey(raw);
  const t = tenantAliases && tenantAliases.get(k);
  if (t && CODE[t]) return { code: t, def: CODE[t], match: k === normKey(t) ? "exact" : "alias" };
  if (CODE[k]) return { code: k, def: CODE[k], match: "exact" };
  const a = ALIAS_INDEX.get(k);
  if (a) return { code: a, def: CODE[a], match: "alias" };
  return { code: "MSC", def: CODE.MSC, match: "fallback" };
}

/* --------------------------------------------------------------- duty ---- */

/* SARS: duty on the customs value, then VAT on the ATV — customs value plus
   duty plus a 10% upliftment on non-SACU imports. The upliftment is the part
   people get wrong, and it moves the VAT base on every line. */
const VAT_BPS = 1500;
const ATV_UPLIFT_BPS = 1000;

function dutyForLine(line) {
  const duty = roundHalfUp(line.customsValueCents * (line.dutyRateBps || 0) / 10000);
  const uplift = line.sacuOrigin ? 0 : roundHalfUp(line.customsValueCents * ATV_UPLIFT_BPS / 10000);
  const atv = line.customsValueCents + duty + uplift;
  const vat = roundHalfUp(atv * VAT_BPS / 10000);
  return { duty, uplift, atv, vat, total: duty + vat };
}
function entryTotals(entry) {
  return (entry.lines || []).reduce((acc, l) => {
    const d = dutyForLine(l);
    acc.customsValue += l.customsValueCents;
    acc.duty += d.duty; acc.vat += d.vat; acc.atv += d.atv; acc.total += d.total;
    return acc;
  }, { customsValue: 0, duty: 0, vat: 0, atv: 0, total: 0 });
}

/* ------------------------------------------------------------- invoice --- */

/* VAT per line rather than on the subtotal: it is what the line shows, and a
   total that does not equal the sum of its visible parts is the first thing an
   AP clerk queries. Half-up on the absolute value so a credit note rounds
   symmetrically — Math.round(-0.5) is -0, which would leave a full credit note
   one cent short of the invoice it reverses. */
function lineVat(sellCents, vatBps) {
  const mag = roundHalfUp(Math.abs(sellCents) * vatBps / 10000);
  return sellCents < 0 ? -mag : mag;
}

function buildDocument(inv, lines, opts = {}) {
  const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
  const priced = lines.map((l) => {
    const sell = sign * l.sellCents;
    const buy = l.buyCents == null || !opts.commercial ? null : sign * l.buyCents;
    return { ...l, sellCents: sell, buyCents: buy,
      unitSellCents: l.unitSellCents == null ? null : sign * l.unitSellCents,
      vatCents: lineVat(sell, l.vatBps),
      marginCents: buy == null ? null : sell - buy };
  });

  const sections = CAT_ORDER
    .map((cat) => ({ cat, label: CAT_LABEL[cat], lines: priced.filter((l) => l.cat === cat) }))
    .filter((s) => s.lines.length)
    .map((s) => ({ ...s,
      sub: s.lines.reduce((a, l) => a + l.sellCents, 0),
      vat: s.lines.reduce((a, l) => a + l.vatCents, 0) }));

  const sub = priced.reduce((a, l) => a + l.sellCents, 0);
  const vat = priced.reduce((a, l) => a + l.vatCents, 0);
  const by = (p) => priced.filter((l) => l.prov === p).reduce((a, l) => a + l.sellCents, 0);
  const withBuy = priced.filter((l) => l.buyCents != null);
  const buy = withBuy.reduce((a, l) => a + l.buyCents, 0);
  const sellOnBuy = withBuy.reduce((a, l) => a + l.sellCents, 0);

  return {
    sections, lines: priced,
    totals: {
      sub, vat, total: sub + vat,
      passThrough: by("PASS_THROUGH"), markedUp: by("MARKED_UP"), own: by("FORWARDER_ORIGINATED"),
      disputed: priced.filter((l) => l.disputed).reduce((a, l) => a + l.sellCents + l.vatCents, 0),
    },
    margin: {
      buy, sell: sellOnBuy, marginCents: sellOnBuy - buy,
      marginBps: sellOnBuy === 0 ? 0 : Math.round(((sellOnBuy - buy) / Math.abs(sellOnBuy)) * 10000),
      linesWithoutBuy: priced.length - withBuy.length,
    },
    currencies: [...new Set(lines.map((l) => l.currency))].sort(),
  };
}

const DOC_NOTICE =
  "This is a freight forwarder's invoice for transport and related services. " +
  "It is not a commercial invoice and does not state the value of the goods; " +
  "it is not a bill of lading and confers no title to the cargo.";

/* --------------------------------------------------------------- audit --- */

/* The four-way match. Most AP teams run two-way — invoice against quote total
   — which catches almost nothing, because the discrepancies live inside lines
   nobody quoted. Every line is checked against the contract the customer
   accepted, the vendor cost or a published benchmark, the shipment's own
   facts, and the service event record.
   Where a source is missing the rule does not silently pass: it says so. */
const EVIDENCE_FOR = {
  DEL: { events: ["container.gated_out", "pod.confirmed"], what: "delivery from the destination terminal" },
  PCK: { events: ["container.gated_in", "shipment.booked"], what: "collection from the shipper" },
  CCL: { events: ["entry.submitted", "entry.released"], what: "a customs entry" },
  DEM: { events: ["container.discharged"], what: "discharge, from which demurrage runs" },
  DET: { events: ["container.gated_out"], what: "gate-out, from which detention runs" },
  THC: { events: ["container.discharged", "vessel.arrived"], what: "arrival at the destination terminal" },
};

const SEV_RANK = { CRITICAL: 0, WARN: 1, INFO: 2 };

function auditInvoice(ctx) {
  const {
    lines, facts, contract, fuelBenchmark, issuerVatRegistered,
    statedSub, statedVat, statedTotal, currency,
    toleranceBps = 500, materialityCents = 5000,
  } = ctx;
  const f = [];
  const add = (o) => f.push(o);
  const byCode = new Map((contract || []).map((c) => [c.code, c]));

  for (const l of lines) {
    const def = CODE[l.code] || CODE.MSC;

    if (l.match === "fallback") add({
      sev: Math.abs(l.sellCents) >= materialityCents ? "WARN" : "INFO",
      code: "UNMAPPED_CHARGE_CODE", chargeId: l.id, variance: null, src: [],
      msg: `"${l.description}" did not match any known charge code and was filed under Other. Map it so this spend can be compared across vendors.`,
    });

    if (l.currency !== currency) add({
      sev: "CRITICAL", code: "CURRENCY_MISMATCH", chargeId: l.id, variance: null, src: ["SHIPMENT_DATA"],
      msg: `Line is in ${l.currency} on a ${currency} invoice. The totals on this document are not meaningful until it is converted or moved to its own invoice.`,
    });

    if (l.unitSellCents != null && l.unitSellCents * l.qty !== l.sellCents) add({
      sev: "WARN", code: "LINE_ARITHMETIC", chargeId: l.id, src: ["SHIPMENT_DATA"],
      variance: l.sellCents - l.unitSellCents * l.qty,
      msg: `${l.qty} × ${money(l.unitSellCents, currency)} does not equal the line total ${money(l.sellCents, currency)}.`,
    });

    if (l.prov === "PASS_THROUGH" && l.buyCents != null && l.sellCents > l.buyCents) add({
      sev: "CRITICAL", code: "MARGIN_ON_PASS_THROUGH", chargeId: l.id, src: ["VENDOR_COST"],
      variance: l.sellCents - l.buyCents,
      msg: `${l.description} is billed as a pass-through disbursement but carries ${money(l.sellCents - l.buyCents, currency)} above the recorded cost. Either the margin is wrong or the line should be marked up rather than disbursed.`,
    });

    if (!def.tax && l.vatBps > 0) add({
      sev: "CRITICAL", code: "VAT_ON_DISBURSEMENT", chargeId: l.id, src: ["CONTRACT"],
      variance: lineVat(l.sellCents, l.vatBps),
      msg: `${def.label} is outside the scope of VAT but is charged at ${pct(l.vatBps)}. This overstates both the invoice and the issuer's output tax.`,
    });
    if (def.tax && l.vatBps === 0 && issuerVatRegistered) add({
      sev: "WARN", code: "MISSING_VAT", chargeId: l.id, variance: null, src: ["CONTRACT"],
      msg: `${def.label} is a taxable supply but carries no VAT. If that is deliberate — an exported service, say — record why.`,
    });

    if (l.basis === "PER_CONTAINER" && facts.containers > 0 && l.qty !== facts.containers) add({
      sev: "WARN", code: "QUANTITY_VS_CONTAINERS", chargeId: l.id, src: ["SHIPMENT_DATA"],
      variance: l.unitSellCents == null ? null : l.sellCents - l.unitSellCents * facts.containers,
      msg: `${l.description} is charged per container at quantity ${l.qty}, but this shipment moves ${facts.containers} container(s).`,
    });
    if (l.basis === "PER_DOCUMENT" && facts.documents > 0 && l.qty > facts.documents) add({
      sev: "WARN", code: "QUANTITY_VS_DOCUMENTS", chargeId: l.id, src: ["SHIPMENT_DATA"],
      variance: l.unitSellCents == null ? null : l.unitSellCents * (l.qty - facts.documents),
      msg: `${l.description} is charged for ${l.qty} document(s); this shipment has ${facts.documents}. Documentation fees are per bill of lading, not per container.`,
    });

    const c = byCode.get(l.code);
    if (c && l.unitSellCents != null) {
      if (c.currency !== l.currency) {
        add({ sev: "WARN", code: "CONTRACT_CURRENCY_MISMATCH", chargeId: l.id, variance: null, src: ["CONTRACT"],
          msg: `Contracted in ${c.currency}, billed in ${l.currency}. The rate cannot be compared without a stated conversion.` });
      } else {
        const drift = c.unitCents === 0 ? 10000 : Math.round(((l.unitSellCents - c.unitCents) / Math.abs(c.unitCents)) * 10000);
        if (Math.abs(drift) > toleranceBps) {
          const variance = (l.unitSellCents - c.unitCents) * l.qty;
          add({ sev: drift > 0 && Math.abs(variance) >= materialityCents ? "CRITICAL" : "WARN",
            code: "CONTRACT_RATE_VARIANCE", chargeId: l.id, variance, src: ["CONTRACT"],
            msg: `${l.description} is billed at ${money(l.unitSellCents, currency)} per unit against a contracted ${money(c.unitCents, currency)} (${(drift / 100).toFixed(1)}%). Source: ${c.source}.` });
        }
      }
    } else if (l.prov !== "FORWARDER_ORIGINATED" && !l.contractRef && !l.vendorInvoiceRef
               && Math.abs(l.sellCents) >= materialityCents) {
      /* The finding a two-way match can never produce: not that the number is
         wrong, but that nothing exists to check it against. */
      add({ sev: "WARN", code: "NO_MATCH_REFERENCE", chargeId: l.id, variance: null, src: [],
        msg: `${l.description} carries a third-party cost but references neither a contract nor a vendor invoice. There is nothing to match it against.` });
    }

    const ev = EVIDENCE_FOR[l.code];
    if (ev && facts.events.length && !ev.events.some((e) => facts.events.includes(e))) add({
      sev: "CRITICAL", code: "SERVICE_NOT_EVIDENCED", chargeId: l.id, src: ["SERVICE_EVENTS"],
      variance: l.sellCents,
      msg: `${l.description} bills for ${ev.what}, but no such event has been recorded on this shipment.`,
    });
  }

  const fuelLines = lines.filter((l) => l.cat === "FUEL");
  if (fuelLines.length) {
    if (!fuelBenchmark) {
      add({ sev: "WARN", code: "FUEL_BENCHMARK_UNAVAILABLE", chargeId: null, variance: null, src: [],
        msg: `${money(fuelLines.reduce((a, l) => a + l.sellCents, 0), currency)} of fuel surcharge could not be validated: no fuel index is configured. Bunker and jet-fuel indices are licensed external feeds — set FUEL_INDEX_URL to enable this check.` });
    } else {
      for (const l of fuelLines) {
        if (l.unitSellCents == null || l.currency !== fuelBenchmark.currency) continue;
        const drift = Math.round(((l.unitSellCents - fuelBenchmark.unitCents) / Math.abs(fuelBenchmark.unitCents)) * 10000);
        if (Math.abs(drift) > toleranceBps) add({
          sev: drift > 0 ? "CRITICAL" : "WARN", code: "FUEL_INDEX_VARIANCE", chargeId: l.id, src: ["VENDOR_COST"],
          variance: (l.unitSellCents - fuelBenchmark.unitCents) * l.qty,
          msg: `${l.description} is billed at ${money(l.unitSellCents, currency)} per unit; ${fuelBenchmark.index} at ${fuelBenchmark.quotedFor} implies ${money(fuelBenchmark.unitCents, currency)} (${(drift / 100).toFixed(1)}%).`,
        });
      }
    }
  }

  const dem = lines.filter((l) => l.code === "DEM");
  const det = lines.filter((l) => l.code === "DET");
  if (dem.length) {
    if (!facts.dischargedAt || !facts.gateOutAt || facts.freeTimeDays == null) {
      add({ sev: "WARN", code: "DEMURRAGE_UNVERIFIABLE", chargeId: dem[0].id, variance: null, src: [],
        msg: "Demurrage is billed but cannot be recomputed: it needs the discharge and gate-out timestamps from the terminal and the free-time allowance from the bill of lading. Terminal gate events are an external feed — set TERMINAL_EVENTS_URL." });
    } else {
      const dwell = Math.max(0, Math.ceil((new Date(facts.gateOutAt) - new Date(facts.dischargedAt)) / 86400000));
      const chargeable = Math.max(0, dwell - facts.freeTimeDays);
      const billed = dem.reduce((a, l) => a + l.qty, 0);
      if (billed !== chargeable) add({
        sev: billed > chargeable ? "CRITICAL" : "WARN", code: "DEMURRAGE_DAYS_VARIANCE",
        chargeId: dem[0].id, src: ["SHIPMENT_DATA", "SERVICE_EVENTS"],
        variance: dem[0].unitSellCents == null ? null : dem[0].unitSellCents * (billed - chargeable),
        msg: `${billed} demurrage day(s) billed. The container dwelt ${dwell} day(s) against ${facts.freeTimeDays} free, so ${chargeable} are chargeable.`,
      });
    }
  }
  if (dem.length && det.length && facts.dischargedAt && facts.emptyReturnedAt) {
    const total = Math.max(0, Math.ceil((new Date(facts.emptyReturnedAt) - new Date(facts.dischargedAt)) / 86400000));
    const billed = dem.reduce((a, l) => a + l.qty, 0) + det.reduce((a, l) => a + l.qty, 0);
    if (billed > total) add({
      sev: "CRITICAL", code: "DEMURRAGE_DETENTION_OVERLAP", chargeId: det[0].id, variance: null, src: ["SERVICE_EVENTS"],
      msg: `Demurrage and detention together bill ${billed} day(s), but only ${total} elapsed between discharge and empty return. The two windows abut at gate-out and cannot overlap.`,
    });
  }

  const seen = new Map();
  for (const l of lines) {
    const key = `${l.code}|${l.vendorName || ""}|${l.sellCents}|${l.qty}`;
    if (seen.has(key)) {
      add({ sev: Math.abs(l.sellCents) >= materialityCents ? "WARN" : "INFO",
        code: "DUPLICATE_LINE", chargeId: l.id, variance: l.sellCents, src: ["SHIPMENT_DATA"],
        msg: `${l.description} appears twice at the same amount and quantity. Confirm this is two chargeable events and not one billed twice.` });
    } else seen.set(key, l);
  }

  const computed = lines.reduce((a, l) => a + l.sellCents, 0);
  if (computed !== statedSub) add({
    sev: "CRITICAL", code: "SUBTOTAL_MISMATCH", chargeId: null, src: ["SHIPMENT_DATA"],
    variance: statedSub - computed,
    msg: `The lines sum to ${money(computed, currency)} but the invoice states a subtotal of ${money(statedSub, currency)}.`,
  });
  if (statedSub + statedVat !== statedTotal) add({
    sev: "CRITICAL", code: "TOTAL_MISMATCH", chargeId: null, src: [],
    variance: statedTotal - (statedSub + statedVat),
    msg: `Subtotal plus VAT does not equal the stated total.`,
  });

  const depth = {
    CONTRACT: (contract || []).length > 0,
    VENDOR_COST: lines.some((l) => l.buyCents != null) || !!fuelBenchmark,
    SHIPMENT_DATA: facts.containers > 0 || facts.documents > 0,
    SERVICE_EVENTS: facts.events.length > 0,
  };

  f.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]
    || Math.abs(b.variance || 0) - Math.abs(a.variance || 0)
    || a.code.localeCompare(b.code));

  return {
    findings: f,
    summary: {
      linesChecked: lines.length,
      findings: f.length,
      critical: f.filter((x) => x.sev === "CRITICAL").length,
      netVariance: f.reduce((a, x) => a + (x.variance || 0), 0),
      depth, matched: Object.values(depth).filter(Boolean).length,
    },
  };
}

/* Plain text on purpose: this gets pasted into an email, and the recipient is
   a person with an invoice in front of them, not a system. Assembled the
   moment the exception is raised, because a dispute filed after the window
   closes is a write-off however good the evidence. */
function disputePacket(o) {
  const claims = o.findings.filter((x) => x.sev !== "INFO" && (x.variance || 0) > 0);
  const total = claims.reduce((a, x) => a + x.variance, 0);
  const L = [
    `Query on invoice ${o.number}`,
    o.shipmentRef ? `Shipment: ${o.shipmentRef}` : null,
    o.blNumber ? `Transport document: ${o.blNumber}` : null,
    `Raised by: ${o.issuer}`,
    `Date: ${new Date(o.now).toISOString().slice(0, 10)}`,
    o.windowDays != null ? `Dispute window: ${o.windowDays} day(s) remaining` : null,
    "",
  ].filter((x) => x !== null);

  if (claims.length) {
    L.push(`The following ${claims.length} item(s) on this invoice are queried, totalling ${money(total, o.currency)}:`, "");
    claims.forEach((x, i) => {
      const line = x.chargeId ? o.lineById.get(x.chargeId) : null;
      L.push(`${i + 1}. ${line ? `${line.code} — ${line.description}` : "Invoice level"}`);
      if (line) L.push(`   Billed: ${money(line.sellCents, o.currency)}`);
      L.push(`   Queried: ${money(x.variance, o.currency)}`);
      L.push(`   Reason: ${x.msg}`);
      L.push(`   Reference: ${x.code}`);
      L.push("");
    });
  } else L.push("No quantified overcharges were identified on this invoice.", "");

  L.push(
    "Please provide the underlying tariff, index publication or terminal record supporting the",
    "charges above, or issue a credit note for the queried amounts.",
    "",
    "This query is raised before payment and within the dispute window. Payment of the undisputed",
    "balance is not withheld.",
  );
  return { body: L.join("\n"), claimedCents: total, count: claims.length };
}

/* ------------------------------------------------------- integrations --- */

/* "API-ready" is an unverifiable claim unless somebody can see it. Each entry
   states what breaks without it — never "the platform stops" — and the
   accreditation, which is the work no amount of code substitutes for. */
const INTEGRATIONS = [
  { key: "sars_edi", name: "SARS Customs EDI", domain: "Customs", live: false, prod: false,
    provider: "South African Revenue Service",
    keys: ["SARS_EDI_URL", "SARS_CLIENT_NUMBER", "SARS_CLIENT_CERT_PATH", "SARS_CLIENT_KEY_PATH"],
    why: "Lodge customs declarations (CUSDEC) with SARS and receive responses, releases and stops (CUSRES) on the same channel.",
    accred: "The operating company must be registered with SARS as an importer, exporter or clearing agent and hold a customs client number (CCN); it must then apply for an EDI user profile and be issued a client certificate for the gateway. A paper process measured in weeks — no code path shortens it.",
    degrade: "Declarations are still built, validated against the tariff book and stored with a full audit trail. They stop at QUEUED and export for manual capture on eFiling." },
  { key: "sars_efiling", name: "SARS eFiling", domain: "Compliance", live: false, prod: false,
    provider: "South African Revenue Service", keys: ["SARS_EFILING_URL"],
    why: "Submit VAT201 returns and read deferment account statements, so output VAT on freight invoices and import VAT recovered as a disbursement reconcile against what was actually declared.",
    accred: "An eFiling profile for the operating company, with the ISV access SARS grants registered software providers.",
    degrade: "VAT positions are computed and reported in the console for manual capture." },
  { key: "fuel_index", name: "Bunker / jet fuel index", domain: "Billing audit", live: false, prod: false,
    provider: "Platts or Argus (bunker), IATA (jet fuel), or carrier tariff",
    keys: ["FUEL_INDEX_URL", "FUEL_INDEX_API_KEY"],
    why: "Validate BAF, EBS and CAF lines against the published index they claim to track. Fuel is the highest-error category on a forwarder invoice precisely because nobody checks it.",
    accred: "A commercial data licence. Platts and Argus price assessments are redistributable only under subscription; carrier-published tariffs are free but per-carrier.",
    degrade: "Fuel surcharge lines are reported as unvalidated on the audit, with the total left unchecked stated explicitly rather than passed over." },
  { key: "terminal", name: "Terminal gate events", domain: "Billing audit", live: false, prod: false,
    provider: "Terminal operating system (Navis N4) or carrier track & trace",
    keys: ["TERMINAL_EVENTS_URL", "TERMINAL_EVENTS_API_KEY"],
    why: "Gate-in, gate-out and empty-return timestamps, so demurrage and detention can be recomputed from free time instead of taken on trust.",
    accred: "Per-terminal or per-carrier data agreement. Most terminals expose this only to registered hauliers and agents.",
    degrade: "Demurrage lines are flagged unverifiable on the audit rather than silently accepted." },
  { key: "yente", name: "Denied-party screening", domain: "Screening", live: true, prod: true,
    provider: "yente / OpenSanctions", keys: ["YENTE_URL"],
    why: "Screen every party against consolidated sanctions and watchlists at creation and again at booking.",
    accred: null, degrade: "Parties are recorded UNSCREENED and no compliance hold is raised." },
  { key: "tracking", name: "Carrier track & trace", domain: "Visibility", live: true, prod: true,
    provider: "Carrier APIs / EDI VANs", keys: ["INGEST_API_KEY"],
    why: "Milestone events from carriers and hauliers over DCSA, EDIFACT IFTSTA and Traccar. All three adapters are built.",
    accred: "Per-carrier API credentials, obtained through each carrier's developer programme.",
    degrade: "Milestones are recorded manually from the ops screen." },
  { key: "ais", name: "AIS vessel positions", domain: "Visibility", live: true, prod: false,
    provider: "aisstream.io", keys: ["AISSTREAM_API_KEY"],
    why: "Live vessel position reports for shipments on the water.",
    accred: null, degrade: "The map shows carrier-reported milestones only, with no position between them." },
  { key: "extraction", name: "Document extraction", domain: "Documents", live: true, prod: false,
    provider: "Anthropic", keys: ["ANTHROPIC_API_KEY"],
    why: "Read commercial invoices, packing lists and bills of lading into structured fields, with anything below the confidence threshold queued for a human.",
    accred: null, degrade: "Every uploaded document goes to the manual review queue." },
  { key: "novu", name: "Customer notifications", domain: "Notifications", live: false, prod: false,
    provider: "Novu", keys: ["NOVU_API_KEY"],
    why: "Milestone notifications to shippers over WhatsApp and email.",
    accred: "WhatsApp Business sender approval through Meta if that channel is used; email needs none.",
    degrade: "Milestones are logged and visible in the portal; nothing is pushed." },
  { key: "identity", name: "Identity provider", domain: "Identity", live: true, prod: true,
    provider: "Keycloak", keys: ["AUTH_ISSUER"],
    why: "OIDC sign-in, tenant organisations and realm roles.",
    accred: null, degrade: "Development header auth, which production config refuses to start with." },
  { key: "kafka", name: "Event stream", domain: "Messaging", live: true, prod: true,
    provider: "Redpanda / Kafka", keys: ["KAFKA_BROKERS"],
    why: "Mirror the event log to Redpanda for downstream consumers.",
    accred: null, degrade: "Events accumulate in the transactional outbox and are never relayed." },
];
