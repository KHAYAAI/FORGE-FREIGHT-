import type { AppConfig } from "../../config.js";

/**
 * Every external system this platform talks to, what it is for, and what a
 * company has to do before it will work.
 *
 * This exists because "API-ready" is a claim that is worth nothing unless
 * somebody can see it. Half the value chain a freight forwarder operates in is
 * other people's systems — the revenue authority, the carrier, the terminal,
 * the index publisher, the bank — and several of them cannot be reached with a
 * URL alone: they need an accreditation, a registration number, or a
 * certificate that a person has to go and apply for.
 *
 * So each integration below states three separate things:
 *
 *   - what breaks without it (`degradesTo`), which is never "the platform
 *     stops" — every one of these degrades to a stated, honest partial;
 *   - the configuration it needs, checked at runtime so the console shows real
 *     state rather than a wish;
 *   - the *out-of-band* steps, if any. `accreditation` is the field that
 *     matters: it is the work no amount of code substitutes for.
 *
 * Pure data + a pure evaluator. No network, no database.
 */

export type IntegrationStatus = "CONFIGURED" | "NOT_CONFIGURED" | "PARTIAL";

export interface IntegrationDef {
  key: string;
  name: string;
  /** Which part of the value chain it serves. */
  domain:
    | "Compliance"
    | "Customs"
    | "Visibility"
    | "Billing audit"
    | "Screening"
    | "Documents"
    | "Notifications"
    | "Identity"
    | "Messaging";
  purpose: string;
  provider: string;
  /** Config keys that must all be set for the integration to be live. */
  requires: (keyof AppConfig)[];
  /** Set, but not required — absence downgrades rather than disables. */
  optional?: (keyof AppConfig)[];
  /**
   * Registration or licensing a human must complete first. Null where the
   * integration is a plain API key you can self-serve.
   */
  accreditation: string | null;
  /** What the platform does when it is not configured. Always something. */
  degradesTo: string;
  /** True where production genuinely cannot run without it. */
  requiredForProduction: boolean;
}

