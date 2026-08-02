/**
 * The canonical charge-code taxonomy.
 *
 * A freight forwarder's invoice is a consolidated document: the carrier, the
 * origin agent, the terminal, the customs broker and the forwarder itself each
 * contribute lines, and each writes the same charge under a different name.
 * "OHC", "Origin Handling", "ORIG HANDLING CHG" and a bundled "Origin
 * Services" are one charge with four spellings. Until they collapse onto one
 * code you cannot compare two vendors, match a line to a contract, or say what
 * a lane costs.
 *
 * So: one code list, owned here, with the vendor dialects folded into it.
 * Everything downstream — the invoice document, the audit rules, spend
 * analytics — keys off `CanonicalCode` and never off free text.
 *
 * `errorRate` is not decoration. Published audits of forwarder invoicing put
 * roughly 80% of invoices carrying at least one discrepancy and overcharges
 * averaging 8–10%, concentrated in a few categories: fuel surcharges,
 * destination terminal handling and documentation fees. Those are the lines AP
 * scrutinises least and the forwarder has the most discretion over. Marking
 * them here is what lets the audit spend its attention where the money is.
 *
 * Pure module: no framework, no database, no clock.
 */

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

export type ChargeKind = "FREIGHT" | "SURCHARGE" | "DISBURSEMENT" | "FEE";

export type ChargeProvenance = "PASS_THROUGH" | "MARKED_UP" | "FORWARDER_ORIGINATED";

export type ChargeBasis =
  | "PER_SHIPMENT"
  | "PER_CONTAINER"
  | "PER_KG"
  | "PER_CBM"
  | "PER_DOCUMENT"
  | "PER_DAY"
  | "PERCENTAGE";

/** How much scrutiny the audit should give a line of this code. */
export type ErrorRate = "LOW" | "MEDIUM" | "HIGH";

export interface ChargeCodeDef {
  code: string;
  label: string;
  category: ChargeCategory;
  kind: ChargeKind;
  basis: ChargeBasis;
  /** What a line of this code is normally billed as, absent a contract saying otherwise. */
  typicalProvenance: ChargeProvenance;
  /**
   * Whether VAT normally applies. A true disbursement — money the forwarder
   * paid an authority on the customer's behalf and recovers at cost — is
   * outside the scope of VAT in most jurisdictions, and charging VAT on it is
   * both an overcharge and a filing error.
   */
  taxable: boolean;
  errorRate: ErrorRate;
  /** Why this code exists and what goes wrong with it. Shown in the console. */
  note?: string;
  /** Vendor spellings that collapse onto this code. Upper case, no punctuation. */
  aliases: string[];
}

/**
 * The list.
 *
 * Codes follow the widely-used three-to-four letter forwarding conventions
 * where one exists (OHC, THC, BAF, CAF, ISPS, DOC) so an operator reading a
 * carrier invoice recognises them without a lookup.
 */
