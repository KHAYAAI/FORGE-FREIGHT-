import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Db } from "@forge-freight/db";
import { QuotingService } from "../src/modules/quoting/quoting.service.js";
import type { RatesService } from "../src/modules/rates/rates.service.js";
import type { RateCardInput } from "../src/modules/quoting/quote-engine.js";

/**
 * Quoting a lane nobody has a rate for is an everyday customer action, not a
 * server fault. These cover the translation from the pricing engine's domain
 * errors to HTTP: without it they fall through to the catch-all filter and the
 * caller gets a bare 500 "Internal server error" with no usable reason.
 */

/** Enough of Drizzle's builder to satisfy `select().from().where().orderBy()`. */
function stubDb(rows: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: async () => rows }),
      }),
    }),
  } as unknown as Db;
}

function stubRates(cards: RateCardInput[]): RatesService {
  return { findForLane: async () => cards } as unknown as RatesService;
}

const input = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  customerId: "22222222-2222-2222-2222-222222222222",
  origin: "ZADUR",
  destination: "ZAJNB",
  mode: "ROAD" as const,
  containerType: null,
  quantity: 1,
  incoterm: "CIF" as const,
  requestedAt: new Date("2026-07-15T00:00:00Z"),
  actor: {
    kind: "USER" as const,
    id: "dev",
    tenantId: "11111111-1111-1111-1111-111111111111",
  },
};

describe("QuotingService.issueQuote — unpriceable requests", () => {
  it("answers 422, not 500, when no rate card covers the lane", async () => {
    const service = new QuotingService(stubDb([]), stubRates([]));

    const err = await service.issueQuote(input).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(422);
    // The lane has to be in the message — "unprocessable" alone tells an
    // operator nothing about which corridor needs a rate card loaded.
    expect((err as HttpException).message).toContain("ZADUR→ZAJNB");
  });

  it("answers 422 when a rate exists but the tenant has no margin rule", async () => {
    const card: RateCardInput = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "CONTRACT",
      carrierName: "Transnet",
      mode: "ROAD",
      origin: "ZADUR",
      destination: "ZAJNB",
      containerType: null,
      buyAmountCents: 100_000,
      currency: "ZAR",
      transitDays: 2,
      validFrom: new Date("2026-07-01T00:00:00Z"),
      validTo: new Date("2026-09-30T00:00:00Z"),
      surcharges: [],
    };
    const service = new QuotingService(stubDb([]), stubRates([card]));

    const err = await service.issueQuote(input).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(422);
  });
});
