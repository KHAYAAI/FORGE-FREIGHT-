import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  bookings,
  containers,
  legs,
  shipments,
  type Db,
} from "@forge-freight/db";
import { makeEvent } from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { appendEventIdempotent } from "../db/event-store.js";
import type { CanonicalEmission, ShipmentMatch } from "./adapter.js";

const ACTIVE_STATUSES = [
  "BOOKED",
  "IN_TRANSIT",
  "AT_DESTINATION_PORT",
  "CUSTOMS",
  "ON_DELIVERY",
] as const;

export interface IngestResult {
  received: number;
  appended: number;
  /** Redeliveries dropped by the (type, sourceRef) idempotency index. */
  duplicates: number;
  unmatched: number;
}

/**
 * Takes adapter emissions, resolves each to a shipment, and appends
 * idempotent canonical events. Adapters never touch projections; the
 * lifecycle projector does that from the events this service writes.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async ingest(emissions: CanonicalEmission[], source: string): Promise<IngestResult> {
    let appended = 0;
    let duplicates = 0;
    let unmatched = 0;

    for (const emission of emissions) {
      const resolved = await this.resolve(emission.match);
      if (!resolved) {
        unmatched++;
        this.logger.warn(
          `No shipment for ${emission.definition.type} via ${JSON.stringify(emission.match)}`,
        );
        continue;
      }

      // Position-ping events carry a legId the adapter can't know in
      // advance — filled in here from the resolved match, same as Traccar.
      const needsLegId =
        emission.definition.type === "road.position_reported" ||
        emission.definition.type === "vessel.position_reported";
      const payload = needsLegId
        ? { ...(emission.payload as Record<string, unknown>), legId: resolved.legId }
        : emission.payload;

      const event = makeEvent({
        definition: emission.definition,
        tenantId: resolved.tenantId,
        actor: { kind: "ADAPTER", id: source },
        shipmentId: resolved.shipmentId,
        occurredAt: emission.occurredAt,
        sourceRef: emission.sourceRef,
        payload: payload as never,
      });
      if (await appendEventIdempotent(this.db, event)) appended++;
      else duplicates++;
    }

    return { received: emissions.length, appended, duplicates, unmatched };
  }

  private async resolve(
    match: ShipmentMatch,
  ): Promise<{ shipmentId: string; tenantId: string; legId?: string } | null> {
    switch (match.by) {
      case "containerNumber": {
        const [row] = await this.db
          .select({ shipmentId: shipments.id, tenantId: shipments.tenantId })
          .from(containers)
          .innerJoin(shipments, eq(containers.shipmentId, shipments.id))
          .where(
            and(
              eq(containers.containerNumber, match.containerNumber),
              inArray(shipments.status, ACTIVE_STATUSES as never),
            ),
          )
          .limit(1);
        return row ?? null;
      }
      case "carrierBookingRef": {
        const [row] = await this.db
          .select({ shipmentId: shipments.id, tenantId: shipments.tenantId })
          .from(bookings)
          .innerJoin(shipments, eq(shipments.bookingId, bookings.id))
          .where(
            and(
              eq(bookings.carrierBookingRef, match.carrierBookingRef),
              inArray(shipments.status, ACTIVE_STATUSES as never),
            ),
          )
          .limit(1);
        return row ?? null;
      }
      case "vesselImo": {
        const [row] = await this.db
          .select({ shipmentId: shipments.id, tenantId: shipments.tenantId, legId: legs.id })
          .from(legs)
          .innerJoin(shipments, eq(legs.shipmentId, shipments.id))
          .where(
            and(
              eq(legs.vesselImo, match.vesselImo),
              inArray(shipments.status, ACTIVE_STATUSES as never),
            ),
          )
          .limit(1);
        return row ?? null;
      }
      case "traccarDevice": {
        const [row] = await this.db
          .select({
            shipmentId: shipments.id,
            tenantId: shipments.tenantId,
            legId: legs.id,
          })
          .from(legs)
          .innerJoin(shipments, eq(legs.shipmentId, shipments.id))
          .where(
            and(
              eq(legs.traccarDeviceId, match.deviceId),
              isNotNull(legs.traccarDeviceId),
              inArray(shipments.status, ACTIVE_STATUSES as never),
            ),
          )
          .limit(1);
        return row ?? null;
      }
    }
  }
}
