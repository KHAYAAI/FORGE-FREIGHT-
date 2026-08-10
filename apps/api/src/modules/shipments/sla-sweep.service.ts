import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  events,
  shipmentExceptions,
  shipments,
  type Db,
} from "@forge-freight/db";
import { makeEvent, ShipmentExceptionRaised } from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import {
  detectBreaches,
  SLA_DEFAULTS,
  type ShipmentSlaState,
  type SlaThresholds,
} from "./sla-rules.js";

/** Statuses that no longer represent freight in motion. */
const SETTLED = ["DELIVERED", "CANCELLED"] as const;

/** Milestone types the rules read, by the meaning each carries. */
const DEPARTED = ["vessel.departed"];
const ARRIVED = ["vessel.arrived", "container.discharged"];
const RELEASED = ["entry.released"];

export interface SweepResult {
  scanned: number;
  raised: number;
  breaches: { reference: string; code: string; detail: string }[];
}

/**
 * Finds shipments that have passed an SLA without the milestone that should
 * have cleared it, and raises one exception for each.
 *
 * This replaces the per-shipment Temporal workflow, which kept a process alive
 * for the length of a voyage to hold three booleans that the event log already
 * recorded durably. A sweep cannot drift from the truth the way a second copy
 * of state can: it reads the log every time it runs.
 *
 * Idempotent by construction, so the schedule that drives it does not have to
 * be reliable — a missed run costs an hour of notice, and a double run costs
 * nothing. That is the same trade `OverdueSweepService` already makes.
 */
@Injectable()
export class SlaSweepService {
  private readonly logger = new Logger(SlaSweepService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Assemble each in-flight shipment's position from the event log, apply the
   * rules, and append an exception event for every new breach.
   *
   * The events are appended rather than the `shipment_exceptions` rows written
   * directly: the table is a projection, and `lifecycle-projector` owns it.
   * Writing the row here would put two writers on one read model.
   */
  async sweep(
    now: Date = new Date(),
    thresholds: SlaThresholds = SLA_DEFAULTS,
  ): Promise<SweepResult> {
    const states = await this.loadStates();
    const breaches = states.flatMap((s) => detectBreaches(s, now, thresholds));

    if (breaches.length > 0) {
      await this.db.insert(events).values(
        breaches.map((b) => {
          const event = makeEvent({
            definition: ShipmentExceptionRaised,
            tenantId: b.tenantId,
            actor: { kind: "SYSTEM", id: "sla-sweep" },
            shipmentId: b.shipmentId,
            payload: { code: b.code, detail: b.detail },
          });
          return {
            eventId: event.eventId,
            shipmentId: event.shipmentId,
            tenantId: event.tenantId,
            type: event.type,
            version: event.version,
            occurredAt: new Date(event.occurredAt),
            recordedAt: new Date(event.recordedAt),
            actor: event.actor,
            payload: event.payload,
          };
        }),
      );
      this.logger.log(
        `SLA sweep raised ${breaches.length} exception(s) across ${states.length} shipment(s)`,
      );
    }

    return {
      scanned: states.length,
      raised: breaches.length,
      breaches: breaches.map((b) => ({
        reference: b.reference,
        code: b.code,
        detail: b.detail,
      })),
    };
  }

  /**
   * One row per in-flight shipment: when it was booked, the earliest of each
   * milestone that matters, the planned transit, and which exception codes are
   * already open against it.
   *
   * Earliest rather than latest: a carrier that reports a departure twice has
   * still only departed once, and the first report is when it happened.
   */
  private async loadStates(): Promise<ShipmentSlaState[]> {
    const milestone = (types: string[]) =>
      sql<Date | null>`min(${events.occurredAt}) filter (
        where ${inArray(events.type, types)}
      )`;

    const rows = await this.db
      .select({
        shipmentId: shipments.id,
        tenantId: shipments.tenantId,
        reference: shipments.reference,
        bookedAt: shipments.createdAt,
        departedAt: milestone(DEPARTED),
        arrivedAt: milestone(ARRIVED),
        releasedAt: milestone(RELEASED),
        openCodes: sql<
          string[]
        >`coalesce(array_agg(distinct ${shipmentExceptions.code}) filter (
          where ${isNull(shipmentExceptions.clearedAt)}
        ), '{}')`,
        /**
         * Always null, which means phase 2 uses the fallback transit budget.
         *
         * This is deliberate parity, not an oversight: `bookings.service.ts`
         * starts the Temporal workflow with `transitDays: null` hardcoded, so
         * the workflow has never used a real per-lane transit either. Wiring
         * the quote's rate-card transit through is a genuine improvement, but
         * making it here would mean the old and new paths disagree — and this
         * slice is only trustworthy if they agree. Tracked as follow-up.
         */
        transitDays: sql<number | null>`null`,
      })
      .from(shipments)
      .leftJoin(events, eq(events.shipmentId, shipments.id))
      .leftJoin(
        shipmentExceptions,
        eq(shipmentExceptions.shipmentId, shipments.id),
      )
      .where(notInArray(shipments.status, [...SETTLED]))
      .groupBy(
        shipments.id,
        shipments.tenantId,
        shipments.reference,
        shipments.createdAt,
      );

    return rows.map((r) => ({
      shipmentId: r.shipmentId,
      tenantId: r.tenantId,
      reference: r.reference,
      bookedAt: new Date(r.bookedAt),
      departedAt: r.departedAt ? new Date(r.departedAt) : null,
      arrivedAt: r.arrivedAt ? new Date(r.arrivedAt) : null,
      releasedAt: r.releasedAt ? new Date(r.releasedAt) : null,
      transitDays: r.transitDays,
      openCodes: r.openCodes ?? [],
    }));
  }
}
