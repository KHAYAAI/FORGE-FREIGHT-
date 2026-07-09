import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getEventDefinition, type EventDefinition } from "./catalogue.js";
import { EventEnvelope, type EventActor } from "./envelope.js";

export class UnknownEventError extends Error {
  constructor(type: string, version: number) {
    super(`Unknown event ${type}@${version} — not in the catalogue`);
    this.name = "UnknownEventError";
  }
}

export interface MakeEventInput<T extends z.ZodTypeAny> {
  definition: EventDefinition<T>;
  tenantId: string;
  actor: EventActor;
  payload: z.input<T>;
  shipmentId?: string | null;
  occurredAt?: Date;
  sourceRef?: string;
}

/** Construct a validated envelope for an event in the catalogue. */
export function makeEvent<T extends z.ZodTypeAny>(
  input: MakeEventInput<T>,
): EventEnvelope {
  const payload = input.definition.schema.parse(input.payload);
  const now = new Date();
  return EventEnvelope.parse({
    eventId: randomUUID(),
    shipmentId: input.shipmentId ?? null,
    tenantId: input.tenantId,
    type: input.definition.type,
    version: input.definition.version,
    occurredAt: (input.occurredAt ?? now).toISOString(),
    recordedAt: now.toISOString(),
    actor: input.actor,
    sourceRef: input.sourceRef,
    payload,
  });
}

/**
 * Validate an incoming envelope (e.g. consumed off Redpanda) against the
 * catalogue. Throws on unknown type/version or invalid payload.
 */
export function parseEvent(raw: unknown): EventEnvelope {
  const envelope = EventEnvelope.parse(raw);
  const def = getEventDefinition(envelope.type, envelope.version);
  if (!def) throw new UnknownEventError(envelope.type, envelope.version);
  def.schema.parse(envelope.payload);
  return envelope;
}
