import { CHARGE_CODE_BY_CODE, type ChargeBasis, type ChargeCategory, type ChargeProvenance } from "./charge-codes.js";

/**
 * The invoice audit — a four-way match, run before the money leaves.
 *
 * Most accounts-payable teams run a two-way match: does the invoice total
 * agree with the quote. That catches almost nothing, because the discrepancies
 * live inside lines that were never quoted — a fuel surcharge at last
 * quarter's level, a terminal handling charge billed per shipment instead of
 * per container, a documentation fee nobody has ever queried. Published audits
 * of forwarder billing put roughly four invoices in five as carrying at least
 * one discrepancy, with overcharges averaging 8–10% of the affected line and
 * systematic errors running 1.5–2.5% of total forwarder spend.
 *
 * So every line is matched against four sources:
 *
 *   1. the contract or tariff the customer was sold on,
 *   2. the underlying vendor cost, or a published benchmark where no vendor
 *      invoice exists (fuel indices, terminal tariffs),
 *   3. the shipment's own facts — container count, weights, ports, documents,
 *   4. the service event record: did the thing being billed for happen.
 *
 * Where a source is missing, the audit says so rather than passing the line.
 * `matchDepth` in the summary reports exactly which of the four were available,
 * because "no exceptions found" against one source is a different statement
 * from "no exceptions found" against four, and conflating them is how an audit
 * becomes theatre.
 *
 * Timing matters as much as the rules. Carriers and forwarders run dispute
 * windows measured in days to a few weeks; a discrepancy found during the
 * month-end close is a discrepancy found after the window closed. This runs at
 * issue and on demand, and the findings block nothing — they annotate, so a
 * human decides whether to hold payment.
 *
 * Pure: no framework, no database, no clock. Timestamps come in as inputs.
 */

export type Severity = "INFO" | "WARN" | "CRITICAL";

/** Which of the four match sources a rule drew on. */
export type MatchSource = "CONTRACT" | "VENDOR_COST" | "SHIPMENT_DATA" | "SERVICE_EVENTS";

export interface AuditLine {
  id: string;
  chargeCode: string;
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
  vendorName?: string | null;
  vendorInvoiceRef?: string | null;
  contractRef?: string | null;
  /** From `normaliseChargeCode`. "fallback" means nobody has mapped this code. */
  codeMatch?: "exact" | "alias" | "fallback";
}

/** One contracted price the invoice can be held to. */
export interface ContractRate {
  chargeCode: string;
  basis: ChargeBasis;
  unitSellCents: number;
  currency: string;
  /** Allowed drift before it is an exception. Defaults to the audit tolerance. */
  toleranceBps?: number;
  /** Cited in the finding so a dispute packet can point at it. */
  source: string;
}

/**
 * What a fuel surcharge should have been, derived from an index.
 *
 * EXTERNAL API. Bunker and jet-fuel indices are licensed commercial feeds
 * (Platts, Argus) or carrier tariff publications; `FUEL_INDEX_URL` supplies
 * them. Absent one, the fuel rule does not run and says why — inventing a
 * benchmark would produce confident findings with nothing behind them.
 */
export interface FuelBenchmark {
  indexCode: string;
  source: string;
  quotedFor: string;
  /** What one unit of the surcharge should be at this index level. */
  expectedUnitCents: number;
  currency: string;
  toleranceBps?: number;
}

/**
 * The shipment's own facts, and the terminal timestamps demurrage depends on.
 *
 * EXTERNAL API for the gate timestamps: they come from the terminal operating
 * system or the carrier's track-and-trace (`TERMINAL_EVENTS_URL`). Without
 * them a demurrage line cannot be verified at all, which is itself a finding.
 */
