import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lte } from "drizzle-orm";
import { rateCards, rateSurcharges, type Db } from "@forge-freight/db";
import { DB } from "../db/db.module.js";
import type { RateCardInput } from "../quoting/quote-engine.js";

@Injectable()
export class RatesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Valid rate cards (with surcharges) for a lane at a point in time. */
  async findForLane(params: {
    tenantId: string;
    origin: string;
    destination: string;
    mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
    at: Date;
  }): Promise<RateCardInput[]> {
    const cards = await this.db
      .select()
      .from(rateCards)
      .where(
        and(
          eq(rateCards.tenantId, params.tenantId),
          eq(rateCards.origin, params.origin),
          eq(rateCards.destination, params.destination),
          eq(rateCards.mode, params.mode),
          lte(rateCards.validFrom, params.at),
          gte(rateCards.validTo, params.at),
        ),
      );

    return Promise.all(
      cards.map(async (card) => {
        const surcharges = await this.db
          .select()
          .from(rateSurcharges)
          .where(eq(rateSurcharges.rateCardId, card.id));
        return {
          id: card.id,
          kind: card.kind,
          carrierName: card.carrierName,
          mode: card.mode,
          origin: card.origin,
          destination: card.destination,
          containerType: card.containerType,
          buyAmountCents: card.buyAmountCents,
          currency: card.currency,
          transitDays: card.transitDays,
          validFrom: card.validFrom,
          validTo: card.validTo,
          surcharges: surcharges.map((s) => ({
            code: s.code,
            description: s.description,
            basis: s.basis,
            amountCents: s.amountCents,
            currency: s.currency,
          })),
        };
      }),
    );
  }
}
