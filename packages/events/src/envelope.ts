import { z } from "zod";

/**
 * Every event in FORGE Freight is wrapped in this envelope, whether it is
 * appended to the Postgres `events` table or published to Redpanda.
 *
 * Invariants:
 * - Events are immutable. Corrections are new events, never updates.
 * - `occurredAt` is when the fact happened in the real world (may be in the
 *   past, e.g. a late carrier milestone); `recordedAt` is when we learned it.
 * - `type` + `version` identify the payload schema in the catalogue.
 * - All read models are projections of this stream.
 */
export const EventActor = z.object({
  kind: z.enum(["USER", "SYSTEM", "ADAPTER", "WORKFLOW"]),
  /** Keycloak subject id for USER, adapter/service name otherwise. */
  id: z.string().min(1),
  tenantId: z.string().uuid().optional(),
});
export type EventActor = z.infer<typeof EventActor>;

export const EventEnvelope = z.object({
  eventId: z.string().uuid(),
  /** Aggregate correlation. Quote/party events may have no shipment yet. */
  shipmentId: z.string().uuid().nullable(),
  tenantId: z.string().uuid(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  actor: EventActor,
  /** Idempotency key for adapter-sourced events (e.g. carrier message id). */
  sourceRef: z.string().optional(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
