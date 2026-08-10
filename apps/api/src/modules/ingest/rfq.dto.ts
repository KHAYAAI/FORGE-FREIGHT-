import { z } from "zod";
import { CreateConsignmentDto } from "../consignments/consignments.dto.js";

/**
 * An RFQ as it arrives from the outside world, after n8n has pulled it out of
 * an email, a form or a partner webhook.
 *
 * The shape is deliberately close to `POST /quotes` with two differences: the
 * customer is identified by email rather than by id, because an inbox does not
 * know your UUIDs; and a `messageId` is required, because anything arriving
 * over the internet will eventually arrive twice.
 */
export const RfqSubmissionDto = z.object({
  /**
   * Stable id of the originating message — RFC 5322 Message-ID, a webhook
   * delivery id, a form submission id. Becomes the event's idempotency key,
   * so it must be the same on a redelivery of the same request and different
   * for a genuinely new one.
   */
  messageId: z.string().min(1).max(400),
  /** Which forwarder's inbox this arrived in. n8n is configured per tenant. */
  tenantId: z.string().uuid(),
  customerEmail: z.string().email(),
  origin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  destination: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  mode: z.enum(["OCEAN", "AIR", "ROAD", "RAIL"]),
  containerType: z
    .enum(["20GP", "40GP", "40HC", "45HC", "20RF", "40RF", "LCL"])
    .nullable()
    .default(null),
  quantity: z.number().int().positive().default(1),
  incoterm: z.enum([
    "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
  ]),
  /** Without it the price is a guess — chargeable weight comes from here. */
  consignment: CreateConsignmentDto.optional(),
});

export type RfqSubmission = z.infer<typeof RfqSubmissionDto>;
