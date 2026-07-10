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
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { tenants, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
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

  @Get("partners")
  async listPartners(@CurrentAuth() auth: AuthContext) {
    await this.assertOperator(auth.tenantId);
    return this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        platformFeeBps: tenants.platformFeeBps,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.type, "PARTNER_AGENT"))
      .orderBy(desc(tenants.createdAt));
  }

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
}
