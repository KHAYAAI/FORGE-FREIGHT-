import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parties, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DB } from "../db/db.module.js";
import { ScreeningService } from "./screening.service.js";

const CreatePartyDto = z.object({
  name: z.string().min(2).max(200),
  country: z.string().length(2).toUpperCase().optional(),
  address: z.string().max(500).optional(),
  taxId: z.string().max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
});

@Controller("parties")
export class PartiesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly screening: ScreeningService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const dto = CreatePartyDto.parse(body);
    const [party] = await this.db
      .insert(parties)
      .values({
        tenantId: auth.tenantId,
        name: dto.name,
        country: dto.country ?? null,
        address: dto.address ?? null,
        taxId: dto.taxId ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
      })
      .returning();

    // Screen on creation — non-negotiable, every party, every time.
    const outcome = await this.screening.screenParty({
      partyId: party!.id,
      name: party!.name,
      country: party!.country,
      tenantId: auth.tenantId,
    });

    return { ...party, screening: outcome };
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select()
      .from(parties)
      .where(eq(parties.tenantId, auth.tenantId))
      .orderBy(desc(parties.createdAt))
      .limit(500);
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    const [party] = await this.db
      .select()
      .from(parties)
      .where(eq(parties.id, id));
    if (!party || party.tenantId !== auth.tenantId) return null;
    return party;
  }
}
