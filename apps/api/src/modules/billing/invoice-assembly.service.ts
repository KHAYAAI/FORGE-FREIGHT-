import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  bookings,
  cargoItems,
  chargeCodeAliases,
  charges,
  consignments,
  containers,
  events,
  invoiceExceptions,
  invoices,
  parties,
  payments,
  quoteLines,
  quotes,
  shipments,
  type Db,
} from "@forge-freight/db";
import { DB } from "../db/db.module.js";
import { FuelIndexService } from "../integrations/fuel-index.service.js";
import { TerminalEventsService } from "../integrations/terminal-events.service.js";
import { normaliseChargeCode, normaliseKey } from "./charge-codes.js";
import {
  buildInvoiceDocument,
  type InvoiceDocument,
  type InvoiceLineInput,
} from "./invoice-document.js";
import {
  auditInvoice,
  buildDisputePacket,
  type AuditLine,
  type ContractRate,
  type AuditResult,
} from "./invoice-audit.js";
import { BillingProfileService } from "./billing-profile.service.js";

/**
 * Reads everything the standardised invoice and its audit need out of the
 * database, and hands it to the pure modules.
 *
 * The split is deliberate and the whole file is arranged around it: this class
 * does I/O and nothing else — no arithmetic, no rules, no thresholds. Every
 * judgement lives in `invoice-document.ts` and `invoice-audit.ts`, which are
 * pure and therefore testable without a database and reproducible from the
 * same inputs a year later. When a customer queries a finding, the answer has
 * to be re-derivable, and it cannot be if the rule ran inside a query.
 */
