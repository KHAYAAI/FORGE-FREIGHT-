import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  bookings,
  containers,
  legs,
  parties,
  quotes,
  shipmentParties,
  shipments,
  type Db,
} from "@forge-freight/db";
import {
  makeEvent,
  QuoteAccepted,
  ShipmentBooked,
  type EventActor,
} from "@forge-freight/events";
import { ScreeningService } from "../compliance/screening.service.js";
import { ConsignmentsService } from "../consignments/consignments.service.js";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";
import { TemporalService } from "../temporal/temporal.service.js";
import { assertBookable, planLegs, QuoteNotBookableError } from "./booking-rules.js";

export interface BookQuoteResult {
  bookingId: string;
  shipmentId: string;
  reference: string;
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TemporalService) private readonly temporal: TemporalService,
    @Inject(ScreeningService) private readonly screening: ScreeningService,
    @Inject(ConsignmentsService) private readonly consignments: ConsignmentsService,
  ) {}

  /**
   * Convert an issued quote into a booking + shipment (with containers and
   * leg plan), emitting quote.accepted and shipment.booked. Everything —
   * projections and both events — lands in one transaction.
   */
  async bookQuote(params: {
    quoteId: string;
    tenantId: string;
    actor: EventActor;
    carrierBookingRef?: string;
  }): Promise<BookQuoteResult> {
    const [quote] = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, params.quoteId), eq(quotes.tenantId, params.tenantId)));
    if (!quote) throw new NotFoundException(`Quote ${params.quoteId} not found`);

    try {
      assertBookable(quote, new Date());
    } catch (err) {
      if (err instanceof QuoteNotBookableError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    // Re-screen the customer at booking — lists change between quote and book.
    const [customer] = await this.db
      .select({ name: parties.name, country: parties.country })
      .from(parties)
      .where(eq(parties.id, quote.customerId));
    if (customer) {
      const screening = await this.screening.screenParty({
        partyId: quote.customerId,
        name: customer.name,
        country: customer.country,
        tenantId: quote.tenantId,
      });
      if (screening.verdict === "HIT") {
        throw new ConflictException(
          "Booking blocked: customer failed sanctions screening — escalated to compliance",
        );
      }
    }

    const bookingId = randomUUID();
    const shipmentId = randomUUID();

    const reference = await this.db.transaction(async (tx) => {
      // Guard against double-booking: only one booking per quote.
      const updated = await tx
        .update(quotes)
        .set({ status: "ACCEPTED" })
        .where(
          and(
            eq(quotes.id, quote.id),
            sql`${quotes.status} in ('ISSUED', 'ACCEPTED')`,
            sql`not exists (select 1 from ${bookings} where ${bookings.quoteId} = ${quote.id})`,
          ),
        )
        .returning({ id: quotes.id });
      if (updated.length === 0) {
        throw new ConflictException("Quote already has a booking");
      }

      await tx.insert(bookings).values({
        id: bookingId,
        tenantId: quote.tenantId,
        quoteId: quote.id,
        customerId: quote.customerId,
        carrierBookingRef: params.carrierBookingRef ?? null,
      });

      const [shipment] = await tx
        .insert(shipments)
        .values({
          id: shipmentId,
          tenantId: quote.tenantId,
          bookingId,
          reference: sql`'FF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('shipment_ref_seq')::text, 5, '0')`,
          status: "BOOKED",
          origin: quote.origin,
          destination: quote.destination,
          // Carried by reference, not copied: the cargo the customer was
          // quoted for and the cargo that sails are provably the same rows.
          consignmentId: quote.consignmentId,
          incoterm: quote.incoterm,
        })
        .returning({ reference: shipments.reference });

      await tx.insert(shipmentParties).values({
        shipmentId,
        partyId: quote.customerId,
        role: "SHIPPER",
      });

      if (quote.containerType) {
        await tx.insert(containers).values(
          Array.from({ length: quote.containerQuantity }, () => ({
            shipmentId,
            containerType: quote.containerType!,
          })),
        );
      }

      await tx.insert(legs).values(
        planLegs(quote).map((leg) => ({
          shipmentId,
          sequence: leg.sequence,
          mode: leg.mode,
          origin: leg.origin,
          destination: leg.destination,
        })),
      );

      await appendEvent(
        tx,
        makeEvent({
          definition: QuoteAccepted,
          tenantId: quote.tenantId,
          actor: params.actor,
          payload: { quoteId: quote.id, customerId: quote.customerId },
        }),
      );
      await appendEvent(
        tx,
        makeEvent({
          definition: ShipmentBooked,
          tenantId: quote.tenantId,
          actor: params.actor,
          shipmentId,
          payload: {
            bookingId,
            quoteId: quote.id,
            customerId: quote.customerId,
            origin: quote.origin,
            destination: quote.destination,
            mode: quote.mode,
            incoterm: quote.incoterm,
            containers: quote.containerType
              ? [
                  {
                    containerType: quote.containerType,
                    quantity: quote.containerQuantity,
                  },
                ]
              : [],
            carrierBookingRef: params.carrierBookingRef ?? null,
          },
        }),
      );

      return shipment!.reference;
    });

    // Outside the transaction: workflow start is best-effort; the lifecycle
    // projector keeps projections correct regardless.
    if (this.temporal.enabled) {
      const workflowId = await this.temporal.startShipmentLifecycle({
        shipmentId,
        tenantId: quote.tenantId,
        transitDays: null,
      });
      if (workflowId) {
        await this.db
          .update(shipments)
          .set({ workflowId })
          .where(eq(shipments.id, shipmentId));
      }
    }

    return { bookingId, shipmentId, reference };
  }

  async getShipment(shipmentId: string, tenantId: string) {
    const [shipment] = await this.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), eq(shipments.tenantId, tenantId)));
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    const [shipmentLegs, shipmentContainers, consignment] = await Promise.all([
      this.db.select().from(legs).where(eq(legs.shipmentId, shipmentId)),
      this.db.select().from(containers).where(eq(containers.shipmentId, shipmentId)),
      // Null on shipments booked before consignment capture existed, which is
      // why every consumer treats it as optional rather than assuming it.
      shipment.consignmentId
        ? this.consignments.get(tenantId, shipment.consignmentId).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      ...shipment,
      legs: shipmentLegs,
      containers: shipmentContainers,
      consignment,
    };
  }
}
