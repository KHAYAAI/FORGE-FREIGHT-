import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  bookings,
  events,
  shipmentExceptions,
  shipments,
  type Db,
} from "@forge-freight/db";
import {
  CarrierConfirmationRequested,
  makeEvent,
  ShipmentExceptionRaised,
} from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { appendEventIdempotent } from "../db/event-store.js";
import {
  nextAction,
  requestSourceRef,
  type UnconfirmedBooking,
} from "./carrier-confirmation-rules.js";

export interface ConfirmationSweepResult {
  scanned: number;
  requested: number;
  escalated: number;
  /** Requests the idempotency index rejected — a retry doing no harm. */
  duplicates: number;
  actions: { reference: string; kind: string; attempt?: number }[];
}

/**
 * Chases carriers for confirmations on bookings we have already opened.
 *
 * The retry ladder itself lives in `carrier-confirmation-rules.ts` as a pure
 * function. This is the part that needs a database: find the unconfirmed
 * bookings, count what has already been sent, and append the next event.
 *
 * Nothing here calls a carrier. The event this emits is what n8n picks up to
 * send the actual email — the Freight Core records the intent and the count,
 * the integration layer does the talking, and the carrier's reply comes back
 * through the API. Keeping the ladder on this side means the retry state is in
 * the event log rather than inside a workflow engine, so it survives anything
 * that happens to the scheduler.
 */
@Injectable()
export class CarrierConfirmationService {
  private readonly logger = new Logger(CarrierConfirmationService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async sweep(now: Date = new Date()): Promise<ConfirmationSweepResult> {
    const candidates = await this.loadUnconfirmed();
    const result: ConfirmationSweepResult = {
      scanned: candidates.length,
      requested: 0,
      escalated: 0,
      duplicates: 0,
      actions: [],
    };

    for (const b of candidates) {
      const action = nextAction(b, now);
      if (!action) continue;

      if (action.kind === "REQUEST") {
        const event = makeEvent({
          definition: CarrierConfirmationRequested,
          tenantId: action.tenantId,
          actor: { kind: "SYSTEM", id: "carrier-confirmation" },
          shipmentId: action.shipmentId,
          // Derived from the attempt, never the clock: a workflow that runs
          // this step twice produces the same key, and the second write is
          // rejected rather than the carrier being asked twice.
          sourceRef: requestSourceRef(action.shipmentId, action.attempt),
          payload: {
            bookingId: action.bookingId,
            attempt: action.attempt,
            unconfirmedHours: action.unconfirmedHours,
          },
        });
        if (await appendEventIdempotent(this.db, event)) {
          result.requested++;
          result.actions.push({
            reference: action.reference,
            kind: "REQUEST",
            attempt: action.attempt,
          });
        } else {
          result.duplicates++;
        }
        continue;
      }

      const event = makeEvent({
        definition: ShipmentExceptionRaised,
        tenantId: action.tenantId,
        actor: { kind: "SYSTEM", id: "carrier-confirmation" },
        shipmentId: action.shipmentId,
        payload: { code: "BOOKING_ROLLED", detail: action.detail },
      });
      await appendEventIdempotent(this.db, event);
      result.escalated++;
      result.actions.push({ reference: action.reference, kind: "ESCALATE" });
    }

    if (result.requested || result.escalated) {
      this.logger.log(
        `Carrier confirmation: ${result.requested} chased, ` +
          `${result.escalated} escalated, ${result.duplicates} already sent`,
      );
    }
    return result;
  }

  /**
   * Shipments opened internally that the carrier has not confirmed, with the
   * chase history the ladder needs.
   *
   * `attemptsMade` is counted from the event log rather than stored on a row.
   * The log is already the record of what happened, and a counter column would
   * be a second copy of it that could disagree.
   */
  private async loadUnconfirmed(): Promise<UnconfirmedBooking[]> {
    const rows = await this.db
      .select({
        shipmentId: shipments.id,
        tenantId: shipments.tenantId,
        bookingId: shipments.bookingId,
        reference: shipments.reference,
        bookedAt: shipments.createdAt,
        attemptsMade: sql<number>`(
          select count(*) from ${events} e
          where e.shipment_id = ${shipments.id}
            and e.type = ${CarrierConfirmationRequested.type}
        )`,
        lastAttemptAt: sql<Date | null>`(
          select max(e.occurred_at) from ${events} e
          where e.shipment_id = ${shipments.id}
            and e.type = ${CarrierConfirmationRequested.type}
        )`,
        escalated: sql<boolean>`exists (
          select 1 from ${shipmentExceptions} x
          where x.shipment_id = ${shipments.id}
            and x.code = 'BOOKING_ROLLED'
            and x.cleared_at is null
        )`,
      })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(
        and(
          eq(shipments.status, "BOOKED"),
          isNull(bookings.carrierBookingRef),
        ),
      );

    return rows.map((r) => ({
      shipmentId: r.shipmentId,
      tenantId: r.tenantId,
      bookingId: r.bookingId,
      reference: r.reference,
      bookedAt: new Date(r.bookedAt),
      attemptsMade: Number(r.attemptsMade ?? 0),
      lastAttemptAt: r.lastAttemptAt ? new Date(r.lastAttemptAt) : null,
      escalated: Boolean(r.escalated),
    }));
  }
}