export interface ShipmentFacts {
  containerCount: number;
  transportDocumentCount: number;
  chargeableWeightGrams: number;
  volumeCm3: number;
  mode: string;
  /** Event types that actually occurred on this shipment. */
  occurredEventTypes: readonly string[];
  /** Free days on the bill of lading before demurrage starts accruing. */
  freeTimeDays?: number | null;
  dischargedAt?: Date | null;
  gateOutAt?: Date | null;
  emptyReturnedAt?: Date | null;
}

export interface AuditInput {
  invoiceCurrency: string;
  statedSubtotalCents: number;
  statedVatCents: number;
  statedTotalCents: number;
  /** Drives the "taxable line with no VAT" rule. */
  issuerVatRegistered: boolean;
  lines: readonly AuditLine[];
  contract: readonly ContractRate[];
  fuel?: FuelBenchmark | null;
  facts: ShipmentFacts;
  /** Default drift allowed against a contracted rate. 500 bps = 5%. */
  toleranceBps?: number;
  /** Lines under this are not worth a human's attention. Default R50 / $50. */
  materialityCents?: number;
}

export interface AuditFinding {
  code: string;
  chargeId: string | null;
  severity: Severity;
  message: string;
  /** Positive = the customer was overcharged. Null where not quantifiable. */
  varianceCents: number | null;
  sources: MatchSource[];
  evidence: Record<string, unknown>;
}

export interface AuditSummary {
  linesChecked: number;
  findings: number;
  criticalCount: number;
  /** Sum of quantified variances. Positive means the invoice is overstated. */
  netVarianceCents: number;
  /**
   * Which of the four sources were actually available. A match run against two
   * of four is worth saying out loud.
   */
  matchDepth: Record<MatchSource, boolean>;
  matchedSources: number;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: AuditSummary;
}

const DAY_MS = 86_400_000;
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

/** Whole days between two instants, rounded up — a part day is a charged day. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
}

function bpsDrift(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : 10_000;
  return Math.round(((actual - expected) / Math.abs(expected)) * 10_000);
}

/**
 * Codes that assert a service happened, and the event that would evidence it.
 *
 * Billing for delivery on a container that never left the terminal is not a
 * pricing error, it is a line for work not done — the one class of finding
 * that is always worth a dispute regardless of amount.
 */
const EVIDENCE_REQUIRED: Record<string, { events: string[]; what: string }> = {
  DEL: { events: ["container.gated_out", "pod.confirmed"], what: "delivery from the destination terminal" },
  PCK: { events: ["container.gated_in", "shipment.booked"], what: "collection from the shipper" },
  CCL: { events: ["entry.submitted", "entry.released"], what: "a customs entry" },
  DEM: { events: ["container.discharged"], what: "discharge, from which demurrage runs" },
  DET: { events: ["container.gated_out"], what: "gate-out, from which detention runs" },
  THC: { events: ["container.discharged", "vessel.arrived"], what: "arrival at the destination terminal" },
};

