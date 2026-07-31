import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { marginRules, rateCards, rateSurcharges, type Db } from "@forge-freight/db";
import { DB } from "../db/db.module.js";
import type { RateCardInput } from "../quoting/quote-engine.js";
import type {
  CreateMarginRule,
  CreateRateCard,
  Surcharge,
  UpdateMarginRule,
  UpdateRateCard,
} from "./rates.dto.js";

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

  // --- rate card administration ---------------------------------------------
  //
  // Until now this service was read-only and seed-populated: onboarding a lane
  // meant an operator running INSERTs by hand, which is not a product. Every
  // method below is scoped to the caller's own tenant — a rate card is a
  // commercial secret, and the buy price on it is the forwarder's margin.

  /** Rate cards for a tenant, newest first, with their surcharges attached. */
  async listCards(params: {
    tenantId: string;
    origin?: string;
    destination?: string;
    mode?: "OCEAN" | "AIR" | "ROAD" | "RAIL";
    /** Only cards whose validity window covers this instant. */
    activeAt?: Date;
  }) {
    const filters: SQL[] = [eq(rateCards.tenantId, params.tenantId)];
    if (params.origin) filters.push(eq(rateCards.origin, params.origin));
    if (params.destination) filters.push(eq(rateCards.destination, params.destination));
    if (params.mode) filters.push(eq(rateCards.mode, params.mode));
    if (params.activeAt) {
      filters.push(lte(rateCards.validFrom, params.activeAt));
      filters.push(gte(rateCards.validTo, params.activeAt));
    }

    const cards = await this.db
      .select()
      .from(rateCards)
      .where(and(...filters))
      .orderBy(asc(rateCards.origin), asc(rateCards.destination), desc(rateCards.validFrom))
      .limit(500);
    if (cards.length === 0) return [];

    const surcharges = await this.db
      .select()
      .from(rateSurcharges)
      .where(
        or(...cards.map((c) => eq(rateSurcharges.rateCardId, c.id)))!,
      );
    const byCard = new Map<string, typeof surcharges>();
    for (const s of surcharges) {
      const list = byCard.get(s.rateCardId) ?? [];
      list.push(s);
      byCard.set(s.rateCardId, list);
    }
    return cards.map((card) => ({ ...card, surcharges: byCard.get(card.id) ?? [] }));
  }

  async getCard(tenantId: string, id: string) {
    const [card] = await this.db
      .select()
      .from(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId)));
    if (!card) throw new NotFoundException(`Rate card ${id} not found`);
    const surcharges = await this.db
      .select()
      .from(rateSurcharges)
      .where(eq(rateSurcharges.rateCardId, id));
    return { ...card, surcharges };
  }

  /** Card and its surcharges in one transaction — a card with half its costs is worse than none. */
  async createCard(tenantId: string, dto: CreateRateCard) {
    const { surcharges, ...card } = dto;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(rateCards)
        .values({
          tenantId,
          kind: card.kind,
          carrierId: card.carrierId ?? null,
          carrierName: card.carrierName,
          mode: card.mode,
          origin: card.origin,
          destination: card.destination,
          containerType: card.containerType ?? null,
          buyAmountCents: card.buyAmountCents,
          currency: card.currency,
          transitDays: card.transitDays ?? null,
          validFrom: card.validFrom,
          validTo: card.validTo,
        })
        .returning();
      if (!row) throw new UnprocessableEntityException("Rate card could not be created");
      const written = await this.writeSurcharges(tx, row.id, surcharges);
      return { ...row, surcharges: written };
    });
  }

  async updateCard(tenantId: string, id: string, dto: UpdateRateCard) {
    const existing = await this.getCard(tenantId, id);

    // The window has to be checked against the merged row: a PATCH that moves
    // only one end of it is valid in isolation and invalid in context.
    const validFrom = dto.validFrom ?? existing.validFrom;
    const validTo = dto.validTo ?? existing.validTo;
    if (validFrom >= validTo) {
      throw new UnprocessableEntityException(
        `validFrom (${validFrom.toISOString()}) must be before validTo (${validTo.toISOString()})`,
      );
    }
    const origin = dto.origin ?? existing.origin;
    const destination = dto.destination ?? existing.destination;
    if (origin === destination) {
      throw new UnprocessableEntityException("Origin and destination must differ");
    }

    const [row] = await this.db
      .update(rateCards)
      .set({
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(dto.carrierId !== undefined && { carrierId: dto.carrierId ?? null }),
        ...(dto.carrierName !== undefined && { carrierName: dto.carrierName }),
        ...(dto.mode !== undefined && { mode: dto.mode }),
        ...(dto.origin !== undefined && { origin: dto.origin }),
        ...(dto.destination !== undefined && { destination: dto.destination }),
        ...(dto.containerType !== undefined && { containerType: dto.containerType ?? null }),
        ...(dto.buyAmountCents !== undefined && { buyAmountCents: dto.buyAmountCents }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.transitDays !== undefined && { transitDays: dto.transitDays ?? null }),
        ...(dto.validFrom !== undefined && { validFrom: dto.validFrom }),
        ...(dto.validTo !== undefined && { validTo: dto.validTo }),
      })
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId)))
      .returning();
    return { ...row!, surcharges: existing.surcharges };
  }

  /**
   * Replace the whole surcharge set rather than patching individual rows.
   * A tariff arrives as a sheet, not as a diff, and "these are the costs now"
   * is the only statement that cannot leave a withdrawn BAF behind.
   */
  async replaceSurcharges(tenantId: string, id: string, surcharges: Surcharge[]) {
    await this.getCard(tenantId, id);
    return this.db.transaction(async (tx) => {
      await tx.delete(rateSurcharges).where(eq(rateSurcharges.rateCardId, id));
      return this.writeSurcharges(tx, id, surcharges);
    });
  }

  /** Hard delete. Quotes already issued keep their own priced lines, so history survives. */
  async deleteCard(tenantId: string, id: string): Promise<void> {
    await this.getCard(tenantId, id);
    await this.db
      .delete(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId)));
  }

  // --- margin rules ---------------------------------------------------------

  /**
   * Most specific first, which is the order the quote engine resolves them in
   * — so the list reads top-down as "this is the rule that will actually
   * apply", rather than as an unordered pile an operator has to simulate.
   */
  async listMarginRules(tenantId: string) {
    return this.db
      .select()
      .from(marginRules)
      .where(eq(marginRules.tenantId, tenantId))
      .orderBy(
        desc(
          sql`(${marginRules.customerId} is not null)::int + (${marginRules.origin} is not null)::int + (${marginRules.destination} is not null)::int + (${marginRules.mode} is not null)::int`,
        ),
        desc(marginRules.createdAt),
      )
      .limit(500);
  }

  async createMarginRule(tenantId: string, dto: CreateMarginRule) {
    const [row] = await this.db
      .insert(marginRules)
      .values({
        tenantId,
        customerId: dto.customerId ?? null,
        origin: dto.origin ?? null,
        destination: dto.destination ?? null,
        mode: dto.mode ?? null,
        marginBps: dto.marginBps,
        minMarginCents: dto.minMarginCents,
      })
      .returning();
    return row!;
  }

  async updateMarginRule(tenantId: string, id: string, dto: UpdateMarginRule) {
    const [row] = await this.db
      .update(marginRules)
      .set({
        ...(dto.customerId !== undefined && { customerId: dto.customerId ?? null }),
        ...(dto.origin !== undefined && { origin: dto.origin ?? null }),
        ...(dto.destination !== undefined && { destination: dto.destination ?? null }),
        ...(dto.mode !== undefined && { mode: dto.mode ?? null }),
        ...(dto.marginBps !== undefined && { marginBps: dto.marginBps }),
        ...(dto.minMarginCents !== undefined && { minMarginCents: dto.minMarginCents }),
      })
      .where(and(eq(marginRules.id, id), eq(marginRules.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException(`Margin rule ${id} not found`);
    return row;
  }

  /**
   * Deleting the last catch-all rule leaves the tenant unable to quote
   * anything, so it is refused: `buildQuote` throws `NoMarginRuleError` when
   * nothing matches, and discovering that from a customer-facing 422 is a
   * worse way to learn it than being told here.
   */
  async deleteMarginRule(tenantId: string, id: string): Promise<void> {
    const rules = await this.db
      .select()
      .from(marginRules)
      .where(eq(marginRules.tenantId, tenantId));
    const target = rules.find((r) => r.id === id);
    if (!target) throw new NotFoundException(`Margin rule ${id} not found`);

    const isWildcard = (r: (typeof rules)[number]) =>
      !r.customerId && !r.origin && !r.destination && !r.mode;
    if (isWildcard(target) && !rules.some((r) => r.id !== id && isWildcard(r))) {
      throw new UnprocessableEntityException(
        "This is the only catch-all margin rule; deleting it would leave lanes unquotable. " +
          "Create a replacement first, or narrow this rule instead.",
      );
    }

    await this.db
      .delete(marginRules)
      .where(and(eq(marginRules.id, id), eq(marginRules.tenantId, tenantId)));
  }

  // --- internals ------------------------------------------------------------

  private async writeSurcharges(
    tx: Pick<Db, "insert">,
    rateCardId: string,
    surcharges: Surcharge[],
  ) {
    if (surcharges.length === 0) return [];
    return tx
      .insert(rateSurcharges)
      .values(surcharges.map((s) => ({ ...s, rateCardId })))
      .returning();
  }
}
