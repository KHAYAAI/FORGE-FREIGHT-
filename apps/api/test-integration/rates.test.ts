import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { marginRules, rateCards, tenants, type Db } from "@forge-freight/db";
import { RatesController } from "../src/modules/rates/rates.controller.js";
import { RatesService } from "../src/modules/rates/rates.service.js";
import { createTenantFixture, dropTenantFixture, testDb, type Fixture } from "./harness.js";

/**
 * Rate cards carry buy prices — the single most commercially sensitive number
 * a forwarder holds. These run against a real database because the isolation
 * that matters is the `tenantId` predicate on the write path, and only
 * Postgres can tell you whether a forged id actually reaches another tenant's
 * row.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;
let customerTenantId: string;
let controller: RatesController;

const auth = (tenantId: string) => ({ tenantId, userId: "rates-test", roles: [] });

const LANE = {
  kind: "CONTRACT" as const,
  carrierName: "Test Line",
  mode: "OCEAN" as const,
  origin: "ZADUR",
  destination: "NLRTM",
  containerType: "40HC" as const,
  buyAmountCents: 185_000,
  currency: "USD",
  transitDays: 24,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2026-12-31T00:00:00Z"),
  surcharges: [],
};

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "rates-acme");
  rival = await createTenantFixture(db, "rates-rival");
  const [customer] = await db
    .insert(tenants)
    .values({ id: randomUUID(), type: "CUSTOMER", name: `test-rates-cust-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenants.id });
  customerTenantId = customer!.id;
  controller = new RatesController(db, new RatesService(db));
});

afterAll(async () => {
  for (const t of [acme.tenantId, rival.tenantId]) {
    await db.delete(marginRules).where(eq(marginRules.tenantId, t));
    await db.delete(rateCards).where(eq(rateCards.tenantId, t));
  }
  await db.delete(tenants).where(eq(tenants.id, customerTenantId));
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("who may administer rates", () => {
  it("refuses a customer tenant outright", async () => {
    await expect(controller.listCards(auth(customerTenantId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.createCard(LANE, auth(customerTenantId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("admits a partner agent, so a partner can onboard its own lanes", async () => {
    await db.update(tenants).set({ type: "PARTNER_AGENT" }).where(eq(tenants.id, rival.tenantId));
    await expect(controller.listCards(auth(rival.tenantId))).resolves.toEqual([]);
    await db.update(tenants).set({ type: "OPERATOR" }).where(eq(tenants.id, rival.tenantId));
  });
});

describe("rate card lifecycle", () => {
  it("creates a card with its surcharges in one shot", async () => {
    const card = await controller.createCard(
      {
        ...LANE,
        surcharges: [
          {
            code: "BAF",
            description: "Bunker adjustment",
            basis: "PERCENT_OF_FREIGHT",
            amountCents: 1_200,
            currency: "USD",
          },
          {
            code: "THC",
            description: "Terminal handling",
            basis: "PER_CONTAINER",
            amountCents: 18_500,
            currency: "USD",
          },
        ],
      },
      auth(acme.tenantId),
    );

    expect(card.tenantId).toBe(acme.tenantId);
    expect(card.surcharges).toHaveLength(2);
    expect(card.surcharges.map((s) => s.code).sort()).toEqual(["BAF", "THC"]);
  });

  it("normalises a lowercase LOCODE, so the lane is findable by the quote engine", async () => {
    const card = await controller.createCard(
      { ...LANE, origin: " zacpt ", destination: "sgsin", currency: "usd" },
      auth(acme.tenantId),
    );
    expect(card.origin).toBe("ZACPT");
    expect(card.destination).toBe("SGSIN");
    expect(card.currency).toBe("USD");
  });

  it("replaces the whole surcharge set rather than merging", async () => {
    const card = await controller.createCard(
      {
        ...LANE,
        origin: "AEJEA",
        surcharges: [
          { code: "BAF", description: "Bunker", basis: "PER_CONTAINER", amountCents: 100, currency: "USD" },
        ],
      },
      auth(acme.tenantId),
    );

    const replaced = await controller.replaceSurcharges(
      card.id,
      { surcharges: [{ code: "ISPS", description: "Security", basis: "PER_BL", amountCents: 900, currency: "USD" }] },
      auth(acme.tenantId),
    );

    expect(replaced.map((s) => s.code)).toEqual(["ISPS"]);
    const reread = await controller.getCard(card.id, auth(acme.tenantId));
    expect(reread.surcharges.map((s) => s.code)).toEqual(["ISPS"]);
  });

  it("filters to cards that are valid right now when asked", async () => {
    const expired = await controller.createCard(
      {
        ...LANE,
        origin: "CNSHA",
        destination: "ZAPLZ",
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validTo: new Date("2020-12-31T00:00:00Z"),
      },
      auth(acme.tenantId),
    );

    const all = await controller.listCards(auth(acme.tenantId), "CNSHA");
    const active = await controller.listCards(auth(acme.tenantId), "CNSHA", undefined, undefined, "true");
    expect(all.map((c) => c.id)).toContain(expired.id);
    expect(active.map((c) => c.id)).not.toContain(expired.id);
  });

  it("deletes a card and its surcharges", async () => {
    const card = await controller.createCard(
      {
        ...LANE,
        origin: "DEHAM",
        surcharges: [
          { code: "DOC", description: "Documentation", basis: "PER_BL", amountCents: 5_000, currency: "USD" },
        ],
      },
      auth(acme.tenantId),
    );
    await controller.deleteCard(card.id, auth(acme.tenantId));
    await expect(controller.getCard(card.id, auth(acme.tenantId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("tenant isolation on the write path", () => {
  it("hides another tenant's card behind a 404 rather than a 403", async () => {
    // 403 would confirm the id exists. A rival probing for a competitor's
    // rate card ids should learn nothing from the status code.
    const card = await controller.createCard(
      { ...LANE, origin: "ZAJNB", destination: "ZADUR" },
      auth(acme.tenantId),
    );
    await expect(controller.getCard(card.id, auth(rival.tenantId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.updateCard(card.id, { buyAmountCents: 1 }, auth(rival.tenantId)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.deleteCard(card.id, auth(rival.tenantId))).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // And the row is untouched.
    const survived = await controller.getCard(card.id, auth(acme.tenantId));
    expect(survived.buyAmountCents).toBe(LANE.buyAmountCents);
  });

  it("never lists another tenant's cards", async () => {
    const mine = await controller.listCards(auth(rival.tenantId));
    expect(mine.every((c) => c.tenantId === rival.tenantId)).toBe(true);
  });
});

describe("validity window", () => {
  it("rejects a card that expires before it starts", async () => {
    await expect(
      controller.createCard(
        { ...LANE, origin: "ZAELS", validFrom: new Date("2026-06-01"), validTo: new Date("2026-01-01") },
        auth(acme.tenantId),
      ),
    ).rejects.toThrow();
  });

  it("catches a PATCH that inverts the window against the untouched half", async () => {
    // The body alone looks fine — only the merged row is wrong.
    const card = await controller.createCard(
      { ...LANE, origin: "MZMPM" },
      auth(acme.tenantId),
    );
    await expect(
      controller.updateCard(card.id, { validTo: new Date("2020-01-01") }, auth(acme.tenantId)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects a percentage surcharge above 100%", async () => {
    await expect(
      controller.createCard(
        {
          ...LANE,
          origin: "ZARCB",
          surcharges: [
            { code: "BAF", description: "Bunker", basis: "PERCENT_OF_FREIGHT", amountCents: 150_000, currency: "USD" },
          ],
        },
        auth(acme.tenantId),
      ),
    ).rejects.toThrow();
  });
});

describe("margin rules", () => {
  it("lists most specific first, matching how the quote engine resolves them", async () => {
    await controller.createMarginRule({ marginBps: 1_500 }, auth(acme.tenantId));
    await controller.createMarginRule(
      { origin: "ZADUR", destination: "NLRTM", mode: "OCEAN", marginBps: 2_200 },
      auth(acme.tenantId),
    );
    await controller.createMarginRule({ origin: "ZADUR", marginBps: 1_800 }, auth(acme.tenantId));

    const rules = await controller.listMarginRules(auth(acme.tenantId));
    const specificity = rules.map(
      (r) => Number(!!r.customerId) + Number(!!r.origin) + Number(!!r.destination) + Number(!!r.mode),
    );
    expect(specificity).toEqual([...specificity].sort((a, b) => b - a));
    expect(specificity[0]).toBe(3);
  });

  it("refuses to delete the last catch-all, which would make every lane unquotable", async () => {
    const rules = await controller.listMarginRules(auth(acme.tenantId));
    const wildcard = rules.find((r) => !r.customerId && !r.origin && !r.destination && !r.mode);
    expect(wildcard).toBeDefined();
    await expect(
      controller.deleteMarginRule(wildcard!.id, auth(acme.tenantId)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("allows deleting a specific rule, and a catch-all once a replacement exists", async () => {
    const rules = await controller.listMarginRules(auth(acme.tenantId));
    const specific = rules.find((r) => r.origin)!;
    await controller.deleteMarginRule(specific.id, auth(acme.tenantId));

    const replacement = await controller.createMarginRule({ marginBps: 1_600 }, auth(acme.tenantId));
    const original = (await controller.listMarginRules(auth(acme.tenantId))).find(
      (r) => r.id !== replacement.id && !r.customerId && !r.origin && !r.destination && !r.mode,
    )!;
    await expect(
      controller.deleteMarginRule(original.id, auth(acme.tenantId)),
    ).resolves.toBeUndefined();
  });

  it("will not update another tenant's rule", async () => {
    const mine = await controller.createMarginRule({ marginBps: 900 }, auth(rival.tenantId));
    await expect(
      controller.updateMarginRule(mine.id, { marginBps: 9_000 }, auth(acme.tenantId)),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [unchanged] = await db.select().from(marginRules).where(eq(marginRules.id, mine.id));
    expect(unchanged!.marginBps).toBe(900);
  });
});