export const INTEGRATIONS: readonly IntegrationDef[] = [
  {
    key: "sars_customs_edi",
    name: "SARS Customs EDI",
    domain: "Customs",
    purpose:
      "Lodge customs declarations (CUSDEC) with the South African Revenue Service and receive responses, releases and stops (CUSRES) on the same channel.",
    provider: "South African Revenue Service",
    requires: ["SARS_EDI_URL", "SARS_CLIENT_NUMBER", "SARS_CLIENT_CERT_PATH", "SARS_CLIENT_KEY_PATH"],
    accreditation:
      "The operating company must be registered with SARS as an importer, exporter or clearing agent and hold a customs client number (CCN); it must then apply for an EDI user profile and be issued a client certificate for the gateway. This is a paper process with SARS and takes weeks — no code path shortens it.",
    degradesTo:
      "Declarations are still built, validated against the tariff book and stored with a full audit trail. They stop at QUEUED and are exported for manual capture on eFiling.",
    requiredForProduction: false,
  },
  {
    key: "sars_efiling",
    name: "SARS eFiling",
    domain: "Compliance",
    purpose:
      "Submit VAT201 returns and read deferment account statements, so output VAT on freight invoices and import VAT recovered as a disbursement reconcile against what was actually declared.",
    provider: "South African Revenue Service",
    requires: ["SARS_EFILING_URL"],
    accreditation:
      "An eFiling profile for the operating company, with the ISV/third-party access SARS grants to registered software providers. Individual taxpayers cannot self-serve this.",
    degradesTo:
      "VAT positions are computed and reported in the console for manual capture on eFiling.",
    requiredForProduction: false,
  },
  {
    key: "fuel_index",
    name: "Bunker / jet fuel index",
    domain: "Billing audit",
    purpose:
      "Validate BAF, EBS and CAF lines against the published index they claim to track. Fuel surcharges are the highest-error category on a forwarder invoice precisely because nobody checks them.",
    provider: "Platts or Argus (bunker), IATA (jet fuel), or carrier tariff publication",
    requires: ["FUEL_INDEX_URL"],
    optional: ["FUEL_INDEX_API_KEY"],
    accreditation:
      "A commercial data licence. Platts and Argus price assessments are redistributable only under subscription; carrier-published tariffs are free but per-carrier.",
    degradesTo:
      "Fuel surcharge lines are reported as unvalidated on the audit, with the total left unchecked stated explicitly rather than passed over.",
    requiredForProduction: false,
  },
  {
    key: "terminal_events",
    name: "Terminal gate events",
    domain: "Billing audit",
    purpose:
      "Gate-in, gate-out and empty-return timestamps, so demurrage and detention can be recomputed from free time instead of taken on trust.",
    provider: "Terminal operating system (Navis N4 and similar) or carrier track-and-trace",
    requires: ["TERMINAL_EVENTS_URL"],
    optional: ["TERMINAL_EVENTS_API_KEY"],
    accreditation:
      "Per-terminal or per-carrier data agreement. Most terminals expose this only to registered hauliers and agents.",
    degradesTo:
      "Demurrage lines are flagged unverifiable on the audit rather than silently accepted.",
    requiredForProduction: false,
  },
  {
    key: "sanctions_screening",
    name: "Denied-party screening",
    domain: "Screening",
    purpose:
      "Screen every party against consolidated sanctions and watchlists at creation and again at booking.",
    provider: "yente / OpenSanctions",
    requires: ["YENTE_URL"],
    accreditation: null,
    degradesTo: "Parties are recorded UNSCREENED and no compliance hold is raised.",
    requiredForProduction: true,
  },
  {
    key: "carrier_tracking",
    name: "Carrier track & trace",
    domain: "Visibility",
    purpose: "Milestone events from carriers and hauliers, over DCSA, EDIFACT IFTSTA or Traccar.",
    provider: "Carrier APIs / EDI VANs",
    requires: ["INGEST_API_KEY"],
    accreditation:
      "Per-carrier API credentials, obtained through each carrier's developer programme. The ingest endpoint accepts all three formats without further work.",
    degradesTo: "Milestones are recorded manually from the ops screen.",
    requiredForProduction: true,
  },
  {
    key: "ais",
    name: "AIS vessel positions",
    domain: "Visibility",
    purpose: "Live vessel position reports for shipments on the water.",
    provider: "aisstream.io",
    requires: ["AISSTREAM_API_KEY"],
    accreditation: null,
    degradesTo: "The map shows carrier-reported milestones only, with no position between them.",
    requiredForProduction: false,
  },
  {
    key: "document_extraction",
    name: "Document extraction",
    domain: "Documents",
    purpose:
      "Read commercial invoices, packing lists and bills of lading into structured fields, with anything below the confidence threshold queued for a human.",
    provider: "Anthropic",
    requires: ["ANTHROPIC_API_KEY"],
    accreditation: null,
    degradesTo: "Every uploaded document goes to the manual review queue.",
    requiredForProduction: false,
  },
  {
    key: "notifications",
    name: "Customer notifications",
    domain: "Notifications",
    purpose: "Milestone notifications to shippers over WhatsApp and email.",
    provider: "Novu",
    requires: ["NOVU_API_KEY"],
    accreditation:
      "WhatsApp Business sender approval through Meta if the WhatsApp channel is used; email needs no accreditation.",
    degradesTo: "Milestones are logged and visible in the portal; nothing is pushed.",
    requiredForProduction: false,
  },
  {
    key: "identity",
    name: "Identity provider",
    domain: "Identity",
    purpose: "OIDC sign-in, tenant organisations and realm roles.",
    provider: "Keycloak",
    requires: ["AUTH_ISSUER"],
    accreditation: null,
    degradesTo: "Development header auth, which production config refuses to start with.",
    requiredForProduction: true,
  },
  {
    key: "event_stream",
    name: "Event stream",
    domain: "Messaging",
    purpose: "Mirror the event log to Redpanda for downstream consumers.",
    provider: "Redpanda / Kafka",
    requires: ["KAFKA_BROKERS"],
    accreditation: null,
    degradesTo: "Events accumulate in the transactional outbox and are never relayed.",
    requiredForProduction: true,
  },
];

export interface IntegrationState extends IntegrationDef {
  status: IntegrationStatus;
  /** Which required keys are still unset. Names only — never values. */
  missing: string[];
  /** Which optional keys are unset. */
  missingOptional: string[];
}

function isSet(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

/**
 * Evaluate the registry against live configuration.
 *
 * Returns key *names* only. An endpoint that reported which secrets were set
 * would be a short step from one that reported what they were, and this is
 * rendered on a screen.
 */
export function integrationStates(cfg: AppConfig): IntegrationState[] {
  return INTEGRATIONS.map((def) => {
    const missing = def.requires.filter((k) => !isSet(cfg[k])).map(String);
    const missingOptional = (def.optional ?? []).filter((k) => !isSet(cfg[k])).map(String);
    const status: IntegrationStatus =
      missing.length === 0
        ? missingOptional.length > 0
          ? "PARTIAL"
          : "CONFIGURED"
        : missing.length === def.requires.length
          ? "NOT_CONFIGURED"
          : "PARTIAL";
    return { ...def, status, missing, missingOptional };
  });
}