export const CHARGE_CODES: readonly ChargeCodeDef[] = [
  // -- Origin ---------------------------------------------------------------
  {
    code: "PCK",
    label: "Pick-up / pre-carriage",
    category: "ORIGIN",
    kind: "FREIGHT",
    basis: "PER_SHIPMENT",
    typicalProvenance: "MARKED_UP",
    taxable: true,
    errorRate: "MEDIUM",
    note: "Collection from the shipper's door to the port of exit. Distinct from the freight leg — a shipment delivered to the port by the shipper should not carry this at all.",
    aliases: ["PICKUP", "PICK UP", "PRECARRIAGE", "PRE CARRIAGE", "COLLECTION", "CARTAGE IN", "INLAND ORIGIN"],
  },
  {
    code: "OHC",
    label: "Origin terminal handling",
    category: "ORIGIN",
    kind: "SURCHARGE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["OTHC", "ORIGIN HANDLING", "ORIGIN THC", "ORIG HANDLING CHG", "ORIGIN TERMINAL HANDLING", "OHC ORIGIN"],
  },
  {
    code: "EXW",
    label: "Export customs clearance",
    category: "ORIGIN",
    kind: "FEE",
    basis: "PER_SHIPMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "LOW",
    aliases: ["EXPORT CLEARANCE", "EXPORT CUSTOMS", "EXPORT ENTRY", "SAD500 EXPORT"],
  },
  {
    code: "VGM",
    label: "Verified gross mass",
    category: "ORIGIN",
    kind: "FEE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "LOW",
    note: "SOLAS-mandated weighing. One per container, never per shipment — a multi-container booking billed one VGM is undercharged and a single container billed two is not.",
    aliases: ["VERIFIED GROSS MASS", "SOLAS VGM", "WEIGHING"],
  },

  // -- Main carriage --------------------------------------------------------
  {
    code: "FRT",
    label: "Ocean / air freight",
    category: "FREIGHT",
    kind: "FREIGHT",
    basis: "PER_CONTAINER",
    typicalProvenance: "MARKED_UP",
    taxable: true,
    errorRate: "LOW",
    note: "The base rate. Usually the most scrutinised line and therefore the least likely to be wrong.",
    aliases: ["OCEAN FREIGHT", "AIR FREIGHT", "SEA FREIGHT", "BASIC FREIGHT", "FREIGHT", "BAS", "OFR", "AFR"],
  },
  {
    code: "HND",
    label: "Cargo handling uplift",
    category: "FREIGHT",
    kind: "SURCHARGE",
    basis: "PER_SHIPMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "LOW",
    note: "The premium a cargo type carries: reefer power, DG segregation, out-of-gauge stowage.",
    aliases: ["HANDLING UPLIFT", "SPECIAL CARGO", "DG SURCHARGE", "REEFER SURCHARGE"],
  },
  {
    code: "SVC",
    label: "Service level",
    category: "FREIGHT",
    kind: "SURCHARGE",
    basis: "PER_SHIPMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "LOW",
    aliases: ["EXPRESS SURCHARGE", "PRIORITY", "SERVICE LEVEL"],
  },

  // -- Fuel and currency ----------------------------------------------------
  {
    code: "BAF",
    label: "Bunker adjustment factor",
    category: "FUEL_SURCHARGE",
    kind: "SURCHARGE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "Should track a published bunker index at the contracted formula. In practice it is applied at whatever the last quarter's level was, long after the index moved. Highest-value audit target on the whole invoice.",
    aliases: ["BUNKER", "BUNKER ADJUSTMENT", "FUEL SURCHARGE", "FAF", "LSS", "LOW SULPHUR", "IMO2020", "BAF/CAF"],
  },
  {
    code: "EBS",
    label: "Emergency bunker surcharge",
    category: "FUEL_SURCHARGE",
    kind: "SURCHARGE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "By definition temporary. An EBS still on an invoice a year after it was announced is almost always a line nobody removed.",
    aliases: ["EMERGENCY BUNKER", "EBAF", "EFS", "EMERGENCY FUEL"],
  },
  {
    code: "CAF",
    label: "Currency adjustment factor",
    category: "FUEL_SURCHARGE",
    kind: "SURCHARGE",
    basis: "PERCENTAGE",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "A percentage of freight covering FX movement between the tariff currency and the billing currency. Wrong whenever the freight base it is computed on is wrong, so it compounds other errors.",
    aliases: ["CURRENCY ADJUSTMENT", "CURRENCY SURCHARGE", "FX SURCHARGE"],
  },

  // -- Destination ----------------------------------------------------------
  {
    code: "THC",
    label: "Destination terminal handling",
    category: "DESTINATION",
    kind: "SURCHARGE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "Set by the terminal, billed per container, and one of the three lines most often wrong: charged at the origin tariff, charged per shipment instead of per container, or charged twice when an agent also bills it.",
    aliases: [
      "DTHC",
      "THC-D",
      "DESTINATION HANDLING",
      "TERMINAL HANDLING",
      "DEST THC",
      "TERMINAL HANDLING CHARGE",
    ],
  },
  {
    code: "ISPS",
    label: "Port security (ISPS)",
    category: "DESTINATION",
    kind: "SURCHARGE",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["ISPS SECURITY", "SECURITY SURCHARGE", "PORT SECURITY", "CSC"],
  },
  {
    code: "WHF",
    label: "Wharfage / port dues",
    category: "DESTINATION",
    kind: "DISBURSEMENT",
    basis: "PER_CONTAINER",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["WHARFAGE", "PORT DUES", "HARBOUR DUES", "QUAY RENT"],
  },
  {
    code: "DEL",
    label: "Delivery / on-carriage",
    category: "DESTINATION",
    kind: "FREIGHT",
    basis: "PER_CONTAINER",
    typicalProvenance: "MARKED_UP",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["DELIVERY", "ONCARRIAGE", "ON CARRIAGE", "CARTAGE OUT", "INLAND DESTINATION", "HAULAGE"],
  },
  {
    code: "TOL",
    label: "Road tolls",
    category: "DESTINATION",
    kind: "DISBURSEMENT",
    basis: "PER_SHIPMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "LOW",
    note: "Recovered at cost on road legs. Its own code rather than folded into delivery, so a corridor's toll burden stays visible when the haulage rate is renegotiated.",
    aliases: ["TOLL", "TOLLS", "TOLL FEES", "ROAD TOLLS", "GANTRY FEES"],
  },

  // -- Customs and statutory ------------------------------------------------
  {
    code: "CCL",
    label: "Customs clearance",
    category: "CUSTOMS",
    kind: "FEE",
    basis: "PER_SHIPMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "MEDIUM",
    note: "The broker's fee for lodging the entry. The fee is the forwarder's; the duty is not.",
    aliases: ["CLEARANCE", "CUSTOMS CLEARANCE", "BROKERAGE", "ENTRY FEE", "CUSTOMS ENTRY"],
  },
  {
    code: "DTY",
    label: "Customs duty",
    category: "DUTY_TAX",
    kind: "DISBURSEMENT",
    basis: "PER_SHIPMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: false,
    errorRate: "LOW",
    note: "Paid to the authority on the customer's behalf and recovered at cost. Outside the scope of VAT, and a margin on it is not a markup but a misdeclaration.",
    aliases: ["DUTY", "IMPORT DUTY", "CUSTOMS DUTY", "AD VALOREM"],
  },
  {
    code: "VAT",
    label: "Import VAT",
    category: "DUTY_TAX",
    kind: "DISBURSEMENT",
    basis: "PER_SHIPMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: false,
    errorRate: "LOW",
    note: "VAT levied at import, recovered at cost. Never itself VAT-able.",
    aliases: ["IMPORT VAT", "VAT ON IMPORTS", "INPUT VAT"],
  },
  {
    code: "DSB",
    label: "Disbursement fee",
    category: "CUSTOMS",
    kind: "FEE",
    basis: "PERCENTAGE",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "MEDIUM",
    note: "The forwarder's charge for fronting duty and VAT — normally a percentage of the amount advanced, capped. Uncapped, it is the quietest overcharge on the document.",
    aliases: ["DISBURSEMENT FEE", "CASH OUTLAY", "AGENCY FEE", "ADVANCE FEE"],
  },

  // -- Documentation --------------------------------------------------------
  {
    code: "DOC",
    label: "Documentation fee",
    category: "DOCUMENTATION",
    kind: "FEE",
    basis: "PER_DOCUMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "HIGH",
    note: "Entirely at the forwarder's discretion, small enough that nobody queries it, and therefore the third of the three high-error lines. Charged per bill of lading, not per container.",
    aliases: ["DOCUMENTATION", "DOC FEE", "BL FEE", "B/L FEE", "AWB FEE", "DOCUMENT FEE", "ADMIN FEE"],
  },
  {
    code: "TLX",
    label: "Telex release / express release",
    category: "DOCUMENTATION",
    kind: "FEE",
    basis: "PER_DOCUMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["TELEX RELEASE", "EXPRESS RELEASE", "SURRENDER BL", "SEAWAY BILL"],
  },
  {
    code: "COO",
    label: "Certificate of origin",
    category: "DOCUMENTATION",
    kind: "DISBURSEMENT",
    basis: "PER_DOCUMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "LOW",
    aliases: ["CERTIFICATE OF ORIGIN", "EUR1", "SADC CERTIFICATE", "CHAMBER FEE"],
  },
  {
    code: "AMS",
    label: "Manifest filing (AMS / ENS / ACI)",
    category: "DOCUMENTATION",
    kind: "FEE",
    basis: "PER_DOCUMENT",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["AMS FEE", "ENS", "ACI", "ISF", "MANIFEST FILING", "ADVANCE MANIFEST"],
  },

  // -- Time-based -----------------------------------------------------------
  {
    code: "DEM",
    label: "Demurrage",
    category: "DEMURRAGE_DETENTION",
    kind: "DISBURSEMENT",
    basis: "PER_DAY",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "Container sitting inside the terminal beyond free time. Re-derivable exactly from the free-time allowance on the bill of lading and the terminal's gate timestamps — which is why an unverifiable demurrage line is worth disputing.",
    aliases: ["DEMURRAGE", "STORAGE", "PORT STORAGE", "TERMINAL STORAGE"],
  },
  {
    code: "DET",
    label: "Detention",
    category: "DEMURRAGE_DETENTION",
    kind: "DISBURSEMENT",
    basis: "PER_DAY",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "HIGH",
    note: "Container held outside the terminal beyond free time. Runs from gate-out to empty return, and is routinely billed over the same days as demurrage.",
    aliases: ["DETENTION", "CONTAINER DETENTION", "PER DIEM", "EQUIPMENT DETENTION"],
  },
  {
    code: "WAIT",
    label: "Waiting time / standing",
    category: "DEMURRAGE_DETENTION",
    kind: "DISBURSEMENT",
    basis: "PER_DAY",
    typicalProvenance: "PASS_THROUGH",
    taxable: true,
    errorRate: "MEDIUM",
    aliases: ["WAITING TIME", "STANDING TIME", "TRUCK WAITING", "DEMURRAGE TRUCK"],
  },

  // -- Other ----------------------------------------------------------------
  {
    code: "INS",
    label: "Cargo insurance",
    category: "INSURANCE",
    kind: "DISBURSEMENT",
    basis: "PERCENTAGE",
    typicalProvenance: "PASS_THROUGH",
    taxable: false,
    errorRate: "LOW",
    note: "A percentage of insured value, normally CIF + 10%. Insurance premiums are typically exempt rather than zero-rated; treated as non-taxable here.",
    aliases: ["INSURANCE", "MARINE INSURANCE", "CARGO INSURANCE", "ALL RISKS"],
  },
  {
    code: "PLF",
    label: "Platform fee",
    category: "PLATFORM_FEE",
    kind: "FEE",
    basis: "PERCENTAGE",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "LOW",
    aliases: ["PLATFORM_FEE", "PLATFORM FEE", "NETWORK FEE", "AGENCY COMMISSION"],
  },
  {
    code: "MSC",
    label: "Other charge",
    category: "OTHER",
    kind: "FEE",
    basis: "PER_SHIPMENT",
    typicalProvenance: "FORWARDER_ORIGINATED",
    taxable: true,
    errorRate: "MEDIUM",
    note: "The bucket. A line that lands here has not been normalised, and an invoice with material spend in MSC is an invoice nobody can analyse.",
    aliases: ["MISC", "MISCELLANEOUS", "SUNDRY", "OTHER"],
  },
] as const;

