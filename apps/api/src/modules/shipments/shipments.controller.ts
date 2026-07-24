import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import {
  events,
  shipmentExceptions,
  shipments,
  type Db,
} from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DB } from "../db/db.module.js";
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
  type Page,
} from "./pagination.js";

/** Statuses that no longer represent freight in motion. */
const SETTLED = ["DELIVERED", "CANCELLED"] as const;

@Controller()
export class ShipmentsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One page of the book, newest first, with a keyset cursor.
   *
   * This used to be a bare `limit(200)`: past two hundred shipments an
   * operator silently saw a truncated list with no indication anything was
   * missing, and every count derived from it under-reported. The response now
   * carries the total, so a short page is visibly a page and not the whole
   * book.
   */
  @Get("shipments")
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ): Promise<Page<typeof shipments.$inferSelect>> {
    const limit = parseLimit(limitRaw);

    const filters = [eq(shipments.tenantId, auth.tenantId)];
    if (status) filters.push(eq(shipments.status, status as never));

    const window = [...filters];
    if (cursor) {
      const { createdAt, id } = decodeCursor(cursor);
      // Strictly after the cursor row in (createdAt DESC, id DESC) order.
      window.push(
        or(
          lt(shipments.createdAt, createdAt),
          and(eq(shipments.createdAt, createdAt), lt(shipments.id, id)),
        )!,
      );
    }

    // One extra row tells us whether a further page exists without a second
    // count query against the windowed predicate.
    const rows = await this.db
      .select()
      .from(shipments)
      .where(and(...window))
      .orderBy(desc(shipments.createdAt), desc(shipments.id))
      .limit(limit + 1);

    const totals = await this.db
      .select({ total: count() })
      .from(shipments)
      .where(and(...filters));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      rows: page,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      total: totals[0]?.total ?? 0,
    };
  }

  /**
   * Lane-level aggregate of freight still in motion — what the corridor map
   * draws. Computed in the database over every matching shipment rather than
   * summarised from a page, so the map doesn't quietly shrink to whatever the
   * first page happened to contain.
   */
  @Get("ops/corridors")
  async corridors(@CurrentAuth() auth: AuthContext) {
    return this.db
      .select({
        origin: shipments.origin,
        destination: shipments.destination,
        n: countDistinct(shipments.id),
        exceptions: countDistinct(shipmentExceptions.id),
      })
      .from(shipments)
      .leftJoin(
        shipmentExceptions,
        and(
          eq(shipmentExceptions.shipmentId, shipments.id),
          isNull(shipmentExceptions.clearedAt),
        ),
      )
      .where(
        and(
          eq(shipments.tenantId, auth.tenantId),
          notInArray(shipments.status, [...SETTLED] as never[]),
        ),
      )
      .groupBy(shipments.origin, shipments.destination)
      .orderBy(desc(countDistinct(shipments.id)));
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
