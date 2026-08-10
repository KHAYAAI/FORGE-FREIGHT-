import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { events, parties, type Db } from "@forge-freight/db";
import { QuoteIssued } from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { QuotingService } from "../quoting/quoting.service.js";
import type { RfqSubmission } from "./rfq.dto.js";

/**
 * The outcome of an inbound request for quote.
 *
 * Deliberately not exceptions: an RFQ that cannot be quoted is an ordinary
 * business outcome, not a failure of the caller. n8n needs to tell the
 * difference between "try again" and "a person has to look at this", and an
 * HTTP 500 says neither.
 */
export type RfqOutcome =
  | { status: "QUOTED"; quoteId: string; duplicate: boolean }
  | { status: "NEEDS_ONBOARDING"; reason: string }
  | { status: "NEEDS_SCREENING_REVIEW"; reason: string }
  | { status: "NO_RATE"; reason: string };

/**
 * Turns an RFQ that arrived from the outside world into a quote.
 *
 * The rules that make this safe to expose to an inbox:
 *
 * 1. **An unknown sender is never auto-onboarded.** Creating a party triggers
 *    denied-party screening, which is asynchronous — so auto-creating and
 *    immediately quoting would issue a price before anyone knows whether the
 *    counterparty is sanctioned. Unknown senders are handed to a human.
 * 2. **A party under screening review is not quoted.** Same reason, later in
 *    the same story.
 * 3. **A redelivered message does not produce a second quote.** The message id
 *    becomes the event's `sourceRef`, and the existing `(type, source_ref)`
 *    unique index does the rest.
 */
@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QuotingService) private readonly quoting: QuotingService,
  ) {}

  async submit(dto: RfqSubmission): Promise<RfqOutcome> {
    const sourceRef = `rfq:${dto.messageId}`;

    // Replay check first: a retried webhook must return the original answer,
    // not do the work again. The unique index would catch it at insert, but
    // that surfaces as a constraint error after the quote has been priced.
    const existing = await this.findQuoteBySourceRef(sourceRef);
    if (existing) {
      return { status: "QUOTED", quoteId: existing, duplicate: true };
    }

    const [customer] = await this.db
      .select({
        id: parties.id,
        name: parties.name,
        screeningStatus: parties.screeningStatus,
      })
      .from(parties)
      .where(
        and(
          eq(parties.tenantId, dto.tenantId),
          sql`lower(${parties.email}) = lower(${dto.customerEmail})`,
        ),
      )
      .limit(1);

    if (!customer) {
      this.logger.warn(
        `RFQ from unknown sender ${dto.customerEmail} — held for onboarding`,
      );
      return {
        status: "NEEDS_ONBOARDING",
        reason:
          `No customer on file for ${dto.customerEmail}. ` +
          "Onboarding runs denied-party screening, so this needs a person.",
      };
    }

    if (customer.screeningStatus !== "CLEAR") {
      return {
        status: "NEEDS_SCREENING_REVIEW",
        reason:
          `${customer.name} is ${customer.screeningStatus} on denied-party ` +
          "screening. Quoting waits for that to be resolved.",
      };
    }

    try {
      const quote = await this.quoting.issueQuote({
        tenantId: dto.tenantId,
        customerId: customer.id,
        origin: dto.origin,
        destination: dto.destination,
        mode: dto.mode,
        containerType: dto.containerType ?? null,
        quantity: dto.quantity,
        incoterm: dto.incoterm,
        consignment: dto.consignment,
        requestedAt: new Date(),
        sourceRef,
        // Attributed to the adapter, not to a person. Whoever reads this
        // quote's history can see it was raised by an inbound message.
        actor: { kind: "ADAPTER", id: "rfq-intake", tenantId: dto.tenantId },
      });
      return { status: "QUOTED", quoteId: quote.quoteId, duplicate: false };
    } catch (err) {
      // The quote engine refuses lanes it has no valid card for, and service
      // levels it cannot meet. That is a real answer to the customer, not an
      // error to retry — surfacing it as 5xx would have n8n hammering a lane
      // that is never going to price.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.log(`RFQ ${sourceRef} could not be priced: ${reason}`);
      return { status: "NO_RATE", reason };
    }
  }

  /** The quote a previous delivery of this message already produced, if any. */
  private async findQuoteBySourceRef(sourceRef: string): Promise<string | null> {
    const [row] = await this.db
      .select({ payload: events.payload })
      .from(events)
      .where(
        and(eq(events.type, QuoteIssued.type), eq(events.sourceRef, sourceRef)),
      )
      .limit(1);
    if (!row) return null;
    const payload = row.payload as { quoteId?: string };
    return payload.quoteId ?? null;
  }
}