export function auditInvoice(input: AuditInput): AuditResult {
  const tolerance = input.toleranceBps ?? 500;
  const materiality = input.materialityCents ?? 5_000;
  const findings: AuditFinding[] = [];

  const contractByCode = new Map(input.contract.map((c) => [c.chargeCode, c]));
  const facts = input.facts;

  const add = (f: AuditFinding) => findings.push(f);

  // -- 1. Line-level rules ---------------------------------------------------
  for (const line of input.lines) {
    const def = CHARGE_CODE_BY_CODE.get(line.chargeCode);

    // A line nobody has mapped cannot be compared to anything. It is not
    // wrong; it is unauditable, which for spend analytics amounts to the same.
    if (line.codeMatch === "fallback") {
      add({
        code: "UNMAPPED_CHARGE_CODE",
        chargeId: line.id,
        severity: Math.abs(line.sellCents) >= materiality ? "WARN" : "INFO",
        message: `"${line.description}" did not match any known charge code and was filed under Other. Map it so this spend can be compared across vendors.`,
        varianceCents: null,
        sources: [],
        evidence: { chargeCode: line.chargeCode, sellCents: line.sellCents },
      });
    }

    // Currency drift inside one invoice. Every total below is a sum of
    // numbers in different units the moment this is true.
    if (line.currency !== input.invoiceCurrency) {
      add({
        code: "CURRENCY_MISMATCH",
        chargeId: line.id,
        severity: "CRITICAL",
        message: `Line is in ${line.currency} on a ${input.invoiceCurrency} invoice. The totals on this document are not meaningful until it is converted or moved to its own invoice.`,
        varianceCents: null,
        sources: ["SHIPMENT_DATA"],
        evidence: { lineCurrency: line.currency, invoiceCurrency: input.invoiceCurrency },
      });
    }

    // The arithmetic the line itself shows.
    if (line.unitSellCents != null && line.unitSellCents * line.quantity !== line.sellCents) {
      add({
        code: "LINE_ARITHMETIC",
        chargeId: line.id,
        severity: "WARN",
        message: `${line.quantity} × ${line.unitSellCents} does not equal the line total ${line.sellCents}.`,
        varianceCents: line.sellCents - line.unitSellCents * line.quantity,
        sources: ["SHIPMENT_DATA"],
        evidence: {
          quantity: line.quantity,
          unitSellCents: line.unitSellCents,
          sellCents: line.sellCents,
        },
      });
    }

    // A pass-through line is billed at cost by definition. Margin on one is
    // not a pricing choice, it is a line described as something it is not —
    // and where the "cost" is duty or VAT paid to an authority, it is a
    // misstatement of a statutory amount.
    if (line.provenance === "PASS_THROUGH" && line.buyCents != null && line.sellCents > line.buyCents) {
      add({
        code: "MARGIN_ON_PASS_THROUGH",
        chargeId: line.id,
        severity: "CRITICAL",
        message: `${line.description} is billed as a pass-through disbursement but carries ${line.sellCents - line.buyCents} above the recorded cost. Either the margin is wrong or the line should be marked up rather than disbursed.`,
        varianceCents: line.sellCents - line.buyCents,
        sources: ["VENDOR_COST"],
        evidence: { buyCents: line.buyCents, sellCents: line.sellCents },
      });
    }

    // VAT treatment. Charging VAT on a true disbursement overstates the
    // invoice and overstates the output tax the issuer then has to declare.
    if (def && !def.taxable && line.vatBps > 0) {
      add({
        code: "VAT_ON_DISBURSEMENT",
        chargeId: line.id,
        severity: "CRITICAL",
        message: `${def.label} is outside the scope of VAT but is charged at ${line.vatBps / 100}%. This overstates both the invoice and the issuer's output tax.`,
        varianceCents: Math.round((line.sellCents * line.vatBps) / 10_000),
        sources: ["CONTRACT"],
        evidence: { chargeCode: line.chargeCode, vatBps: line.vatBps },
      });
    }
    if (def && def.taxable && line.vatBps === 0 && input.issuerVatRegistered) {
      add({
        code: "MISSING_VAT",
        chargeId: line.id,
        severity: "WARN",
        message: `${def.label} is a taxable supply but carries no VAT. If that is deliberate — an exported service, say — record why.`,
        varianceCents: null,
        sources: ["CONTRACT"],
        evidence: { chargeCode: line.chargeCode },
      });
    }

    // Quantity against the shipment's own facts. A per-container charge billed
    // once on a three-container booking is the commonest terminal-handling
    // error there is, and it goes both ways.
    if (line.basis === "PER_CONTAINER" && facts.containerCount > 0 && line.quantity !== facts.containerCount) {
      const expected = line.unitSellCents != null ? line.unitSellCents * facts.containerCount : null;
      add({
        code: "QUANTITY_VS_CONTAINERS",
        chargeId: line.id,
        severity: "WARN",
        message: `${line.description} is charged per container at quantity ${line.quantity}, but this shipment moves ${facts.containerCount} container(s).`,
        varianceCents: expected == null ? null : line.sellCents - expected,
        sources: ["SHIPMENT_DATA"],
        evidence: { quantity: line.quantity, containerCount: facts.containerCount },
      });
    }
    if (
      line.basis === "PER_DOCUMENT" &&
      facts.transportDocumentCount > 0 &&
      line.quantity > facts.transportDocumentCount
    ) {
      add({
        code: "QUANTITY_VS_DOCUMENTS",
        chargeId: line.id,
        severity: "WARN",
        message: `${line.description} is charged for ${line.quantity} document(s); this shipment has ${facts.transportDocumentCount}. Documentation fees are per bill of lading, not per container.`,
        varianceCents:
          line.unitSellCents == null
            ? null
            : line.unitSellCents * (line.quantity - facts.transportDocumentCount),
        sources: ["SHIPMENT_DATA"],
        evidence: { quantity: line.quantity, documents: facts.transportDocumentCount },
      });
    }

    // Against the contract.
    const contracted = contractByCode.get(line.chargeCode);
    if (contracted && line.unitSellCents != null) {
      if (contracted.currency !== line.currency) {
        add({
          code: "CONTRACT_CURRENCY_MISMATCH",
          chargeId: line.id,
          severity: "WARN",
          message: `Contracted in ${contracted.currency}, billed in ${line.currency}. The rate cannot be compared without a stated conversion.`,
          varianceCents: null,
          sources: ["CONTRACT"],
          evidence: { contract: contracted.source },
        });
      } else {
        const drift = bpsDrift(line.unitSellCents, contracted.unitSellCents);
        const allowed = contracted.toleranceBps ?? tolerance;
        if (Math.abs(drift) > allowed) {
          const variance = (line.unitSellCents - contracted.unitSellCents) * line.quantity;
          add({
            code: "CONTRACT_RATE_VARIANCE",
            chargeId: line.id,
            severity:
              drift > 0 && Math.abs(variance) >= materiality
                ? "CRITICAL"
                : "WARN",
            message: `${line.description} is billed at ${line.unitSellCents} per unit against a contracted ${contracted.unitSellCents} (${(drift / 100).toFixed(1)}%). Source: ${contracted.source}.`,
            varianceCents: variance,
            sources: ["CONTRACT"],
            evidence: {
              billedUnitCents: line.unitSellCents,
              contractedUnitCents: contracted.unitSellCents,
              driftBps: drift,
              contract: contracted.source,
            },
          });
        }
      }
    } else if (
      line.provenance !== "FORWARDER_ORIGINATED" &&
      !line.contractRef &&
      !line.vendorInvoiceRef &&
      Math.abs(line.sellCents) >= materiality
    ) {
      // A third-party line with neither a contract nor a vendor invoice behind
      // it is unmatchable. This is the finding that a two-way match can never
      // produce, and it is the one that says the process itself has a hole.
      add({
        code: "NO_MATCH_REFERENCE",
        chargeId: line.id,
        severity: "WARN",
        message: `${line.description} carries a third-party cost but references neither a contract nor a vendor invoice. There is nothing to match it against.`,
        varianceCents: null,
        sources: [],
        evidence: { provenance: line.provenance, sellCents: line.sellCents },
      });
    }

    // Was the service performed at all.
    const evidence = EVIDENCE_REQUIRED[line.chargeCode];
    if (evidence && facts.occurredEventTypes.length > 0) {
      const seen = evidence.events.some((e) => facts.occurredEventTypes.includes(e));
      if (!seen) {
        add({
          code: "SERVICE_NOT_EVIDENCED",
          chargeId: line.id,
          severity: "CRITICAL",
          message: `${line.description} bills for ${evidence.what}, but no such event has been recorded on this shipment.`,
          varianceCents: line.sellCents,
          sources: ["SERVICE_EVENTS"],
          evidence: { expected: evidence.events, occurred: facts.occurredEventTypes },
        });
      }
    }
  }

  // -- 2. Fuel surcharges against the index ---------------------------------
  const fuelLines = input.lines.filter((l) => l.category === "FUEL_SURCHARGE");
  if (fuelLines.length > 0) {
    if (!input.fuel) {
      // Stated, not skipped. The single highest-error category on a forwarder
      // invoice is being taken on trust, and the reader should know it.
      add({
        code: "FUEL_BENCHMARK_UNAVAILABLE",
        chargeId: null,
        severity: "WARN",
        message: `${fuelLines.length} fuel surcharge line(s) could not be validated: no fuel index is configured. Bunker and jet-fuel indices are licensed external feeds — set FUEL_INDEX_URL to enable this check.`,
        varianceCents: null,
        sources: [],
        evidence: {
          lines: fuelLines.map((l) => l.chargeCode),
          totalCents: fuelLines.reduce((s, l) => s + l.sellCents, 0),
        },
      });
    } else {
      const bench = input.fuel;
      const allowed = bench.toleranceBps ?? tolerance;
      for (const line of fuelLines) {
        if (line.unitSellCents == null || line.currency !== bench.currency) continue;
        const drift = bpsDrift(line.unitSellCents, bench.expectedUnitCents);
        if (Math.abs(drift) > allowed) {
          add({
            code: "FUEL_INDEX_VARIANCE",
            chargeId: line.id,
            severity: drift > 0 ? "CRITICAL" : "WARN",
            message: `${line.description} is billed at ${line.unitSellCents} per unit; ${bench.indexCode} at ${bench.quotedFor} implies ${bench.expectedUnitCents} (${(drift / 100).toFixed(1)}%). Source: ${bench.source}.`,
            varianceCents: (line.unitSellCents - bench.expectedUnitCents) * line.quantity,
            sources: ["VENDOR_COST"],
            evidence: {
              indexCode: bench.indexCode,
              quotedFor: bench.quotedFor,
              expectedUnitCents: bench.expectedUnitCents,
              billedUnitCents: line.unitSellCents,
              driftBps: drift,
            },
          });
        }
      }
    }
  }

  // -- 3. Demurrage and detention against the clock -------------------------
  const demLines = input.lines.filter((l) => l.chargeCode === "DEM");
  const detLines = input.lines.filter((l) => l.chargeCode === "DET");

  if (demLines.length > 0) {
    if (!facts.dischargedAt || !facts.gateOutAt || facts.freeTimeDays == null) {
      add({
        code: "DEMURRAGE_UNVERIFIABLE",
        chargeId: demLines[0]!.id,
        severity: "WARN",
        message:
          "Demurrage is billed but cannot be recomputed: it needs the discharge and gate-out timestamps from the terminal and the free-time allowance from the bill of lading. Terminal gate events are an external feed — set TERMINAL_EVENTS_URL, and record free time on the transport document.",
        varianceCents: null,
        sources: [],
        evidence: {
          dischargedAt: facts.dischargedAt ?? null,
          gateOutAt: facts.gateOutAt ?? null,
          freeTimeDays: facts.freeTimeDays ?? null,
        },
      });
    } else {
      const dwell = daysBetween(facts.dischargedAt, facts.gateOutAt);
      const chargeable = Math.max(0, dwell - facts.freeTimeDays);
      const billed = demLines.reduce((s, l) => s + l.quantity, 0);
      if (billed !== chargeable) {
        const unit = demLines[0]!.unitSellCents;
        add({
          code: "DEMURRAGE_DAYS_VARIANCE",
          chargeId: demLines[0]!.id,
          severity: billed > chargeable ? "CRITICAL" : "WARN",
          message: `${billed} demurrage day(s) billed. The container dwelt ${dwell} day(s) against ${facts.freeTimeDays} free, so ${chargeable} are chargeable.`,
          varianceCents: unit == null ? null : unit * (billed - chargeable),
          sources: ["SHIPMENT_DATA", "SERVICE_EVENTS"],
          evidence: { dwellDays: dwell, freeTimeDays: facts.freeTimeDays, billedDays: billed },
        });
      }
    }
  }

  if (demLines.length > 0 && detLines.length > 0 && facts.dischargedAt && facts.emptyReturnedAt) {
    // Demurrage runs inside the terminal, detention runs outside it, and the
    // two windows abut at gate-out — they cannot overlap. Billed together for
    // more days than the container was out of the carrier's hands, one of them
    // is counting days that belong to the other.
    const totalDays = daysBetween(facts.dischargedAt, facts.emptyReturnedAt);
    const billedDays =
      demLines.reduce((s, l) => s + l.quantity, 0) + detLines.reduce((s, l) => s + l.quantity, 0);
    if (billedDays > totalDays) {
      add({
        code: "DEMURRAGE_DETENTION_OVERLAP",
        chargeId: detLines[0]!.id,
        severity: "CRITICAL",
        message: `Demurrage and detention together bill ${billedDays} day(s), but only ${totalDays} elapsed between discharge and empty return. The two windows abut at gate-out and cannot overlap.`,
        varianceCents: null,
        sources: ["SERVICE_EVENTS"],
        evidence: { billedDays, elapsedDays: totalDays },
      });
    }
  }

  // -- 4. Duplicates --------------------------------------------------------
  // Same code, same vendor, same amount, twice. Legitimate on rare occasions —
  // two bills of lading under one shipment — so it is a WARN, and the quantity
  // has to match too or it is just two different quantities of the same thing.
  const seen = new Map<string, AuditLine>();
  for (const line of input.lines) {
    const key = `${line.chargeCode}|${line.vendorName ?? ""}|${line.sellCents}|${line.quantity}`;
    const prior = seen.get(key);
    if (prior) {
      add({
        code: "DUPLICATE_LINE",
        chargeId: line.id,
        severity: Math.abs(line.sellCents) >= materiality ? "WARN" : "INFO",
        message: `${line.description} appears twice at the same amount and quantity. Confirm this is two chargeable events and not one billed twice.`,
        varianceCents: line.sellCents,
        sources: ["SHIPMENT_DATA"],
        evidence: { firstChargeId: prior.id, sellCents: line.sellCents },
      });
    } else {
      seen.set(key, line);
    }
  }

  // -- 5. The document's own totals -----------------------------------------
  const computedSubtotal = input.lines.reduce((s, l) => s + l.sellCents, 0);
  if (computedSubtotal !== input.statedSubtotalCents) {
    add({
      code: "SUBTOTAL_MISMATCH",
      chargeId: null,
      severity: "CRITICAL",
      message: `The lines sum to ${computedSubtotal} but the invoice states a subtotal of ${input.statedSubtotalCents}.`,
      varianceCents: input.statedSubtotalCents - computedSubtotal,
      sources: ["SHIPMENT_DATA"],
      evidence: { computedSubtotal, statedSubtotal: input.statedSubtotalCents },
    });
  }
  if (input.statedSubtotalCents + input.statedVatCents !== input.statedTotalCents) {
    add({
      code: "TOTAL_MISMATCH",
      chargeId: null,
      severity: "CRITICAL",
      message: `Subtotal ${input.statedSubtotalCents} plus VAT ${input.statedVatCents} does not equal the stated total ${input.statedTotalCents}.`,
      varianceCents:
        input.statedTotalCents - (input.statedSubtotalCents + input.statedVatCents),
      sources: [],
      evidence: {
        subtotal: input.statedSubtotalCents,
        vat: input.statedVatCents,
        total: input.statedTotalCents,
      },
    });
  }

  // -- Summary --------------------------------------------------------------
  const matchDepth: Record<MatchSource, boolean> = {
    CONTRACT: input.contract.length > 0,
    VENDOR_COST: input.lines.some((l) => l.buyCents != null) || input.fuel != null,
    SHIPMENT_DATA: facts.containerCount > 0 || facts.transportDocumentCount > 0,
    SERVICE_EVENTS: facts.occurredEventTypes.length > 0,
  };

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Math.abs(b.varianceCents ?? 0) - Math.abs(a.varianceCents ?? 0) ||
      a.code.localeCompare(b.code),
  );

  return {
    findings,
    summary: {
      linesChecked: input.lines.length,
      findings: findings.length,
      criticalCount: findings.filter((f) => f.severity === "CRITICAL").length,
      netVarianceCents: findings.reduce((s, f) => s + (f.varianceCents ?? 0), 0),
      matchDepth,
      matchedSources: Object.values(matchDepth).filter(Boolean).length,
    },
  };
}

