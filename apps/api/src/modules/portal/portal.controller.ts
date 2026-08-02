import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import {
  bookings,
  cargoItems,
  consignments,
  events,
  invoices,
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
} from "../shipments/pagination.js";
import { assertCustomerTenant, isEmpty, resolveCustomerScope } from "./portal.scope.js";

/**
 * The shipper-facing portal: read-only views of the cargo a forwarder has
 * explicitly shared with this customer.
 *
 * Kept as its own controller rather than branching inside the operator
 * endpoints. The operator queries scope by `tenantId = caller`; these scope by
 * a resolved set of party ids. Mixing the two rules in one query builder is
 * how a tenant-isolation bug gets written, so they do not meet.
 *
 * Read-only by design: a customer can watch, not act. Booking, documents, and
 * customs stay with the forwarder who is liable for them.
 */
@Controller("portal")
export class PortalController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Shipments booked for this customer, newest first. */
  @Get("shipments")
  async shipments(
    @CurrentAuth() auth: AuthContext,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ): Promise<Page<typeof shipments.$inferSelect>> {
    const limit = parseLimit(limitRaw);
    const scope = await this.scopeFor(auth);
    if (isEmpty(scope)) return { rows: [], nextCursor: null, total: 0 };

    const filters = [inArray(bookings.customerId, scope.partyIds)];
    if (status) filters.push(eq(shipments.status, status as never));

    const window = [...filters];
    if (cursor) {
      const { createdAt, id } = decodeCursor(cursor);
      window.push(
        or(
          lt(shipments.createdAt, createdAt),
          and(eq(shipments.createdAt, createdAt), lt(shipments.id, id)),
        )!,
      );
    }

    const rows = await this.db
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(and(...window))
      .orderBy(desc(shipments.createdAt), desc(shipments.id))
      .limit(limit + 1);

    const totals = await this.db
      .select({ total: count() })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(and(...filters));

    const hasMore = rows.length > limit;
    const page = rows.slice(0, hasMore ? limit : rows.length).map((r) => r.shipment);
    const last = page[page.length - 1];

    return {
      rows: page,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      total: totals[0]?.total ?? 0,
    };
  }

  /**
   * A shipment with the cargo detail the customer themselves declared —
   * description, packaging, weights, collection point, port of exit and how
   * urgent they said it was. This is their own information coming back to
   * them, so none of it is withheld; what stays out is the forwarder's cost
   * build-up, which lives on the charges and never on the consignment.
   */
  @Get("shipments/:id")
  async shipment(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    const row = await this.ownedShipment(auth, id);
    if (!row) return null;
    if (!row.consignmentId) return { ...row, consignment: null };

    const [consignment] = await this.db
      .select()
      .from(consignments)
      .where(eq(consignments.id, row.consignmentId));
    if (!consignment) return { ...row, consignment: null };

    const items = await this.db
      .select()
      .from(cargoItems)
      .where(eq(cargoItems.consignmentId, consignment.id))
      .orderBy(asc(cargoItems.description));

    return { ...row, consignment: { ...consignment, items } };
  }

  /**
   * The "where is my cargo" feed. Scoped by walking from the shipment the
   * customer is proven to own — never by the tenant on the event row, which
   * belongs to the forwarder.
   */
  @Get("shipments/:id/events")
  async timeline(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    const shipment = await this.ownedShipment(auth, id);
    if (!shipment) return [];

    const rows = await this.db
      .select({
        eventId: events.eventId,
        type: events.type,
        occurredAt: events.occurredAt,
        payload: events.payload,
      })
      .from(events)
      .where(eq(events.shipmentId, id))
      .orderBy(asc(events.occurredAt))
      .limit(500);

    // Financial events are the forwarder's business with its carriers and its
    // own margin; a customer sees movement, not cost build-up.
    return rows.filter((row) => !row.type.startsWith("charge.") && row.type !== "quote.issued");
  }

  /** Invoices addressed to this customer. */
  @Get("invoices")
  async invoices(@CurrentAuth() auth: AuthContext) {
    const scope = await this.scopeFor(auth);
    if (isEmpty(scope)) return [];

    return this.db
      .select()
      .from(invoices)
      .where(inArray(invoices.customerId, scope.partyIds))
      .orderBy(desc(invoices.createdAt))
      .limit(200);
  }

  // --- internals ----------------------------------------------------------

  private async scopeFor(auth: AuthContext) {
    await assertCustomerTenant(this.db, auth.tenantId);
    return resolveCustomerScope(this.db, auth.tenantId);
  }

  /**
   * A shipment by id, but only if it was booked for one of this customer's
   * parties. Returns undefined rather than throwing so callers decide between
   * 404 and an empty list — and so a probing caller cannot tell the difference
   * between "does not exist" and "exists but is someone else's".
   */
  private async ownedShipment(auth: AuthContext, id: string) {
    const scope = await this.scopeFor(auth);
    if (isEmpty(scope)) return undefined;

    const [row] = await this.db
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(and(eq(shipments.id, id), inArray(bookings.customerId, scope.partyIds)));
    return row?.shipment;
  }
}
