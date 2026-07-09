import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { customsEntries, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DB } from "../db/db.module.js";
import { ClassificationService } from "./classification.service.js";
import { CustomsService } from "./customs.service.js";

const CreateEntryDto = z.object({
  shipmentId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        description: z.string().min(3).max(500),
        customsValueCents: z.number().int().positive(),
        hsCode: z.string().regex(/^\d{4}\.\d{2}(\.\d{2})?$/).optional(),
        dutyRateBps: z.number().int().min(0).max(10_000).optional(),
        sacuOrigin: z.boolean().optional(),
      }),
    )
    .min(1),
});

const OutcomeDto = z.object({
  outcome: z.enum(["QUERY", "RELEASED", "STOPPED"]),
  detail: z.string().max(2000).optional(),
  releaseRef: z.string().max(100).optional(),
});

const ConfirmLineDto = z.object({
  lineId: z.string().uuid(),
  hsCode: z.string().regex(/^\d{4}\.\d{2}(\.\d{2})?$/).optional(),
});

@Controller("customs")
export class CustomsController {
  constructor(
    @Inject(CustomsService) private readonly customs: CustomsService,
    @Inject(ClassificationService) private readonly classification: ClassificationService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Classification candidates with confidence — the clearing-desk helper. */
  @Get("classify")
  classify(@Query("q") q: string) {
    return this.classification.classify(q ?? "");
  }

  /** Tenant-scoped entry list — the customs workspace landing view. */
  @Get("entries")
  async list(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select()
      .from(customsEntries)
      .where(eq(customsEntries.tenantId, auth.tenantId))
      .orderBy(desc(customsEntries.createdAt))
      .limit(200);
  }

  /** Most recent entry for a shipment — the "related" link off the shipment page. */
  @Get("entries/by-shipment/:shipmentId")
  async byShipment(
    @Param("shipmentId", ParseUUIDPipe) shipmentId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    const [entry] = await this.db
      .select()
      .from(customsEntries)
      .where(
        and(eq(customsEntries.shipmentId, shipmentId), eq(customsEntries.tenantId, auth.tenantId)),
      )
      .orderBy(desc(customsEntries.createdAt))
      .limit(1);
    return entry ?? null;
  }

  @Post("entries")
  async create(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const dto = CreateEntryDto.parse(body);
    return this.customs.createEntry({
      ...dto,
      tenantId: auth.tenantId,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  @Get("entries/:id")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.customs.getEntry(id, auth.tenantId);
  }

  @Post("entries/:id/confirm-line")
  async confirmLine(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = ConfirmLineDto.parse(body);
    return this.customs.confirmLine({
      entryId: id,
      tenantId: auth.tenantId,
      ...dto,
    });
  }

  @Post("entries/:id/prepare")
  async prepare(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.customs.prepare(id, auth.tenantId, {
      kind: "USER",
      id: auth.userId,
      tenantId: auth.tenantId,
    });
  }

  @Post("entries/:id/submit")
  async submit(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.customs.submit(id, auth.tenantId, {
      kind: "USER",
      id: auth.userId,
      tenantId: auth.tenantId,
    });
  }

  @Post("entries/:id/outcome")
  async outcome(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = OutcomeDto.parse(body);
    return this.customs.recordOutcome({
      entryId: id,
      tenantId: auth.tenantId,
      ...dto,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  @Get("entries/:id/bureau-payload")
  async bureauPayload(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.customs.bureauPayload(id, auth.tenantId);
  }
}
