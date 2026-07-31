import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { events, invoices, payments, type Db } from "@forge-freight/db";
import { BillingService } from "../src/modules/billing/billing.service.js";
import { createTenantFixture, dropTenantFixture, testDb, type Fixture } from "./harness.js";

/**
 * Payment reconciliation ran against a real database because the two bugs it
 * had were both database-shaped: the running total was never summed (each
 * payment was judged against the invoice total alone, so two half payments
 * left an invoice PART_PAID forever) and there was no uniqueness anywhere, so
 * a redelivered bank webhook credited the customer twice.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;
let billing: BillingService;

const actor = (tenantId: string) =>
  ({ kind: "USER", id: "payments-test", tenantId }) as const;

async function makeInvoice(
  fixture: Fixture,
  totalCents: number,
  opts: { currency?: string; dueDate?: Date; status?: "ISSUED" | "CANCELLED" } = {},
) {
  const [row] = await db
    .insert(invoices)
    .values({
      id: randomUUID(),
      tenantId: fixture.tenantId,
      customerId: fixture.customerId,
      number: `INV-TEST-${randomUUID().slice(0, 8)}`,
      status: opts.status ?? "ISSUED",
      totalCents,
      currency: opts.currency ?? "USD",
      dueDate: opts.dueDate ?? new Date(Date.now() + 30 * 86_400_000),
    })
    .returning();
  return row!;
}

const statusOf = async (id: string) => {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  return row!.status;
};

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "pay-acme");
  rival = await createTenantFixture(db, "pay-rival");
  billing = new BillingService(db);
});

afterAll(async () => {
  for (const t of [acme, rival]) {
    const rows = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.tenantId, t.tenantId));
    for (const r of rows) await db.delete(payments).where(eq(payments.invoiceId, r.id));
    await db.delete(invoices).where(eq(invoices.tenantId, t.tenantId));
  }
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("part payments accumulate", () => {
  it("settles an invoice across two half payments", async () => {
    const invoice = await makeInvoice(acme, 100_000);

    const first = await billing.recordPayment({
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 50_000,
      currency: "USD",
      paymentRef: "BANK-A1",
      actor: actor(acme.tenantId),
    });
    expect(first.status).toBe("PART_PAID");
    expect(first.paidCents).toBe(50_000);
    expect(first.outstandingCents).toBe(50_000);

    const second = await billing.recordPayment({
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 50_000,
      currency: "USD",
      paymentRef: "BANK-A2",
      actor: actor(acme.tenantId),
    });
    // Before the running total existed this stayed PART_PAID: the second
    // payment was compared against the whole invoice on its own.
    expect(second.status).toBe("PAID");
    expect(second.paidCents).toBe(100_000);
    expect(second.outstandingCents).toBe(0);
    expect(await statusOf(invoice.id)).toBe("PAID");
  });

  it("reports an overpayment rather than booking it as revenue", async () => {
    const invoice = await makeInvoice(acme, 10_000);
    const result = await billing.recordPayment({
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 12_500,
      currency: "USD",
      paymentRef: "BANK-OVER",
      actor: actor(acme.tenantId),
    });
    expect(result.status).toBe("PAID");
    expect(result.overpaidCents).toBe(2_500);
    expect(result.outstandingCents).toBe(-2_500);
  });
});

describe("redelivery", () => {
  it("credits the same bank reference exactly once", async () => {
    const invoice = await makeInvoice(acme, 80_000);
    const body = {
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 40_000,
      currency: "USD",
      paymentRef: "BANK-DUP",
      actor: actor(acme.tenantId),
    };

    const first = await billing.recordPayment(body);
    const replay = await billing.recordPayment(body);

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.paidCents).toBe(40_000);
    expect(await statusOf(invoice.id)).toBe("PART_PAID");

    const rows = await billing.listPayments(invoice.id, acme.tenantId);
    expect(rows).toHaveLength(1);
  });

  it("emits no second payment.received for a replay", async () => {
    const invoice = await makeInvoice(acme, 30_000);
    const body = {
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 30_000,
      currency: "USD",
      paymentRef: "BANK-EVT",
      actor: actor(acme.tenantId),
    };
    await billing.recordPayment(body);
    await billing.recordPayment(body);

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.tenantId, acme.tenantId));
    const forThisInvoice = rows.filter(
      (e) =>
        e.type === "payment.received" &&
        (e.payload as { invoiceId?: string }).invoiceId === invoice.id,
    );
    // A second event would reach the ledger sink and the customer's
    // notifications as though the money had arrived twice.
    expect(forThisInvoice).toHaveLength(1);
  });

  it("lets the same reference settle two different invoices", async () => {
    // One bank transfer allocated across invoices is legitimate; the
    // constraint is per invoice, deliberately, so this must not be rejected.
    const a = await makeInvoice(acme, 5_000);
    const b = await makeInvoice(acme, 5_000);
    await billing.recordPayment({
      invoiceId: a.id,
      tenantId: acme.tenantId,
      amountCents: 5_000,
      currency: "USD",
      paymentRef: "BANK-SPLIT",
      actor: actor(acme.tenantId),
    });
    const second = await billing.recordPayment({
      invoiceId: b.id,
      tenantId: acme.tenantId,
      amountCents: 5_000,
      currency: "USD",
      paymentRef: "BANK-SPLIT",
      actor: actor(acme.tenantId),
    });
    expect(second.duplicate).toBe(false);
    expect(second.status).toBe("PAID");
  });
});

describe("refusals", () => {
  it("will not pay another tenant's invoice", async () => {
    const invoice = await makeInvoice(acme, 1_000);
    await expect(
      billing.recordPayment({
        invoiceId: invoice.id,
        tenantId: rival.tenantId,
        amountCents: 1_000,
        currency: "USD",
        paymentRef: "BANK-X",
        actor: actor(rival.tenantId),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(invoice.id)).toBe("ISSUED");
  });

  it("refuses a payment in the wrong currency", async () => {
    const invoice = await makeInvoice(acme, 1_000, { currency: "ZAR" });
    await expect(
      billing.recordPayment({
        invoiceId: invoice.id,
        tenantId: acme.tenantId,
        amountCents: 1_000,
        currency: "USD",
        paymentRef: "BANK-FX",
        actor: actor(acme.tenantId),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses a payment against a cancelled invoice", async () => {
    const invoice = await makeInvoice(acme, 1_000, { status: "CANCELLED" });
    await expect(
      billing.recordPayment({
        invoiceId: invoice.id,
        tenantId: acme.tenantId,
        amountCents: 1_000,
        currency: "USD",
        paymentRef: "BANK-CANC",
        actor: actor(acme.tenantId),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not list another tenant's payments", async () => {
    const invoice = await makeInvoice(acme, 2_000);
    await billing.recordPayment({
      invoiceId: invoice.id,
      tenantId: acme.tenantId,
      amountCents: 2_000,
      currency: "USD",
      paymentRef: "BANK-PRIV",
      actor: actor(acme.tenantId),
    });
    expect(await billing.listPayments(invoice.id, rival.tenantId)).toEqual([]);
  });
});

describe("overdue sweep", () => {
  it("moves an unsettled invoice past its due date to OVERDUE", async () => {
    const late = await makeInvoice(acme, 9_000, {
      dueDate: new Date(Date.now() - 86_400_000),
    });
    await billing.markOverdue();
    expect(await statusOf(late.id)).toBe("OVERDUE");
  });

  it("leaves a settled invoice alone however late it is", async () => {
    const paid = await makeInvoice(acme, 9_000, {
      dueDate: new Date(Date.now() - 86_400_000),
    });
    await billing.recordPayment({
      invoiceId: paid.id,
      tenantId: acme.tenantId,
      amountCents: 9_000,
      currency: "USD",
      paymentRef: "BANK-LATE",
      actor: actor(acme.tenantId),
    });
    await billing.markOverdue();
    expect(await statusOf(paid.id)).toBe("PAID");
  });

  it("leaves an invoice that is not yet due alone", async () => {
    const future = await makeInvoice(acme, 9_000, {
      dueDate: new Date(Date.now() + 86_400_000),
    });
    await billing.markOverdue();
    expect(await statusOf(future.id)).toBe("ISSUED");
  });

  it("keeps an overdue invoice overdue when only part of it is paid", async () => {
    // A token payment does not cure lateness. Dropping it to PART_PAID would
    // take it off the overdue list until the next sweep put it back, so the
    // screen would give two different answers for the same invoice.
    const late = await makeInvoice(acme, 10_000, {
      dueDate: new Date(Date.now() - 86_400_000),
    });
    await billing.markOverdue();
    const result = await billing.recordPayment({
      invoiceId: late.id,
      tenantId: acme.tenantId,
      amountCents: 1_000,
      currency: "USD",
      paymentRef: "BANK-TOKEN",
      actor: actor(acme.tenantId),
    });
    expect(result.status).toBe("OVERDUE");
    expect(result.paidCents).toBe(1_000);
    expect(await statusOf(late.id)).toBe("OVERDUE");
  });

  it("settles an overdue invoice when the money finally arrives", async () => {
    const late = await makeInvoice(acme, 4_000, {
      dueDate: new Date(Date.now() - 86_400_000),
    });
    await billing.markOverdue();
    expect(await statusOf(late.id)).toBe("OVERDUE");

    const result = await billing.recordPayment({
      invoiceId: late.id,
      tenantId: acme.tenantId,
      amountCents: 4_000,
      currency: "USD",
      paymentRef: "BANK-CATCHUP",
      actor: actor(acme.tenantId),
    });
    expect(result.status).toBe("PAID");
    expect(await statusOf(late.id)).toBe("PAID");
  });
});
