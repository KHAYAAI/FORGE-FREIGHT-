import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  chargeCodeAliases,
  charges,
  invoices,
  payments,
  shipments,
  type Db,
} from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { DB } from "../db/db.module.js";
import { BillingProfileService } from "./billing-profile.service.js";
import { BillingService } from "./billing.service.js";
import {
  BillingProfileDto,
  ChargeCodeAliasDto,
  ChargeLineDto,
  IssueInvoiceDto,
  ResolveExceptionDto,
} from "./billing.dto.js";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CHARGE_CODES,
  normaliseChargeCode,
  normaliseKey,
} from "./charge-codes.js";
import { InvoiceAssemblyService } from "./invoice-assembly.service.js";

const PaymentDto = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().trim().toUpperCase().length(3),
  /**
   * The bank's or gateway's reference. Required, and unique per invoice —
   * it is what makes a redelivered webhook a no-op rather than a second
   * credit, so there is deliberately no way to record a payment without one.
   */
  paymentRef: z.string().trim().min(1).max(100),
  receivedAt: z.coerce.date().optional(),
});

@Controller()
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BillingProfileService) private readonly profiles: BillingProfileService,
    @Inject(InvoiceAssemblyService) private readonly assembly: InvoiceAssemblyService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @RequireRoles("finance")
  @Post("shipments/:id/invoices")
  async issue(
    @Param("id", ParseUUIDPipe) shipmentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = IssueInvoiceDto.parse(body ?? {});
    return this.billing.issueInvoices({
      shipmentId,
      tenantId: auth.tenantId,
      ...dto,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  // -- The company's own invoice identity ------------------------------------

  /**
   * This tenant's billing profile, with what is still missing from it.
   *
   * Readable by anyone in the tenant — an ops user needs to know whether the
   * company can issue a complete invoice — but writable only by finance.
   */
  @Get("billing/profile")
  async profile(@CurrentAuth() auth: AuthContext) {
    const profile = await this.profiles.ensure(auth.tenantId);
    return { ...profile, completeness: this.profiles.completeness(profile) };
  }

  @RequireRoles("finance")
  @Patch("billing/profile")
  async updateProfile(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const dto = BillingProfileDto.parse(body);
    const profile = await this.profiles.update(auth.tenantId, dto);
    return { ...profile, completeness: this.profiles.completeness(profile) };
  }

  /**
   * The canonical charge-code taxonomy, so the console builds its pickers from
   * the same list the audit reasons over and the two cannot drift.
   */
  @Get("billing/charge-codes")
  chargeCodes() {
    return {
      codes: CHARGE_CODES,
      categories: CATEGORY_ORDER.map((c) => ({ code: c, label: CATEGORY_LABEL[c] })),
    };
  }

  @Get("billing/charge-code-aliases")
  async aliases(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select()
      .from(chargeCodeAliases)
      .where(eq(chargeCodeAliases.tenantId, auth.tenantId))
      .orderBy(chargeCodeAliases.alias);
  }

  /**
   * Teach the platform one of this company's vendor dialects.
   *
   * Upsert rather than insert: mapping the same alias twice is someone
   * correcting themselves, not an error worth a 409.
   */
  @RequireRoles("finance")
  @Post("billing/charge-code-aliases")
  async addAlias(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const dto = ChargeCodeAliasDto.parse(body);
    const [row] = await this.db
      .insert(chargeCodeAliases)
      .values({
        tenantId: auth.tenantId,
        alias: normaliseKey(dto.alias),
        canonicalCode: dto.canonicalCode,
        vendorPartyId: dto.vendorPartyId ?? null,
      })
      .onConflictDoUpdate({
        target: [chargeCodeAliases.tenantId, chargeCodeAliases.alias],
        set: { canonicalCode: dto.canonicalCode, vendorPartyId: dto.vendorPartyId ?? null },
      })
      .returning();
    return row;
  }

  /**
   * Add a charge line to a shipment by hand.
   *
   * The lifecycle engine accrues most charges automatically, but a forwarder
   * always has lines nobody could have predicted — a re-stow, a terminal
   * penalty, a customer-specific concession. Those arrive here with the same
   * structure as everything else, because a manually-added line that skips the
   * taxonomy is a line the audit cannot see.
   */
  @RequireRoles("finance")
  @Post("shipments/:id/charges")
  async addCharge(
    @Param("id", ParseUUIDPipe) shipmentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = ChargeLineDto.parse(body);
    const [shipment] = await this.db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), eq(shipments.tenantId, auth.tenantId)));
    if (!shipment) throw new NotFoundException("Shipment not found");

    const [row] = await this.db
      .insert(charges)
      .values({
        tenantId: auth.tenantId,
        shipmentId,
        chargeCode: normaliseChargeCode(dto.chargeCode).code,
        description: dto.description,
        kind: dto.kind,
        category: dto.category,
        provenance: dto.provenance,
        basis: dto.basis,
        quantity: dto.quantity,
        unitSellCents: dto.unitSellCents,
        sellCents: dto.unitSellCents * dto.quantity,
        buyCents: dto.buyCents ?? null,
        currency: dto.currency,
        vatBps: dto.vatBps,
        vendorPartyId: dto.vendorPartyId ?? null,
        vendorInvoiceRef: dto.vendorInvoiceRef ?? null,
        contractRef: dto.contractRef ?? null,
        triggeredBy: "manual",
      })
      .returning();
    return row;
  }

  // -- The document ----------------------------------------------------------

  /** The standardised invoice, assembled. Operator view: costs and margin included. */
  @Get("invoices/:id/document")
  async document(
    @Param("id", ParseUUIDPipe) invoiceId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assembly.document(auth.tenantId, invoiceId, { commercial: true });
  }

  // -- The audit -------------------------------------------------------------

  /**
   * Run the four-way match. A write, because the findings are persisted and a
   * human acts on their status.
   */
  @RequireRoles("finance")
  @Post("invoices/:id/audit")
  async audit(@Param("id", ParseUUIDPipe) invoiceId: string, @CurrentAuth() auth: AuthContext) {
    return this.assembly.runAudit(auth.tenantId, invoiceId);
  }

  @Get("invoices/:id/exceptions")
  async invoiceExceptions(
    @Param("id", ParseUUIDPipe) invoiceId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assembly.listExceptions(auth.tenantId, invoiceId);
  }

  /** Portfolio view: every open finding across the book, not one invoice at a time. */
  @Get("billing/exceptions")
  async allExceptions(@CurrentAuth() auth: AuthContext) {
    return this.assembly.listExceptions(auth.tenantId);
  }

  @RequireRoles("finance")
  @Patch("billing/exceptions/:id")
  async resolveException(
    @Param("id", ParseUUIDPipe) exceptionId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = ResolveExceptionDto.parse(body);
    return this.assembly.resolveException(
      auth.tenantId,
      exceptionId,
      dto.status,
      dto.note ?? null,
    );
  }

  /**
   * The dispute packet, ready to send to the vendor.
   *
   * A GET because it is generated from the findings as they stand and stores
   * nothing — asking for it twice must not create two disputes.
   */
  @Get("invoices/:id/dispute-packet")
  async disputePacket(
    @Param("id", ParseUUIDPipe) invoiceId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assembly.disputePacket(auth.tenantId, invoiceId);
  }

  @Get("shipments/:id/charges")
  async shipmentCharges(
    @Param("id", ParseUUIDPipe) shipmentId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.db
      .select()
      .from(charges)
      .where(
        and(eq(charges.shipmentId, shipmentId), eq(charges.tenantId, auth.tenantId)),
      );
  }

  /**
   * Invoices with what has actually been paid against each one. The console
   * showed a total and a status but no running balance, so "how much is still
   * owed on this?" was a question the screen could not answer.
   */
  @Get("invoices")
  async list(@CurrentAuth() auth: AuthContext) {
    const rows = await this.db
      .select({
        invoice: invoices,
        paidCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint`.mapWith(Number),
      })
      .from(invoices)
      .leftJoin(payments, eq(payments.invoiceId, invoices.id))
      .where(eq(invoices.tenantId, auth.tenantId))
      .groupBy(invoices.id)
      .orderBy(desc(invoices.createdAt))
      .limit(200);

    return rows.map(({ invoice, paidCents }) => ({
      ...invoice,
      paidCents,
      outstandingCents: invoice.totalCents - paidCents,
    }));
  }

  @Get("invoices/:id/payments")
  async payments(
    @Param("id", ParseUUIDPipe) invoiceId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.billing.listPayments(invoiceId, auth.tenantId);
  }

  @RequireRoles("finance")
  @Post("invoices/:id/payments")
  async pay(
    @Param("id", ParseUUIDPipe) invoiceId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = PaymentDto.parse(body);
    return this.billing.recordPayment({
      invoiceId,
      tenantId: auth.tenantId,
      ...dto,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  /** Trade-finance dashboard feed (ontology-bridge payoff). */
  @Get("finance/views")
  async finance(@CurrentAuth() auth: AuthContext) {
    return this.billing.financeViews(auth.tenantId);
  }

  /**
   * M10: what this tenant owes the operator in platform fees — every
   * FEE-kind charge accrued against it, tenant-scoped like everything else
   * here so a partner only ever sees its own fees, never another partner's.
   */
  @Get("billing/platform-fees")
  async platformFees(@CurrentAuth() auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(charges)
      .where(and(eq(charges.tenantId, auth.tenantId), eq(charges.kind, "FEE")))
      .orderBy(desc(charges.createdAt))
      .limit(500);

    const totalsByCurrency = new Map<string, number>();
    for (const row of rows) {
      totalsByCurrency.set(
        row.currency,
        (totalsByCurrency.get(row.currency) ?? 0) + row.sellCents,
      );
    }

    return {
      charges: rows,
      totals: Array.from(totalsByCurrency.entries()).map(([currency, amountCents]) => ({
        currency,
        amountCents,
      })),
    };
  }
}
