import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parties, tenants, type Db } from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { DB } from "../db/db.module.js";
import { ScreeningService } from "./screening.service.js";

const LinkTenantDto = z.object({
  /** Null revokes portal access for this party. */
  customerTenantId: z.string().uuid().nullable(),
});

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
    @Inject(ScreeningService) private readonly screening: ScreeningService,
  ) {}

  /** Every creation triggers a yente screening call — throttle harder than reads. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
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

  /**
   * Grants (or revokes) portal access for a party, by pointing it at a
   * CUSTOMER tenant. This is the only switch that lets data cross a tenant
   * boundary anywhere in the platform, so it is deliberately explicit: a
   * forwarder decides, per party, that this shipper may watch its own cargo.
   *
   * Pass `customerTenantId: null` to revoke.
   */
  @RequireRoles("admin")
  @Post(":id/customer-tenant")
  async linkCustomerTenant(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = LinkTenantDto.parse(body);

    const [party] = await this.db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, id), eq(parties.tenantId, auth.tenantId)));
    if (!party) throw new NotFoundException("Party not found");

    if (dto.customerTenantId) {
      const [target] = await this.db
        .select({ type: tenants.type })
        .from(tenants)
        .where(eq(tenants.id, dto.customerTenantId));
      if (!target) throw new NotFoundException("Tenant not found");
      // Pointing a party at an operator or partner tenant would hand that
      // tenant a second, weaker way to read shipments — the portal scope —
      // alongside its own. Only CUSTOMER tenants may be linked.
      if (target.type !== "CUSTOMER") {
        throw new UnprocessableEntityException(
          `Only CUSTOMER tenants can be linked to a party; that tenant is ${target.type}.`,
        );
      }
    }

    const [updated] = await this.db
      .update(parties)
      .set({ customerTenantId: dto.customerTenantId })
      .where(and(eq(parties.id, id), eq(parties.tenantId, auth.tenantId)))
      .returning();
    return updated;
  }
}
