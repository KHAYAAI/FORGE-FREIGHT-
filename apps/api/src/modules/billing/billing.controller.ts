import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { charges, invoices, payments, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { DB } from "../db/db.module.js";
import { BillingService } from "./billing.service.js";

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
    @Inject(DB) private readonly db: Db,
  ) {}

  @RequireRoles("finance")
  @Post("shipments/:id/invoices")
  async issue(
    @Param("id", ParseUUIDPipe) shipmentId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.billing.issueInvoices({
      shipmentId,
      tenantId: auth.tenantId,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
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
