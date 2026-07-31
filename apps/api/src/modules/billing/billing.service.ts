import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  charges,
  invoices,
  ledgerEvents,
  payments,
  shipments,
  type Db,
} from "@forge-freight/db";
import {
  InvoiceIssued,
  makeEvent,
  PaymentReceived,
  type EventActor,
} from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";

@Injectable()
export class BillingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Issue an invoice from a shipment's uninvoiced charges. One currency per
   * invoice — mixed-currency shipments produce one invoice per currency.
   */
  async issueInvoices(params: {
    shipmentId: string;
    tenantId: string;
    actor: EventActor;
    paymentTermsDays?: number;
  }) {
    const [shipment] = await this.db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.id, params.shipmentId),
          eq(shipments.tenantId, params.tenantId),
        ),
      );
    if (!shipment) throw new NotFoundException("Shipment not found");

    const [customerRow] = await this.db.execute(
      sql`select customer_id from bookings where id = ${shipment.bookingId}`,
    );
    const customerId = (customerRow as { customer_id: string }).customer_id;

    const unbilled = await this.db
      .select()
      .from(charges)
      .where(
        and(eq(charges.shipmentId, params.shipmentId), isNull(charges.invoiceId)),
      );
    if (unbilled.length === 0) {
      throw new ConflictException("No uninvoiced charges on this shipment");
    }

    const byCurrency = new Map<string, typeof unbilled>();
    for (const charge of unbilled) {
      const list = byCurrency.get(charge.currency) ?? [];
      list.push(charge);
      byCurrency.set(charge.currency, list);
    }

    const dueDate = new Date(
      Date.now() + (params.paymentTermsDays ?? 30) * 86_400_000,
    );
    const issued: Array<{ invoiceId: string; number: string; totalCents: number; currency: string }> = [];

    for (const [currency, group] of byCurrency) {
      const invoiceId = randomUUID();
      const total = group.reduce((sum, c) => sum + c.sellCents, 0);

      await this.db.transaction(async (tx) => {
        const [inv] = await tx
          .insert(invoices)
          .values({
            id: invoiceId,
            tenantId: params.tenantId,
            customerId,
            shipmentId: params.shipmentId,
            number: sql`'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('shipment_ref_seq')::text, 6, '0')` as never,
            totalCents: total,
            currency,
            dueDate,
          })
          .returning({ number: invoices.number });

        for (const charge of group) {
          await tx
            .update(charges)
            .set({ invoiceId })
            .where(eq(charges.id, charge.id));
        }

        await appendEvent(
          tx,
          makeEvent({
            definition: InvoiceIssued,
            tenantId: params.tenantId,
            actor: params.actor,
            shipmentId: params.shipmentId,
            payload: {
              invoiceId,
              customerId,
              total: { amountCents: total, currency },
              dueDate: dueDate.toISOString(),
              chargeIds: group.map((c) => c.id),
            },
          }),
        );

        issued.push({
          invoiceId,
          number: inv!.number,
          totalCents: total,
          currency,
        });
      });
    }
    return { invoices: issued };
  }

  /** ForgePay reconciliation webhook target. */
  async recordPayment(params: {
    invoiceId: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    paymentRef: string;
    /** When the money actually landed; defaults to now. */
    receivedAt?: Date;
    actor: EventActor;
  }) {
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.id, params.invoiceId), eq(invoices.tenantId, params.tenantId)),
      );
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.currency !== params.currency) {
      throw new ConflictException(
        `Payment currency ${params.currency} does not match invoice ${invoice.currency}`,
      );
    }

    if (invoice.status === "CANCELLED") {
      throw new ConflictException(`Invoice ${invoice.number} is cancelled and cannot be paid`);
    }

    return this.db.transaction(async (tx) => {
      // The reference is the bank's, and banks redeliver. Doing nothing on
      // conflict makes a replayed webhook a no-op instead of double-crediting
      // the customer.
      const inserted = await tx
        .insert(payments)
        .values({
          tenantId: params.tenantId,
          invoiceId: invoice.id,
          amountCents: params.amountCents,
          currency: params.currency,
          paymentRef: params.paymentRef,
          receivedAt: params.receivedAt ?? new Date(),
        })
        .onConflictDoNothing({ target: [payments.invoiceId, payments.paymentRef] })
        .returning();

      const [totals] = await tx
        .select({ paid: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint`.mapWith(Number) })
        .from(payments)
        .where(eq(payments.invoiceId, invoice.id));
      const paidCents = totals?.paid ?? 0;
      const outstandingCents = invoice.totalCents - paidCents;

      // Settlement is decided by the running total, not by this one payment:
      // two half payments used to leave an invoice PART_PAID forever.
      //
      // A part payment does not cure lateness. Moving an overdue invoice to
      // PART_PAID would drop it off the overdue list the moment a customer
      // paid a token amount — and the hourly sweep would put it back, so the
      // screen would flicker between two answers for the same invoice.
      const stillLate = invoice.dueDate < new Date();
      const status =
        paidCents >= invoice.totalCents
          ? "PAID"
          : paidCents > 0
            ? stillLate
              ? "OVERDUE"
              : "PART_PAID"
            : invoice.status;

      if (status !== invoice.status) {
        await tx.update(invoices).set({ status }).where(eq(invoices.id, invoice.id));
      }

      // A duplicate reference changed nothing, so it emits nothing — a second
      // `payment.received` would reach the ledger sink and the customer's
      // notifications as though money had arrived twice.
      if (inserted.length > 0) {
        await appendEvent(
          tx,
          makeEvent({
            definition: PaymentReceived,
            tenantId: params.tenantId,
            actor: params.actor,
            shipmentId: invoice.shipmentId,
            payload: {
              invoiceId: invoice.id,
              amount: { amountCents: params.amountCents, currency: params.currency },
              paymentRef: params.paymentRef,
            },
          }),
        );
      }

      return {
        invoiceId: invoice.id,
        status,
        paidCents,
        outstandingCents,
        /** Negative outstanding is money to refund, not revenue — surface it. */
        overpaidCents: outstandingCents < 0 ? -outstandingCents : 0,
        duplicate: inserted.length === 0,
      };
    });
  }

  /** Every payment recorded against an invoice, oldest first. */
  async listPayments(invoiceId: string, tenantId: string) {
    return this.db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.tenantId, tenantId)))
      .orderBy(asc(payments.receivedAt));
  }

  /**
   * Move unsettled invoices past their due date to OVERDUE.
   *
   * The status existed in the enum and the console already rendered it as a
   * red badge with its own filter — but nothing ever set it, so the overdue
   * count was permanently zero and the screen quietly lied. Runs as a sweep
   * rather than being computed on read because the status is a stored column
   * that the ledger feed and notifications both key off.
   */
  async markOverdue(now = new Date()): Promise<number> {
    const updated = await this.db
      .update(invoices)
      .set({ status: "OVERDUE" })
      .where(
        and(
          inArray(invoices.status, ["ISSUED", "PART_PAID"]),
          lt(invoices.dueDate, now),
        ),
      )
      .returning({ id: invoices.id });
    return updated.length;
  }

  /**
   * Trade-finance views over the ledger feed — the ontology-bridge payoff:
   * duty amounts eligible for financing and receivables on the factoring
   * clock, straight from ledger events.
   */
  async financeViews(tenantId: string) {
    const dutyFinancing = await this.db
      .select({
        shipmentId: ledgerEvents.shipmentId,
        amountCents: ledgerEvents.amountCents,
        currency: ledgerEvents.currency,
        occurredAt: ledgerEvents.occurredAt,
      })
      .from(ledgerEvents)
      .where(
        and(
          eq(ledgerEvents.tenantId, tenantId),
          eq(ledgerEvents.trigger, "DUTY_FINANCING_ELIGIBLE"),
        ),
      );

    const factoring = await this.db.execute(sql`
      select r.shipment_id, r.amount_cents, r.currency,
             r.occurred_at as recognised_at,
             f.occurred_at as factoring_clock_started_at,
             s.occurred_at as settled_at
      from ledger_events r
      left join ledger_events f
        on f.shipment_id = r.shipment_id and f.trigger = 'FACTORING_CLOCK_START'
      left join ledger_events s
        on s.shipment_id = r.shipment_id and s.type = 'receivable.settled'
      where r.tenant_id = ${tenantId} and r.type = 'receivable.recognised'
    `);

    return { dutyFinancing, factoring };
  }
}
