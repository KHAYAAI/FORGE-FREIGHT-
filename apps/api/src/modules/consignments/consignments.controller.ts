import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { COMMERCIAL_TENANTS, requireTenantType } from "../auth/tenant-type.js";
import { DB } from "../db/db.module.js";
import { CreateConsignmentDto, UpdateConsignmentDto } from "./consignments.dto.js";
import { ConsignmentsService } from "./consignments.service.js";
import {
  CARGO_TYPE_UPLIFT_BPS,
  URGENCY_PROFILE,
  VOLUMETRIC_DIVISOR_CM3_PER_KG,
  computeConsignmentTotals,
  handlingRequirements,
  type TransportMode,
} from "./packing.js";

const MODES = ["OCEAN", "AIR", "ROAD", "RAIL"] as const;

/**
 * What is actually being shipped: the packing list, where it is collected,
 * which port it leaves through, and how urgently it must move.
 *
 * Recording this is not paperwork — chargeable weight, handling uplift and the
 * service-level transit ceiling all come from here, so a quote raised without
 * it is a guess.
 */
@Controller("consignments")
export class ConsignmentsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ConsignmentsService) private readonly consignments: ConsignmentsService,
  ) {}

  private async assertCommercial(auth: AuthContext) {
    await requireTenantType(
      this.db,
      auth.tenantId,
      COMMERCIAL_TENANTS,
      "Consignments belong to the tenant moving the freight.",
    );
  }

  /**
   * The vocabulary the console builds its form from, so the two cannot drift.
   * Public to any authenticated caller — these are reference values, not data.
   */
  @Get("reference")
  reference() {
    return {
      packageTypes: [
        { code: "PALLET", label: "Pallet" },
        { code: "CARTON", label: "Carton" },
        { code: "CRATE", label: "Crate" },
        { code: "DRUM", label: "Drum" },
        { code: "BAG", label: "Bag / sack" },
        { code: "BALE", label: "Bale" },
        { code: "ROLL", label: "Roll" },
        { code: "IBC", label: "IBC tote" },
        { code: "BULK", label: "Bulk / unpackaged" },
        { code: "LOOSE", label: "Loose pieces" },
      ],
      cargoTypes: Object.entries(CARGO_TYPE_UPLIFT_BPS).map(([code, upliftBps]) => ({
        code,
        label: code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
        upliftBps,
      })),
      urgencies: Object.entries(URGENCY_PROFILE).map(([code, p]) => ({ code, ...p })),
      volumetricDivisors: VOLUMETRIC_DIVISOR_CM3_PER_KG,
    };
  }

  /**
   * Price the packing list without saving anything.
   *
   * The console calls this as the form is filled in, so a shipper sees the
   * chargeable weight move as they type — the moment volume overtakes mass is
   * the moment the price stops matching their intuition, and hiding it until
   * the quote arrives is how disputes start.
   */
  @Post("measure")
  measure(@Body() body: unknown) {
    const dto = CreateConsignmentDto.parse(body);
    const mode = MODES.includes((body as { mode?: TransportMode })?.mode as TransportMode)
      ? ((body as { mode: TransportMode }).mode)
      : "OCEAN";
    const totals = computeConsignmentTotals(dto.items, mode);
    return {
      mode,
      divisorCm3PerKg: VOLUMETRIC_DIVISOR_CM3_PER_KG[mode],
      ...totals,
      requirements: handlingRequirements(dto),
    };
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query("limit") limit?: string) {
    await this.assertCommercial(auth);
    return this.consignments.list(auth.tenantId, Math.min(Number(limit) || 100, 200));
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    await this.assertCommercial(auth);
    return this.consignments.get(auth.tenantId, id);
  }

  @RequireRoles("ops")
  @Post()
  async create(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Query("mode") mode?: TransportMode,
  ) {
    await this.assertCommercial(auth);
    const dto = CreateConsignmentDto.parse(body);
    return this.consignments.create(
      auth.tenantId,
      dto,
      MODES.includes(mode as TransportMode) ? (mode as TransportMode) : "OCEAN",
    );
  }

  @RequireRoles("ops")
  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.assertCommercial(auth);
    return this.consignments.update(auth.tenantId, id, UpdateConsignmentDto.parse(body));
  }
}