export const CHARGE_CODE_BY_CODE: ReadonlyMap<string, ChargeCodeDef> = new Map(
  CHARGE_CODES.map((c) => [c.code, c]),
);

/**
 * Alias → canonical code, built once.
 *
 * Aliases are normalised the same way lookups are, so "Origin Handling" and
 * "ORIG.HANDLING" both land on OHC. Built at module load and frozen: a lookup
 * table that can be mutated at runtime is a lookup table that will disagree
 * with itself between two replicas.
 */
const ALIAS_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const def of CHARGE_CODES) {
    m.set(normaliseKey(def.code), def.code);
    m.set(normaliseKey(def.label), def.code);
    for (const alias of def.aliases) {
      const key = normaliseKey(alias);
      // First definition wins. A collision means two codes claim one alias,
      // which is a taxonomy bug — surfaced by the unit test rather than
      // silently resolved by whichever entry happened to come last.
      if (!m.has(key)) m.set(key, def.code);
    }
  }
  return m;
})();

/** Upper case, strip everything that is not a letter or digit. */
export function normaliseKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface NormalisedCode {
  code: string;
  def: ChargeCodeDef;
  /** exact = the code itself; alias = a known vendor spelling; fallback = MSC. */
  match: "exact" | "alias" | "fallback";
}