@Injectable()
export class InvoiceAssemblyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BillingProfileService) private readonly profiles: BillingProfileService,
    @Inject(FuelIndexService) private readonly fuel: FuelIndexService,
    @Inject(TerminalEventsService) private readonly terminal: TerminalEventsService,
  ) {}

  /** Tenant's alias table as the normaliser wants it. */
  private async aliasMap(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select()
      .from(chargeCodeAliases)
      .where(eq(chargeCodeAliases.tenantId, tenantId));
    return new Map(rows.map((r) => [normaliseKey(r.alias), r.canonicalCode]));
  }

  private async loadInvoice(tenantId: string, invoiceId: string) {
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }

  /**
   * The full document: issuer, bill-to, the movement, the cargo, the lines
   * grouped by category, and the totals.
   *
   * `commercial` controls whether cost and margin come back at all. A customer
   * reading their own invoice through the portal gets the document; they do
   * not get the buy prices, and the safest way to guarantee that is for the
   * numbers never to leave the API.
   */
  async document(
    tenantId: string,
    invoiceId: string,
    opts: { commercial: boolean },
  ): Promise<InvoiceDocument & { profileMissing: string[] }> {
    const invoice = await this.loadInvoice(tenantId, invoiceId);
    const profile = await this.profiles.ensure(tenantId);
    const aliases = await this.aliasMap(tenantId);

    const [customer] = await this.db
      .select()
      .from(parties)
      .where(eq(parties.id, invoice.customerId));

    const lineRows = await this.db
      .select({
        charge: charges,
        vendorName: parties.name,
      })
      .from(charges)
      .leftJoin(parties, eq(parties.id, charges.vendorPartyId))
      .where(and(eq(charges.invoiceId, invoiceId), eq(charges.tenantId, tenantId)))
      .orderBy(asc(charges.createdAt));

    const lines: InvoiceLineInput[] = lineRows.map(({ charge, vendorName }) => {
      const normalised = normaliseChargeCode(charge.chargeCode, aliases);
      return {
        id: charge.id,
        chargeCode: normalised.code,
        description: charge.description,
        category: charge.category,
        provenance: charge.provenance,
        basis: charge.basis,
        quantity: charge.quantity,
        unitSellCents: charge.unitSellCents ?? null,
        sellCents: charge.sellCents,
        // Cost is the forwarder's own information. Withheld at the source
        // rather than hidden in the view.
        buyCents: opts.commercial ? (charge.buyCents ?? null) : null,
        currency: charge.currency,
        vatBps: charge.vatBps,
        vendorName: opts.commercial ? vendorName : null,
        vendorInvoiceRef: opts.commercial ? charge.vendorInvoiceRef : null,
        contractRef: opts.commercial ? charge.contractRef : null,
        disputed: charge.disputed,
      };
    });

    const [paid] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint`.mapWith(Number),
      })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));

    const shipmentSummary = invoice.shipmentId
      ? await this.shipmentSummary(invoice.shipmentId, invoice.transportDocumentRef)
      : null;
    const cargoSummary = invoice.shipmentId ? await this.cargoSummary(invoice.shipmentId) : null;

    // The snapshot wins where one exists: an invoice must keep saying what it
    // said when it was sent, even after the company changes its bank account.
    const issuer =
      (invoice.issuerSnapshot as InvoiceDocument["issuer"] | null) ?? {
        legalName: profile.legalName,
        tradingName: profile.tradingName,
        registrationNumber: profile.registrationNumber,
        vatNumber: profile.vatNumber,
        customsClientNumber: profile.customsClientNumber,
        addressLines: profile.addressLines,
        country: profile.country,
        email: profile.email,
        phone: profile.phone,
        logoUrl: profile.logoUrl,
        bankName: profile.bankName,
        bankAccountName: profile.bankAccountName,
        bankAccountNumber: profile.bankAccountNumber,
        bankBranchCode: profile.bankBranchCode,
        bankSwift: profile.bankSwift,
        invoiceFooter: profile.invoiceFooter,
      };

    const billTo =
      (invoice.billToSnapshot as InvoiceDocument["billTo"] | null) ?? {
        name: customer?.name ?? "Customer",
        addressLines: customer?.address ?? null,
        country: customer?.country ?? null,
        taxId: customer?.taxId ?? null,
        email: customer?.email ?? null,
      };

    const doc = buildInvoiceDocument({
      number: invoice.number,
      type: invoice.type,
      status: invoice.status,
      currency: invoice.currency,
      issueDate: invoice.createdAt,
      dueDate: invoice.dueDate,
      paymentTermsDays: invoice.paymentTermsDays,
      issuer,
      billTo,
      shipment: shipmentSummary,
      cargo: cargoSummary,
      lines,
      customerReference: invoice.customerReference,
      notes: invoice.notes,
      paidCents: paid?.total ?? 0,
    });

    return { ...doc, profileMissing: this.profiles.completeness(profile).missing };
  }

  private async shipmentSummary(shipmentId: string, transportDocumentRef: string | null) {
    const [row] = await this.db
      .select({ shipment: shipments, booking: bookings })
      .from(shipments)
      .leftJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(eq(shipments.id, shipmentId));
    if (!row) return null;

    const boxes = await this.db
      .select({ number: containers.containerNumber, type: containers.containerType })
      .from(containers)
      .where(eq(containers.shipmentId, shipmentId));

    const [cons] = row.shipment.consignmentId
      ? await this.db
          .select({ mode: sql<string>`'OCEAN'` })
          .from(consignments)
          .where(eq(consignments.id, row.shipment.consignmentId))
      : [];

    return {
      reference: row.shipment.reference,
      origin: row.shipment.origin,
      destination: row.shipment.destination,
      mode: cons?.mode ?? "OCEAN",
      incoterm: row.shipment.incoterm,
      transportDocumentRef,
      carrierBookingRef: row.booking?.carrierBookingRef ?? null,
      containers: boxes,
      vesselName: null,
      voyage: null,
      etd: null,
      eta: null,
    };
  }

  private async cargoSummary(shipmentId: string) {
    const [row] = await this.db
      .select({ consignment: consignments })
      .from(shipments)
      .innerJoin(consignments, eq(consignments.id, shipments.consignmentId))
      .where(eq(shipments.id, shipmentId));
    if (!row) return null;
    const c = row.consignment;

    const marks = await this.db
      .select({ marks: cargoItems.marksAndNumbers })
      .from(cargoItems)
      .where(eq(cargoItems.consignmentId, c.id));

    return {
      description: c.description,
      cargoType: c.cargoType,
      pieces: c.pieces,
      grossWeightGrams: c.grossWeightGrams,
      volumeCm3: c.volumeCm3,
      chargeableWeightGrams: c.chargeableWeightGrams,
      marksAndNumbers:
        marks
          .map((m) => m.marks)
          .filter((m): m is string => !!m)
          .join(" / ") || null,
    };
  }

  /**
   * Run the four-way match and persist the findings.
   *
   * Persisted rather than computed on read because a finding is a thing a
   * person acts on — accepts, disputes, resolves — and its state has to
   * outlive the request. Re-running updates in place on the unique index, so
   * opening the screen twice does not double the exception list.
   */
  async runAudit(tenantId: string, invoiceId: string, now = new Date()): Promise<AuditResult> {
    const invoice = await this.loadInvoice(tenantId, invoiceId);
    const profile = await this.profiles.ensure(tenantId);
    const aliases = await this.aliasMap(tenantId);

    const lineRows = await this.db
      .select({ charge: charges, vendorName: parties.name })
      .from(charges)
      .leftJoin(parties, eq(parties.id, charges.vendorPartyId))
      .where(and(eq(charges.invoiceId, invoiceId), eq(charges.tenantId, tenantId)));

    const auditLines: AuditLine[] = lineRows.map(({ charge, vendorName }) => {
      const n = normaliseChargeCode(charge.chargeCode, aliases);
      return {
        id: charge.id,
        chargeCode: n.code,
        description: charge.description,
        category: charge.category,
        provenance: charge.provenance,
        basis: charge.basis,
        quantity: charge.quantity,
        unitSellCents: charge.unitSellCents ?? null,
        sellCents: charge.sellCents,
        buyCents: charge.buyCents ?? null,
        currency: charge.currency,
        vatBps: charge.vatBps,
        vendorName,
        vendorInvoiceRef: charge.vendorInvoiceRef,
        contractRef: charge.contractRef,
        codeMatch: n.match,
      };
    });

    const facts = await this.shipmentFacts(tenantId, invoice.shipmentId);
    const contract = await this.contractRates(tenantId, invoice.shipmentId);

    // Fuel benchmark: only asked for when there is a fuel line to check, so an
    // unconfigured feed is not logged on every invoice that has none.
    const hasFuel = auditLines.some((l) => l.category === "FUEL_SURCHARGE");
    const fuel = hasFuel
      ? (await this.fuel.benchmarkFor({ indexCode: "BUNKER_DEFAULT", currency: invoice.currency }))
          .benchmark
      : null;

    const result = auditInvoice({
      invoiceCurrency: invoice.currency,
      statedSubtotalCents: invoice.subtotalCents,
      statedVatCents: invoice.vatCents,
      statedTotalCents: invoice.totalCents,
      issuerVatRegistered: !!profile.vatNumber,
      lines: auditLines,
      contract,
      fuel,
      facts,
    });

    await this.db.transaction(async (tx) => {
      for (const f of result.findings) {
        await tx
          .insert(invoiceExceptions)
          .values({
            tenantId,
            invoiceId,
            chargeId: f.chargeId,
            code: f.code,
            severity: f.severity,
            message: f.message,
            varianceCents: f.varianceCents,
            evidence: f.evidence,
            detectedAt: now,
          })
          .onConflictDoUpdate({
            target: f.chargeId
              ? [invoiceExceptions.invoiceId, invoiceExceptions.code, invoiceExceptions.chargeId]
              : [invoiceExceptions.invoiceId, invoiceExceptions.code],
            targetWhere: f.chargeId
              ? sql`charge_id is not null`
              : sql`charge_id is null`,
            // Status is not touched: a human who has already accepted or
            // disputed a finding does not have that decision reset by the next
            // scheduled re-run.
            set: {
              severity: f.severity,
              message: f.message,
              varianceCents: f.varianceCents,
              evidence: f.evidence,
              detectedAt: now,
            },
          });
      }

      // Findings that no longer reproduce are resolved, not deleted: the
      // record that an exception existed and went away is the audit trail.
      const stillOpen = result.findings.map((f) => f.code);
      if (stillOpen.length > 0) {
        await tx
          .update(invoiceExceptions)
          .set({ status: "RESOLVED", resolvedAt: now, resolutionNote: "No longer reproduced by the audit" })
          .where(
            and(
              eq(invoiceExceptions.invoiceId, invoiceId),
              eq(invoiceExceptions.status, "OPEN"),
              sql`${invoiceExceptions.code} not in ${stillOpen}`,
            ),
          );
      }

      await tx.update(invoices).set({ auditedAt: now }).where(eq(invoices.id, invoiceId));
    });

    return result;
  }

  async listExceptions(tenantId: string, invoiceId?: string) {
    const where = invoiceId
      ? and(eq(invoiceExceptions.tenantId, tenantId), eq(invoiceExceptions.invoiceId, invoiceId))
      : eq(invoiceExceptions.tenantId, tenantId);
    return this.db
      .select({ exception: invoiceExceptions, invoiceNumber: invoices.number })
      .from(invoiceExceptions)
      .leftJoin(invoices, eq(invoices.id, invoiceExceptions.invoiceId))
      .where(where)
      .orderBy(desc(invoiceExceptions.detectedAt))
      .limit(500);
  }

  /**
   * Record a human's decision on a finding.
   *
   * DISPUTED also marks the charge itself, so the invoice document can hold
   * the amount back from the balance a customer is asked to settle now.
   */
  async resolveException(
    tenantId: string,
    exceptionId: string,
    status: "ACCEPTED" | "DISPUTED" | "RESOLVED",
    note: string | null,
    now = new Date(),
  ) {
    const [row] = await this.db
      .select()
      .from(invoiceExceptions)
      .where(and(eq(invoiceExceptions.id, exceptionId), eq(invoiceExceptions.tenantId, tenantId)));
    if (!row) throw new NotFoundException("Exception not found");

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(invoiceExceptions)
        .set({
          status,
          resolutionNote: note,
          resolvedAt: status === "DISPUTED" ? null : now,
        })
        .where(eq(invoiceExceptions.id, exceptionId))
        .returning();

      if (row.chargeId) {
        await tx
          .update(charges)
          .set({ disputed: status === "DISPUTED" })
          .where(eq(charges.id, row.chargeId));
      }
      return updated!;
    });
  }

  /**
   * The dispute packet for an invoice, ready to send.
   *
   * Generated from the *open* findings at the moment it is asked for, because
   * the value of a dispute is entirely in its timing — carriers and forwarders
   * run windows measured in days, and a packet assembled at month-end is a
   * packet assembled after the window closed. `disputeWindowDays` is the
   * customer's contractual window; the days remaining are computed from the
   * invoice date so the packet says how much time is left on its own face.
   */
  async disputePacket(tenantId: string, invoiceId: string, disputeWindowDays = 30, now = new Date()) {
    const invoice = await this.loadInvoice(tenantId, invoiceId);
    const profile = await this.profiles.ensure(tenantId);

    const findings = await this.db
      .select()
      .from(invoiceExceptions)
      .where(
        and(
          eq(invoiceExceptions.invoiceId, invoiceId),
          eq(invoiceExceptions.tenantId, tenantId),
          inArray(invoiceExceptions.status, ["OPEN", "DISPUTED"]),
        ),
      );

    const lineRows = await this.db
      .select()
      .from(charges)
      .where(and(eq(charges.invoiceId, invoiceId), eq(charges.tenantId, tenantId)));

    const shipmentRef = invoice.shipmentId
      ? (
          await this.db
            .select({ reference: shipments.reference })
            .from(shipments)
            .where(eq(shipments.id, invoice.shipmentId))
        )[0]?.reference ?? null
      : null;

    const elapsedDays = Math.floor(
      (now.getTime() - invoice.createdAt.getTime()) / 86_400_000,
    );

    return buildDisputePacket({
      invoiceNumber: invoice.number,
      issuerName: profile.tradingName || profile.legalName,
      shipmentReference: shipmentRef,
      transportDocumentRef: invoice.transportDocumentRef,
      currency: invoice.currency,
      findings: findings.map((f) => ({
        code: f.code,
        chargeId: f.chargeId,
        severity: f.severity,
        message: f.message,
        varianceCents: f.varianceCents,
        sources: [],
        evidence: (f.evidence as Record<string, unknown>) ?? {},
      })),
      lineById: new Map(
        lineRows.map((c) => [
          c.id,
          { description: c.description, chargeCode: c.chargeCode, sellCents: c.sellCents },
        ]),
      ),
      disputeWindowDaysRemaining: Math.max(0, disputeWindowDays - elapsedDays),
      generatedAt: now,
    });
  }

  /** Container counts, document counts, the event history, and the gate clock. */
  private async shipmentFacts(tenantId: string, shipmentId: string | null) {
    if (!shipmentId) {
      return {
        containerCount: 0,
        transportDocumentCount: 0,
        chargeableWeightGrams: 0,
        volumeCm3: 0,
        mode: "OCEAN",
        occurredEventTypes: [] as string[],
        freeTimeDays: null,
        dischargedAt: null,
        gateOutAt: null,
        emptyReturnedAt: null,
      };
    }

    const boxes = await this.db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.shipmentId, shipmentId));

    const eventRows = await this.db
      .select({ type: events.type })
      .from(events)
      .where(and(eq(events.shipmentId, shipmentId), eq(events.tenantId, tenantId)));

    const cargo = await this.cargoSummary(shipmentId);
    const clock = await this.terminal.gateClock(shipmentId, tenantId);

    return {
      containerCount: boxes.length,
      // One transport document per shipment until multi-B/L consolidation
      // exists. Stated rather than assumed: the documentation-fee rule keys
      // off it, and a wrong count there produces a wrong finding.
      transportDocumentCount: 1,
      chargeableWeightGrams: cargo?.chargeableWeightGrams ?? 0,
      volumeCm3: cargo?.volumeCm3 ?? 0,
      mode: "OCEAN",
      occurredEventTypes: Array.from(new Set(eventRows.map((e) => e.type))),
      // Free time comes off the bill of lading and is not modelled yet, so it
      // stays null and the demurrage rule reports unverifiable rather than
      // computing against a default nobody agreed to.
      freeTimeDays: null,
      dischargedAt: clock.dischargedAt,
      gateOutAt: clock.gateOutAt,
      emptyReturnedAt: clock.emptyReturnedAt,
    };
  }

  /**
   * The contract the invoice is held to.
   *
   * The accepted quote, not the rate card. A rate card is what the lane costs;
   * the quote is what this customer was actually sold, at the margin that
   * applied on the day, and it is the document they would produce in a
   * dispute. Holding the invoice to anything else means winning an argument
   * against a number the customer never agreed to.
   *
   * This is also what makes contracts *queryable* rather than a PDF in a
   * shared drive: the quote lines are rows, so a line-by-line match is a join
   * instead of a person reading two documents side by side.
   */
  private async contractRates(tenantId: string, shipmentId: string | null): Promise<ContractRate[]> {
    if (!shipmentId) return [];

    const [row] = await this.db
      .select({ quoteId: bookings.quoteId, createdAt: quotes.createdAt })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .leftJoin(quotes, eq(quotes.id, bookings.quoteId))
      .where(and(eq(shipments.id, shipmentId), eq(shipments.tenantId, tenantId)));
    if (!row?.quoteId) return [];

    const lines = await this.db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, row.quoteId));

    const aliases = await this.aliasMap(tenantId);
    const on = row.createdAt ? row.createdAt.toISOString().slice(0, 10) : "quote";

    return lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({
        chargeCode: normaliseChargeCode(l.chargeCode, aliases).code,
        basis: "PER_CONTAINER" as const,
        unitSellCents: Math.round(l.sellCents / l.quantity),
        currency: l.currency,
        source: `Accepted quote of ${on}`,
      }));
  }
}
