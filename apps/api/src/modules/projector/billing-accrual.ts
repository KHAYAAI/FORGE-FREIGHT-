import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  bookings,
  charges,
  quoteLines,
  shipments,
  type Db,
} from "@forge-freight/db";
import { ChargeAccrued, makeEvent } from "@forge-freight/events";
import { appendEvent } from "../db/event-store.js";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

/**
 * Charge accrual from operational events:
 * - vessel.departed  → accrue the quoted freight + surcharge lines (sell AND
 *   buy — margin visibility from day one).
 * - entry.released   → accrue duties+VAT as a pass-through DISBURSEMENT.
 * Each accrual emits charge.accrued, which the ledger sink turns into an
 * obligation for the Revenue Ontology.
 * Idempotent: skips if charges with the same trigger already exist.
 */
export class BillingAccrual implements EventHandler {
  readonly name = "billing-accrual";

  async handle(event: StoredEvent, db: Db): Promise<void> {
    if (!event.shipmentId) return;
    if (event.type === "vessel.departed") {
      await this.accrueQuotedCharges(event, db);
    } else if (event.type === "entry.released") {
      await this.accrueDutyDisbursement(event, db);
    }
  }

  private async alreadyAccrued(
    db: Db,
    shipmentId: string,
    triggeredBy: string,
  ): Promise<boolean> {
    const existing = await db
      .select({ id: charges.id })
      .from(charges)
      .where(
        and(eq(charges.shipmentId, shipmentId), eq(charges.triggeredBy, triggeredBy)),
      )
      .limit(1);
    return existing.length > 0;
  }

  private async accrueQuotedCharges(event: StoredEvent, db: Db): Promise<void> {
    const shipmentId = event.shipmentId!;
    if (await this.alreadyAccrued(db, shipmentId, "vessel.departed")) return;

    const [shipment] = await db
      .select({
        tenantId: shipments.tenantId,
        bookingId: shipments.bookingId,
      })
      .from(shipments)
      .where(eq(shipments.id, shipmentId));
    if (!shipment) return;
    const [booking] = await db
      .select({ quoteId: bookings.quoteId })
      .from(bookings)
      .where(eq(bookings.id, shipment.bookingId));
    if (!booking?.quoteId) return;

    const lines = await db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, booking.quoteId));

    for (const line of lines) {
      const chargeId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(charges).values({
          id: chargeId,
          tenantId: shipment.tenantId,
          shipmentId,
          chargeCode: line.chargeCode,
          description: line.description,
          kind: line.chargeCode === "FRT" ? "FREIGHT" : "SURCHARGE",
          buyCents: line.buyCents * line.quantity,
          sellCents: line.sellCents * line.quantity,
          currency: line.currency,
          triggeredBy: "vessel.departed",
        });
        await appendEvent(
          tx,
          makeEvent({
            definition: ChargeAccrued,
            tenantId: shipment.tenantId,
            actor: { kind: "SYSTEM", id: "billing-accrual" },
            shipmentId,
            payload: {
              chargeId,
              chargeCode: line.chargeCode,
              description: line.description,
              kind: line.chargeCode === "FRT" ? "FREIGHT" : "SURCHARGE",
              buy: { amountCents: line.buyCents * line.quantity, currency: line.currency },
              sell: {
                amountCents: line.sellCents * line.quantity,
                currency: line.currency,
              },
              triggeredBy: "vessel.departed",
            },
          }),
        );
      });
    }
  }

  private async accrueDutyDisbursement(event: StoredEvent, db: Db): Promise<void> {
    const shipmentId = event.shipmentId!;
    if (await this.alreadyAccrued(db, shipmentId, "entry.released")) return;

    const duties = event.payload.dutiesTotal as { amountCents: number; currency: string };
    const vat = event.payload.vatTotal as { amountCents: number; currency: string };
    const total = duties.amountCents + vat.amountCents;
    const chargeId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(charges).values({
        id: chargeId,
        tenantId: event.tenantId,
        shipmentId,
        chargeCode: "DUTY",
        description: "Customs duties and VAT (disbursement at cost)",
        kind: "DISBURSEMENT",
        buyCents: total,
        sellCents: total,
        currency: duties.currency,
        triggeredBy: "entry.released",
      });
      await appendEvent(
        tx,
        makeEvent({
          definition: ChargeAccrued,
          tenantId: event.tenantId,
          actor: { kind: "SYSTEM", id: "billing-accrual" },
          shipmentId,
          payload: {
            chargeId,
            chargeCode: "DUTY",
            description: "Customs duties and VAT (disbursement at cost)",
            kind: "DISBURSEMENT",
            buy: { amountCents: total, currency: duties.currency },
            sell: { amountCents: total, currency: duties.currency },
            triggeredBy: "entry.released",
          },
        }),
      );
    });
  }
}
