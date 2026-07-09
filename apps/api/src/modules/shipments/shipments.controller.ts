import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  events,
  shipmentExceptions,
  shipments,
  type Db,
} from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DB } from "../db/db.module.js";

@Controller()
export class ShipmentsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("shipments")
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query("status") status?: string,
  ) {
    const conditions = [eq(shipments.tenantId, auth.tenantId)];
    if (status) {
      conditions.push(eq(shipments.status, status as never));
    }
    return this.db
      .select()
      .from(shipments)
      .where(and(...conditions))
      .orderBy(desc(shipments.createdAt))
      .limit(200);
  }

  /** Full event timeline — the "where is my stuff" feed for the portal. */
  @Get("shipments/:id/events")
  async timeline(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.db
      .select({
        eventId: events.eventId,
        type: events.type,
        occurredAt: events.occurredAt,
        payload: events.payload,
      })
      .from(events)
      .where(and(eq(events.shipmentId, id), eq(events.tenantId, auth.tenantId)))
      .orderBy(asc(events.occurredAt));
  }

  /** Ops kanban: what needs a human today. */
  @Get("ops/exceptions")
  async openExceptions(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select({
        exceptionId: shipmentExceptions.id,
        code: shipmentExceptions.code,
        detail: shipmentExceptions.detail,
        raisedAt: shipmentExceptions.raisedAt,
        shipmentId: shipments.id,
        reference: shipments.reference,
        status: shipments.status,
        origin: shipments.origin,
        destination: shipments.destination,
      })
      .from(shipmentExceptions)
      .innerJoin(shipments, eq(shipmentExceptions.shipmentId, shipments.id))
      .where(
        and(
          eq(shipmentExceptions.tenantId, auth.tenantId),
          isNull(shipmentExceptions.clearedAt),
        ),
      )
      .orderBy(asc(shipmentExceptions.raisedAt));
  }
}
