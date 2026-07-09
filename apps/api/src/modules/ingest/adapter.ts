import type { EventDefinition } from "@forge-freight/events";
import type { z } from "zod";

/**
 * Tracking adapter contract (Karrio-style plugin pattern): an adapter parses
 * one external payload into canonical emissions and NOTHING else — no
 * projection writes, no side effects. The ingest service resolves each
 * emission to a shipment and appends idempotent catalogue events.
 */
export interface CanonicalEmission<T extends z.ZodTypeAny = z.ZodTypeAny> {
  definition: EventDefinition<T>;
  payload: z.input<T>;
  occurredAt: Date;
  /** External message id — idempotency key (unique per type). */
  sourceRef: string;
  /** How the ingest service finds the shipment. */
  match: ShipmentMatch;
}

export type ShipmentMatch =
  | { by: "containerNumber"; containerNumber: string }
  | { by: "carrierBookingRef"; carrierBookingRef: string }
  | { by: "vesselImo"; vesselImo: string }
  | { by: "traccarDevice"; deviceId: string };

export interface TrackingAdapter {
  readonly source: string;
  parse(input: unknown): CanonicalEmission[];
}
