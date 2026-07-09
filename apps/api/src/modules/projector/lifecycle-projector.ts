import { and, eq, isNull } from "drizzle-orm";
import { shipmentExceptions, shipments, type Db } from "@forge-freight/db";
import { effectOf } from "../shipments/lifecycle.js";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

/**
 * Maintains the shipments.status and shipment_exceptions projections from
 * the event stream, using the pure lifecycle reducer for meaning.
 * Idempotent: status writes converge; raise/clear check current open rows.
 */
export class LifecycleProjector implements EventHandler {
  readonly name = "lifecycle-projector";

  async handle(event: StoredEvent, db: Db): Promise<void> {
    if (!event.shipmentId) return;
    const effect = effectOf(event.type, event.payload);
    if (!effect) return;

    if (effect.status) {
      await db
        .update(shipments)
        .set({ status: effect.status })
        .where(eq(shipments.id, event.shipmentId));
    }

    if (effect.clear) {
      for (const code of effect.clear) {
        await db
          .update(shipmentExceptions)
          .set({ clearedAt: event.occurredAt })
          .where(
            and(
              eq(shipmentExceptions.shipmentId, event.shipmentId),
              eq(shipmentExceptions.code, code),
              isNull(shipmentExceptions.clearedAt),
            ),
          );
      }
    }

    if (effect.raise) {
      const open = await db
        .select({ id: shipmentExceptions.id })
        .from(shipmentExceptions)
        .where(
          and(
            eq(shipmentExceptions.shipmentId, event.shipmentId),
            eq(shipmentExceptions.code, effect.raise.code),
            isNull(shipmentExceptions.clearedAt),
          ),
        );
      if (open.length === 0) {
        await db.insert(shipmentExceptions).values({
          tenantId: event.tenantId,
          shipmentId: event.shipmentId,
          code: effect.raise.code,
          detail: effect.raise.detail,
          raisedAt: event.occurredAt,
        });
      }
    }
  }
}