/**
 * Resolve whatever a vendor wrote onto a canonical code.
 *
 * `tenantAliases` is the per-tenant override table: a forwarder's own vendors
 * speak dialects nobody else's do, and those must beat the built-in list
 * rather than compete with it.
 *
 * Never throws and never returns null. An unrecognised code resolves to MSC
 * with `match: "fallback"`, because dropping a line the platform does not
 * recognise loses money, and refusing the invoice because of one odd code
 * stops the forwarder billing at all. The fallback is visible so the console
 * can prompt someone to map it.
 */
export function normaliseChargeCode(
  raw: string,
  tenantAliases: ReadonlyMap<string, string> = new Map(),
): NormalisedCode {
  const key = normaliseKey(raw ?? "");
  const tenantHit = tenantAliases.get(key);
  if (tenantHit && CHARGE_CODE_BY_CODE.has(tenantHit)) {
    return {
      code: tenantHit,
      def: CHARGE_CODE_BY_CODE.get(tenantHit)!,
      match: key === normaliseKey(tenantHit) ? "exact" : "alias",
    };
  }

  const exact = CHARGE_CODE_BY_CODE.get(key);
  if (exact) return { code: exact.code, def: exact, match: "exact" };

  const aliased = ALIAS_INDEX.get(key);
  if (aliased) {
    return { code: aliased, def: CHARGE_CODE_BY_CODE.get(aliased)!, match: "alias" };
  }

  return { code: "MSC", def: CHARGE_CODE_BY_CODE.get("MSC")!, match: "fallback" };
}

