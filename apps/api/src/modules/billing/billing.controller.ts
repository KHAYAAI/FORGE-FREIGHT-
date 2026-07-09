import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { charges, invoices, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DB } from "../db/db.module.js";
import { BillingService } from "./billing.service.js";

const PaymentDto = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  paymentRef: z.string().min(1).max(100),
});

@Controller()
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(DB) private readonly db: Db,
  ) {}

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

  @Get("invoices")
  async list(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.tenantId, auth.tenantId))
      .orderBy(desc(invoices.createdAt))
      .limit(200);
  }

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
}
