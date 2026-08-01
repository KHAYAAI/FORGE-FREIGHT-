import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { COMMERCIAL_TENANTS, requireTenantType } from "../auth/tenant-type.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { DB } from "../db/db.module.js";
import {
  CreateMarginRuleDto,
  CreateRateCardDto,
  ReplaceSurchargesDto,
  UpdateMarginRuleDto,
  UpdateRateCardDto,
} from "./rates.dto.js";
import { RatesService } from "./rates.service.js";

const NOT_COMMERCIAL = "Rate cards belong to the tenant that sells the freight.";

/**
 * Rate card and margin rule administration.
 *
 * Previously the only way to price a new lane was an operator writing INSERTs
 * against `rate_cards` by hand — which meant a partner agent running on these
 * rails could not onboard its own lanes at all. Both commercial tenant types
 * get these routes, each scoped to its own tenant: buy prices are the sharpest
 * commercial secret a forwarder has.
 */
@Controller("rates")
export class RatesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RatesService) private readonly rates: RatesService,
  ) {}

  private async assertCommercial(auth: AuthContext): Promise<void> {
    await requireTenantType(this.db, auth.tenantId, COMMERCIAL_TENANTS, NOT_COMMERCIAL);
  }

  @Get("cards")
  async listCards(
    @CurrentAuth() auth: AuthContext,
    @Query("origin") origin?: string,
    @Query("destination") destination?: string,
    @Query("mode") mode?: "OCEAN" | "AIR" | "ROAD" | "RAIL",
    @Query("active") active?: string,
  ) {
    await this.assertCommercial(auth);
    return this.rates.listCards({
      tenantId: auth.tenantId,
      origin: origin?.trim().toUpperCase() || undefined,
      destination: destination?.trim().toUpperCase() || undefined,
      mode,
      // Default to everything: an expired card is exactly what an operator
      // opens this screen to find and renew.
      activeAt: active === "true" ? new Date() : undefined,
    });
  }

  @Get("cards/:id")
  async getCard(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    return this.rates.getCard(auth.tenantId, id);
  }

  @RequireRoles("admin")
  @Post("cards")
  async createCard(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    return this.rates.createCard(auth.tenantId, CreateRateCardDto.parse(body));
  }

  @RequireRoles("admin")
  @Patch("cards/:id")
  async updateCard(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertCommercial(auth);
    return this.rates.updateCard(auth.tenantId, id, UpdateRateCardDto.parse(body));
  }

  /** Replaces the card's whole surcharge set — see the note on the service method. */
  @RequireRoles("admin")
  @Put("cards/:id/surcharges")
  async replaceSurcharges(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertCommercial(auth);
    const dto = ReplaceSurchargesDto.parse(body);
    return this.rates.replaceSurcharges(auth.tenantId, id, dto.surcharges);
  }

  @RequireRoles("admin")
  @Delete("cards/:id")
  @HttpCode(204)
  async deleteCard(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    await this.rates.deleteCard(auth.tenantId, id);
  }

  @Get("margin-rules")
  async listMarginRules(@CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    return this.rates.listMarginRules(auth.tenantId);
  }

  @RequireRoles("admin")
  @Post("margin-rules")
  async createMarginRule(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    return this.rates.createMarginRule(auth.tenantId, CreateMarginRuleDto.parse(body));
  }

  @RequireRoles("admin")
  @Patch("margin-rules/:id")
  async updateMarginRule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertCommercial(auth);
    return this.rates.updateMarginRule(auth.tenantId, id, UpdateMarginRuleDto.parse(body));
  }

  @RequireRoles("admin")
  @Delete("margin-rules/:id")
  @HttpCode(204)
  async deleteMarginRule(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertCommercial(auth);
    await this.rates.deleteMarginRule(auth.tenantId, id);
  }
}
