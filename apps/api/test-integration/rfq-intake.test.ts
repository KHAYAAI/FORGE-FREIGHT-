import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  events,
  marginRules,
  parties,
  quotes,
  rateCards,
  tenants,
  type Db,
} from "@forge-freight/db";
import { QuoteIssued } from "@forge-freight/events";
import { RfqService } from "../src/modules/ingest/rfq.service.js";
import { QuotingService } from "../src/modules/quoting/quoting.service.js";
import { RatesService } from "../src/modules/rates/rates.service.js";
import { ConsignmentsService } from "../src/modules/consignments/consignments.service.js";
import { testDb } from "./harness.js";

/**
 * End-to-end for the path n8n drives: an RFQ arrives from the outside world
 * and either becomes a quote or is handed to a person, against a real
 * database.
 *
 * The n8n workflow itself is four nodes of plumbing — validate, POST, branch,
 * respond. What actually has to be right is the contract underneath it, and
 * that is what this exercises: the resolution rules, the refusals, and the
 * idempotency that makes a redelivered email safe.
 */
describe("RFQ intake (integration)", () => {
  const db: Db = testDb();
  let tenantId: string;
  let rfq: RfqService;

  const created: string[] = [];

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({
        id: randomUUID(),
        type: "OPERATOR",
        name: `test-rfq-${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;
    created.push(tenantId);

    // A lane the engine can actually price, so "no rate" is a real signal
    // rather than the only possible outcome.
    await db.insert(rateCards).values({
      id: randomUUID(),
      tenantId,
      kind: "CONTRACT",
      carrierName: "Test Line",
      mode: "OCEAN",
      origin: "CNSHA",
      destination: "ZADUR",
      containerType: "40HC",
      buyAmountCents: 235_000,
      currency: "USD",
      transitDays: 28,
      validFrom: new Date(Date.now() - 30 * 864e5),
      validTo: new Date(Date.now() + 90 * 864e5),
    });
    await db.insert(marginRules).values({
      id: randomUUID(),
      tenantId,
      marginBps: 1500,
      minMarginCents: 100_000,
    });

    const consignments = new ConsignmentsService(db);
    rfq = new RfqService(
      db,
      new QuotingService(db, new RatesService(db), consignments),
    );
  });

  afterAll(async () => {
    await db.delete(events).where(eq(events.tenantId, tenantId));
    await db.delete(marginRules).where(eq(marginRules.tenantId, tenantId));
    await db.delete(rateCards).where(eq(rateCards.tenantId, tenantId));
    // Every RFQ this suite quotes writes a quotes row referencing the
    // customer party (quotes.customerId -> parties.id, no cascade) — delete
    // quotes first or this violates quotes_customer_id_parties_id_fk.
    // quoteLines cascades off quotes itself, so nothing else to clean here.
    await db.delete(quotes).where(eq(quotes.tenantId, tenantId));
    await db.delete(parties).where(eq(parties.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const submission = (over: Record<string, unknown> = {}) => ({
    messageId: `msg-${randomUUID()}`,
    tenantId,
    customerEmail: "exports@known.example",
    origin: "CNSHA",
    destination: "ZADUR",
    mode: "OCEAN" as const,
    containerType: "40HC" as const,
    quantity: 1,
    incoterm: "CIF" as const,
    ...over,
  });

  const addCustomer = async (
    email: string,
    screeningStatus: "UNSCREENED" | "CLEAR" | "REVIEW" | "HIT" = "CLEAR",
  ) => {
    const [p] = await db
      .insert(parties)
      .values({
        id: randomUUID(),
        tenantId,
        name: `Customer ${email}`,
        email,
        screeningStatus,
      })
      .returning({ id: parties.id });
    return p!.id;
  };

  it("refuses an unknown sender instead of onboarding them", async () => {
    const out = await rfq.submit(submission({ customerEmail: "stranger@nowhere.example" }));
    expect(out.status).toBe("NEEDS_ONBOARDING");
  });

  it("refuses a customer still under screening review", async () => {
    await addCustomer("review@known.example", "REVIEW");
    const out = await rfq.submit(submission({ customerEmail: "review@known.example" }));
    expect(out.status).toBe("NEEDS_SCREENING_REVIEW");
  });

  it("quotes a known, cleared customer on a lane it holds a card for", async () => {
    await addCustomer("exports@known.example");
    const out = await rfq.submit(submission());
    expect(out.status).toBe("QUOTED");
    if (out.status !== "QUOTED") return;
    expect(out.duplicate).toBe(false);
    expect(out.quoteId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("matches the customer's email case-insensitively", async () => {
    const out = await rfq.submit(
      submission({ customerEmail: "EXPORTS@Known.Example" }),
    );
    expect(out.status).toBe("QUOTED");
  });

  it("answers NO_RATE for a lane with no valid card, rather than throwing", async () => {
    const out = await rfq.submit(submission({ destination: "NLRTM" }));
    expect(out.status).toBe("NO_RATE");
  });

  describe("idempotency — the reason a redelivered email is safe", () => {
    it("returns the original quote for a repeated messageId", async () => {
      const s = submission();
      const first = await rfq.submit(s);
      const second = await rfq.submit(s);

      expect(first.status).toBe("QUOTED");
      expect(second.status).toBe("QUOTED");
      if (first.status !== "QUOTED" || second.status !== "QUOTED") return;

      expect(second.quoteId).toBe(first.quoteId);
      expect(second.duplicate).toBe(true);
    });

    it("writes exactly one QuoteIssued event for a repeated messageId", async () => {
      const s = submission();
      await rfq.submit(s);
      await rfq.submit(s);
      await rfq.submit(s);

      const rows = await db
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          and(
            eq(events.type, QuoteIssued.type),
            eq(events.sourceRef, `rfq:${s.messageId}`),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("treats a genuinely new message as a new quote", async () => {
      const a = await rfq.submit(submission());
      const b = await rfq.submit(submission());
      if (a.status !== "QUOTED" || b.status !== "QUOTED") {
        throw new Error("expected both to quote");
      }
      expect(b.quoteId).not.toBe(a.quoteId);
    });
  });
});