/**
 * The dispute packet.
 *
 * A dispute that arrives after the carrier's or forwarder's window has closed
 * is a write-off however good the evidence is, so the packet is assembled the
 * moment the exception is raised rather than at month-end. It is deliberately
 * plain text: it gets pasted into an email to a vendor, and the recipient is a
 * person with an invoice in front of them, not a system.
 */
export function buildDisputePacket(params: {
  invoiceNumber: string;
  issuerName: string;
  shipmentReference?: string | null;
  transportDocumentRef?: string | null;
  currency: string;
  findings: readonly AuditFinding[];
  lineById: ReadonlyMap<string, { description: string; chargeCode: string; sellCents: number }>;
  /** Days remaining to raise this with the vendor, where known. */
  disputeWindowDaysRemaining?: number | null;
  generatedAt: Date;
}): { subject: string; body: string; claimedCents: number; lineCount: number } {
  const disputable = params.findings.filter(
    (f) => f.severity !== "INFO" && (f.varianceCents ?? 0) > 0,
  );
  const claimedCents = disputable.reduce((s, f) => s + (f.varianceCents ?? 0), 0);

  const money = (cents: number) => `${params.currency} ${(cents / 100).toFixed(2)}`;

  const header = [
    `Query on invoice ${params.invoiceNumber}`,
    params.shipmentReference ? `Shipment: ${params.shipmentReference}` : null,
    params.transportDocumentRef ? `Transport document: ${params.transportDocumentRef}` : null,
    `Raised by: ${params.issuerName}`,
    `Date: ${params.generatedAt.toISOString().slice(0, 10)}`,
    params.disputeWindowDaysRemaining != null
      ? `Dispute window: ${params.disputeWindowDaysRemaining} day(s) remaining`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const items = disputable.map((f, i) => {
    const line = f.chargeId ? params.lineById.get(f.chargeId) : undefined;
    return [
      `${i + 1}. ${line ? `${line.chargeCode} — ${line.description}` : "Invoice level"}`,
      line ? `   Billed: ${money(line.sellCents)}` : null,
      `   Queried: ${money(f.varianceCents ?? 0)}`,
      `   Reason: ${f.message}`,
      `   Reference: ${f.code}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const body = [
    header,
    "",
    disputable.length === 0
      ? "No quantified overcharges were identified on this invoice."
      : `The following ${disputable.length} item(s) on this invoice are queried, totalling ${money(claimedCents)}:`,
    "",
    ...items,
    "",
    "Please provide the underlying tariff, index publication or terminal record supporting the charges above, or issue a credit note for the queried amounts.",
    "",
    "This query is raised before payment and within the dispute window. Payment of the undisputed balance is not withheld.",
  ].join("\n");

  return {
    subject: `Invoice ${params.invoiceNumber} — ${disputable.length} queried item(s), ${money(claimedCents)}`,
    body,
    claimedCents,
    lineCount: disputable.length,
  };
}
