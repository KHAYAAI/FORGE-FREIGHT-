import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  bookings,
  charges,
  quoteLines,
  shipments,
  tenantBillingProfiles,
  tenants,
  type Db,
} from "@forge-freight/db";
import { ChargeAccrued, makeEvent } from "@forge-freight/events";
import { chargeMetadata } from "../billing/charge-codes.js";
import { appendEvent } from "../db/event-store.js";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

/**
 * Charge accrual from operational events:
 * - vessel.departed  → accrue the quoted freight + surcharge lines (sell AND
 *   buy — margin visibility from day one), then — PARTNER_AGENT tenants
 *   only — the platform fee on top (M10: franchise layer).
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

    // The issuing company's own VAT rate. A tenant with no profile yet bills
    // at zero rather than at somebody else's rate.
    const [profileRow] = await db
      .select({ vatBps: tenantBillingProfiles.vatBps })
      .from(tenantBillingProfiles)
      .where(eq(tenantBillingProfiles.tenantId, shipment.tenantId));
    const profile = { vatBps: profileRow?.vatBps ?? 0 };

    // Sell total by currency, for the platform fee below — computed while
    // accruing the quoted lines so a mixed-currency quote fees each currency
    // on its own total rather than mixing them.
    const sellTotalsByCurrency = new Map<string, number>();

    for (const line of lines) {
      const chargeId = randomUUID();
      const sellCents = line.sellCents * line.quantity;
      sellTotalsByCurrency.set(
        line.currency,
        (sellTotalsByCurrency.get(line.currency) ?? 0) + sellCents,
      );
      await db.transaction(async (tx) => {
        // The taxonomy fields come from the code itself. Left on the column
        // defaults, every automatically-accrued line would claim to be an
        // uncategorised charge the forwarder originated with no underlying
        // cost — which is exactly the shape the audit is built to pass.
        const meta = chargeMetadata(line.chargeCode, {
          vatBps: profile.vatBps,
          provenance: line.buyCents > 0 ? "MARKED_UP" : "FORWARDER_ORIGINATED",
        });
        await tx.insert(charges).values({
          id: chargeId,
          tenantId: shipment.tenantId,
          shipmentId,
          chargeCode: meta.chargeCode,
          description: line.description,
          kind: meta.kind,
          category: meta.category,
          provenance: meta.provenance,
          basis: meta.basis,
          quantity: line.quantity,
          unitSellCents: line.sellCents,
          vatBps: meta.vatBps,
          contractRef: `Accepted quote ${booking.quoteId}`,
          buyCents: line.buyCents * line.quantity,
          sellCents,
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
              sell: { amountCents: sellCents, currency: line.currency },
              triggeredBy: "vessel.departed",
            },
          }),
        );
      });
    }

    await this.accruePlatformFee(shipment.tenantId, shipmentId, sellTotalsByCurrency, db);
  }

  /**
   * M10: PARTNER_AGENT tenants pay the operator a platform fee on the
   * freight they book, set per-partner via tenants.platform_fee_bps.
   * OPERATOR and CUSTOMER tenants never accrue this — no rate means no fee.
   */
  private async accruePlatformFee(
    tenantId: string,
    shipmentId: string,
    sellTotalsByCurrency: Map<string, number>,
    db: Db,
  ): Promise<void> {
    const [tenant] = await db
      .select({ type: tenants.type, platformFeeBps: tenants.platformFeeBps })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant || tenant.type !== "PARTNER_AGENT" || !tenant.platformFeeBps) return;

    for (const [currency, sellCents] of sellTotalsByCurrency) {
      const feeCents = Math.round((sellCents * tenant.platformFeeBps) / 10_000);
      if (feeCents <= 0) continue;

      const chargeId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(charges).values({
          id: chargeId,
          tenantId,
          shipmentId,
          chargeCode: "PLF",
          description: `Platform fee (${tenant.platformFeeBps! / 100}% of freight)`,
          kind: "FEE",
          category: "PLATFORM_FEE",
          provenance: "FORWARDER_ORIGINATED",
          basis: "PERCENTAGE",
          quantity: 1,
          unitSellCents: feeCents,
          buyCents: null,
          sellCents: feeCents,
          currency,
          triggeredBy: "vessel.departed",
        });
        await appendEvent(
          tx,
          makeEvent({
            definition: ChargeAccrued,
            tenantId,
            actor: { kind: "SYSTEM", id: "billing-accrual" },
            shipmentId,
            payload: {
              chargeId,
              chargeCode: "PLATFORM_FEE",
              description: `Platform fee (${tenant.platformFeeBps! / 100}% of freight)`,
              kind: "FEE",
              buy: null,
              sell: { amountCents: feeCents, currency },
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
        chargeCode: "DTY",
        description: "Customs duties and VAT (disbursement at cost)",
        kind: "DISBURSEMENT",
        category: "DUTY_TAX",
        provenance: "PASS_THROUGH",
        basis: "PER_SHIPMENT",
        quantity: 1,
        unitSellCents: total,
        // Duty and import VAT recovered at cost are outside the scope of VAT.
        // Charging output tax on them overstates the invoice and the issuer's
        // own VAT return together.
        vatBps: 0,
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