/**
 * The taxonomy fields for a charge, derived from its code.
 *
 * Used wherever a charge is created by machinery rather than typed in — the
 * lifecycle accrual engine, the duty disbursement, the platform fee. Without
 * it those rows would land on the column defaults (OTHER / forwarder
 * originated / per shipment), and a line the audit has been told is the
 * forwarder's own service with nothing behind it is a line the audit will
 * pass. The metadata is not decoration; it is what the rules read.
 *
 * `provenance` is overridable because the same code is a pass-through for one
 * forwarder and marked up by the next — the code says what the charge is for,
 * not how this company sells it.
 */
export interface ChargeMetadata {
  chargeCode: string;
  kind: ChargeKind;
  category: ChargeCategory;
  provenance: ChargeProvenance;
  basis: ChargeBasis;
  vatBps: number;
}

export function chargeMetadata(
  rawCode: string,
  opts: {
    /** Standard rate for taxable lines. Non-taxable codes stay at zero. */
    vatBps?: number;
    provenance?: ChargeProvenance;
    tenantAliases?: ReadonlyMap<string, string>;
  } = {},
): ChargeMetadata {
  const { def, code } = normaliseChargeCode(rawCode, opts.tenantAliases);
  return {
    chargeCode: code,
    kind: def.kind,
    category: def.category,
    provenance: opts.provenance ?? def.typicalProvenance,
    basis: def.basis,
    vatBps: def.taxable ? (opts.vatBps ?? 0) : 0,
  };
}

/** Display order for invoice sections — the order the trade reads them in. */
export const CATEGORY_ORDER: readonly ChargeCategory[] = [
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
];

export const CATEGORY_LABEL: Record<ChargeCategory, string> = {
  ORIGIN: "Origin charges",
  FREIGHT: "Main carriage",
  FUEL_SURCHARGE: "Fuel & currency surcharges",
  DESTINATION: "Destination & port charges",
  CUSTOMS: "Customs clearance",
  DUTY_TAX: "Duties & taxes",
  DOCUMENTATION: "Documentation",
  DEMURRAGE_DETENTION: "Demurrage & detention",
  INSURANCE: "Insurance",
  PLATFORM_FEE: "Platform fees",
  OTHER: "Other charges",
};
