import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  marginRules,
  parties,
  quoteLines,
  quotes,
  type Db,
} from "@forge-freight/db";
import { makeEvent, QuoteIssued, type EventActor } from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";
import { ConsignmentsService } from "../consignments/consignments.service.js";
import { RatesService } from "../rates/rates.service.js";
import type { CreateConsignment } from "../consignments/consignments.dto.js";
import {
  buildQuote,
  NoMarginRuleError,
  NoRateError,
  NoServiceLevelError,
  type MarginRuleInput,
  type QuoteRequest,
  type QuoteResult,
} from "./quote-engine.js";

export interface IssueQuoteInput extends QuoteRequest {
  tenantId: string;
  incoterm:
    | "EXW" | "FCA" | "FAS" | "FOB" | "CFR" | "CIF"
    | "CPT" | "CIP" | "DAP" | "DPU" | "DDP";
  validityDays?: number;
  /** Captured inline with the quote, or referenced if already recorded. */
  consignment?: CreateConsignment;
  consignmentId?: string;
  actor: EventActor;
}

@Injectable()
export class QuotingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RatesService) private readonly rates: RatesService,
    @Inject(ConsignmentsService) private readonly consignments: ConsignmentsService,
  ) {}

  /**
   * Price + persist + emit `quote.issued`. The write of the quote projection
   * and the event append happen in one transaction; the Redpanda publish is
   * done by the outbox relay reading the events table (transactional outbox).
   */
  async issueQuote(input: IssueQuoteInput) {
    // Capture what is actually being shipped before pricing it. Chargeable
    // weight, handling uplift and the transit ceiling all come from here, so
    // this has to happen first or the quote is priced on assumptions.
    const consignment = input.consignment
      ? await this.consignments.create(input.tenantId, input.consignment, input.mode)
      : input.consignmentId
        ? await this.consignments.get(input.tenantId, input.consignmentId)
        : null;

    const cards = await this.rates.findForLane({
      tenantId: input.tenantId,
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
      at: input.requestedAt,
    });

    const ruleRows = await this.db
      .select()
      .from(marginRules)
      .where(eq(marginRules.tenantId, input.tenantId))
      // Deterministic order in, deterministic rule out: `resolveMarginRule`
      // breaks specificity ties by recency, and an unordered scan made that
      // depend on the query plan.
      .orderBy(desc(marginRules.createdAt));
    const rules: MarginRuleInput[] = ruleRows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      origin: r.origin,
      destination: r.destination,
      mode: r.mode,
      marginBps: r.marginBps,
      minMarginCents: r.minMarginCents,
      createdAt: r.createdAt,
    }));

    // "We don't price that lane" and "this tenant has no margin rule" are
    // ordinary answers to an ordinary request, not server faults. Without this
    // they reach the catch-all filter and come back as a 500 "Internal server
    // error" with a stack trace in the logs — which tells a customer nothing
    // and buries a real configuration gap under noise.
    let result: QuoteResult;
    try {
      result = buildQuote(
        {
          ...input,
          cargoType: consignment?.cargoType,
          urgency: consignment?.urgency,
          chargeableWeightGrams: consignment?.chargeableWeightGrams,
        },
        cards,
        rules,
      );
    } catch (err) {
      if (
        err instanceof NoRateError ||
        err instanceof NoMarginRuleError ||
        err instanceof NoServiceLevelError
      ) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }

    const quoteId = randomUUID();
    const validUntil = new Date(
      input.requestedAt.getTime() + (input.validityDays ?? 14) * 86_400_000,
    );
    // Headline total: the largest single-currency sell total. Full breakdown
    // lives in the lines; FX-normalised totals are a portal concern.
    const [headlineCurrency, headlineTotal] = Object.entries(
      result.totalsByCurrency,
    ).sort((a, b) => b[1] - a[1])[0] ?? ["ZAR", 0];

    const event = makeEvent({
      definition: QuoteIssued,
      tenantId: input.tenantId,
      actor: input.actor,
      payload: {
        quoteId,
        customerId: input.customerId,
        origin: input.origin,
        destination: input.destination,
        mode: input.mode,
        containerType: (input.containerType as never) ?? null,
        incoterm: input.incoterm,
        validUntil: validUntil.toISOString(),
        lines: result.lines.map((l) => ({
          chargeCode: l.chargeCode,
          description: l.description,
          quantity: l.quantity,
          buy: { amountCents: l.buyCents, currency: l.currency },
          sell: { amountCents: l.sellCents, currency: l.currency },
        })),
        totalSell: { amountCents: headlineTotal, currency: headlineCurrency },
      },
    });

    await this.db.transaction(async (tx) => {
      await tx.insert(quotes).values({
        id: quoteId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        status: "ISSUED",
        origin: input.origin,
        destination: input.destination,
        mode: input.mode,
        containerType: input.containerType as never,
        containerQuantity: input.quantity,
        incoterm: input.incoterm,
        consignmentId: consignment?.id ?? null,
        totalSellCents: headlineTotal,
        currency: headlineCurrency,
        validUntil,
      });
      await tx.insert(quoteLines).values(
        result.lines.map((l) => ({
          quoteId,
          chargeCode: l.chargeCode,
          description: l.description,
          quantity: l.quantity,
          buyCents: l.buyCents,
          sellCents: l.sellCents,
          currency: l.currency,
        })),
      );
      await appendEvent(tx, event);
    });

    return { quoteId, result, consignment };
  }

  /** Tenant-scoped fetch — a quote is invisible outside its tenant. */
  async getQuote(quoteId: string, tenantId: string) {
    const [quote] = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, tenantId)));
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    const lines = await this.db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quoteId));
    return { ...quote, lines };
  }

  async getQuotePdfData(quoteId: string, tenantId: string) {
    const quote = await this.getQuote(quoteId, tenantId);
    const [customer] = await this.db
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, quote.customerId));

    const totalsByCurrency: Record<string, number> = {};
    for (const line of quote.lines) {
      totalsByCurrency[line.currency] =
        (totalsByCurrency[line.currency] ?? 0) + line.sellCents * line.quantity;
    }

    return {
      quoteId: quote.id,
      customerName: customer?.name ?? "—",
      origin: quote.origin,
      destination: quote.destination,
      mode: quote.mode,
      containerType: quote.containerType,
      containerQuantity: quote.containerQuantity,
      incoterm: quote.incoterm,
      validUntil: quote.validUntil,
      createdAt: quote.createdAt,
      lines: quote.lines,
      totalsByCurrency,
    };
  }
}
