import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { and, count, desc, eq, inArray, sum } from "drizzle-orm";
import { z } from "zod";
import { charges, shipments, tenants, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { DB } from "../db/db.module.js";

const CreatePartnerDto = z.object({
  name: z.string().min(2).max(200),
  /** Platform fee on the partner's freight, basis points (e.g. 500 = 5%). */
  platformFeeBps: z.number().int().min(0).max(10_000).default(0),
});

const UpdateFeeRateDto = z.object({
  platformFeeBps: z.number().int().min(0).max(10_000),
});

/**
 * M10: operator-only tenant administration — onboarding franchise partners
 * and setting the platform fee rate BillingAccrual charges them on freight.
 * Every route here is cross-tenant by nature (an operator managing OTHER
 * tenants), so it can't rely on the usual "queries scoped to auth.tenantId"
 * isolation — each handler explicitly checks the caller's own tenant is
 * type OPERATOR before touching anything.
 */
@Controller("tenants")
export class TenantsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async assertOperator(tenantId: string): Promise<void> {
    const [caller] = await this.db
      .select({ type: tenants.type })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (caller?.type !== "OPERATOR") {
      throw new ForbiddenException("Only the operator tenant can manage partners");
    }
  }

  /**
   * Partners plus the volume/revenue proof-points the infrastructure pitch
   * needs — "who else is on this platform and how much do they move" is a
   * different question from just listing tenant rows.
   */
  @Get("partners")
  async listPartners(@CurrentAuth() auth: AuthContext) {
    await this.assertOperator(auth.tenantId);

    const partners = await this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        platformFeeBps: tenants.platformFeeBps,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.type, "PARTNER_AGENT"))
      .orderBy(desc(tenants.createdAt));

    if (partners.length === 0) return [];
    const partnerIds = partners.map((p) => p.id);

    const [shipmentCounts, feeRevenue] = await Promise.all([
      this.db
        .select({ tenantId: shipments.tenantId, n: count() })
        .from(shipments)
        .where(inArray(shipments.tenantId, partnerIds))
        .groupBy(shipments.tenantId),
      this.db
        .select({
          tenantId: charges.tenantId,
          currency: charges.currency,
          totalCents: sum(charges.sellCents).mapWith(Number),
        })
        .from(charges)
        .where(and(inArray(charges.tenantId, partnerIds), eq(charges.kind, "FEE")))
        .groupBy(charges.tenantId, charges.currency),
    ]);

    const shipmentsByTenant = new Map(shipmentCounts.map((r) => [r.tenantId, r.n]));
    const revenueByTenant = new Map<string, { currency: string; amountCents: number }[]>();
    for (const row of feeRevenue) {
      const list = revenueByTenant.get(row.tenantId) ?? [];
      list.push({ currency: row.currency, amountCents: row.totalCents });
      revenueByTenant.set(row.tenantId, list);
    }

    return partners.map((p) => ({
      ...p,
      shipmentCount: shipmentsByTenant.get(p.id) ?? 0,
      feeRevenue: revenueByTenant.get(p.id) ?? [],
    }));
  }

  @RequireRoles("admin")
  @Post("partners")
  async createPartner(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    await this.assertOperator(auth.tenantId);
    const dto = CreatePartnerDto.parse(body);
    const [partner] = await this.db
      .insert(tenants)
      .values({ type: "PARTNER_AGENT", name: dto.name, platformFeeBps: dto.platformFeeBps })
      .returning();
    return partner;
  }

  @RequireRoles("admin")
  @Patch("partners/:id/fee-rate")
  async updateFeeRate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertOperator(auth.tenantId);
    const dto = UpdateFeeRateDto.parse(body);
    const [partner] = await this.db
      .update(tenants)
      .set({ platformFeeBps: dto.platformFeeBps })
      .where(eq(tenants.id, id))
      .returning();
    return partner ?? null;
  }

  /** The calling tenant's own record — lets the web app show "you are a partner, fee is X%". */
  @Get("me")
  async me(@CurrentAuth() auth: AuthContext) {
    const [tenant] = await this.db
      .select({
        id: tenants.id,
        type: tenants.type,
        name: tenants.name,
        platformFeeBps: tenants.platformFeeBps,
      })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId));
    return tenant ?? null;
  }

  /**
   * Model 2 proof-of-concept data: total trade volume across EVERY tenant
   * on the platform, aggregated by corridor. This is deliberately shaped
   * like a government Track-and-Trace corridor dashboard — lane + volume +
   * status, never customer-level detail — because that's the exact claim
   * "we can be the national visibility layer" depends on being able to
   * back up with a real query, not a slide.
   */
  @Get("network")
  async network(@CurrentAuth() auth: AuthContext) {
    await this.assertOperator(auth.tenantId);

    const [tenantCounts, corridorVolume, statusVolume, totalFeeRevenue] = await Promise.all([
      this.db
        .select({ type: tenants.type, n: count() })
        .from(tenants)
        .groupBy(tenants.type),
      this.db
        .select({
          origin: shipments.origin,
          destination: shipments.destination,
          n: count(),
        })
        .from(shipments)
        .groupBy(shipments.origin, shipments.destination)
        .orderBy(desc(count()))
        .limit(20),
      this.db
        .select({ status: shipments.status, n: count() })
        .from(shipments)
        .groupBy(shipments.status),
      this.db
        .select({ currency: charges.currency, totalCents: sum(charges.sellCents).mapWith(Number) })
        .from(charges)
        .where(eq(charges.kind, "FEE"))
        .groupBy(charges.currency),
    ]);

    const [totalShipments] = await this.db.select({ n: count() }).from(shipments);

    return {
      tenantsByType: tenantCounts,
      totalShipments: totalShipments?.n ?? 0,
      corridorVolume,
      shipmentsByStatus: statusVolume,
      platformFeeRevenue: totalFeeRevenue,
    };
  }
}
