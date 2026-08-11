import { z } from "zod";
import type { FreightClient } from "./client.js";

/**
 * The read-only tool surface, as data.
 *
 * Declaring the tools as a list rather than as a series of registrations makes
 * two useful things possible: the set can be enumerated in a test, and the
 * read-only claim becomes something a test can *check* rather than something a
 * README asserts. There is no `method` field, and no code path in this server
 * that issues anything but a GET — so "read-only" is a property of what exists
 * here, not of a setting somebody could change.
 *
 * The contract these implement is `hermes/TOOLS.md`, and the skills that call
 * them are in `hermes/skills/`. All three are meant to stay in step.
 */
export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodTypeAny;
  /** Path (and query) to fetch. Never a body, never a verb. */
  call: (client: FreightClient, args: Record<string, never>) => Promise<unknown>;
}

const Uuid = z.string().uuid();
const Page = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

/** Typed helper so each definition stays a one-liner. */
function def<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  input: S,
  call: (client: FreightClient, args: z.infer<S>) => Promise<unknown>,
): ToolDef {
  return {
    name,
    description,
    input,
    call: call as ToolDef["call"],
  };
}

export const TOOLS: ToolDef[] = [
  def(
    "get_shipment",
    "One shipment: status, lane, incoterm, legs, containers and the consignment it is carrying.",
    z.object({ shipmentId: Uuid }),
    (c, a) => c.get(`/shipments/${a.shipmentId}`),
  ),

  def(
    "list_shipments",
    "A page of the book, newest first. Use for 'what is in flight' rather than to find one shipment.",
    Page,
    (c, a) => c.get("/shipments", { query: { limit: a.limit, cursor: a.cursor } }),
  ),

  def(
    "get_shipment_history",
    "The event log for one shipment — what actually happened, in order. This is ground truth; " +
      "status elsewhere is a projection of it. Note both occurredAt (when it happened) and " +
      "recordedAt (when we learned it): a carrier reporting Tuesday's departure on Friday is normal.",
    z.object({ shipmentId: Uuid }),
    (c, a) => c.get(`/shipments/${a.shipmentId}/events`),
  ),

  def(
    "get_quote",
    "A quote with its lines, each carrying buy, sell and currency.",
    z.object({ quoteId: Uuid }),
    (c, a) => c.get(`/quotes/${a.quoteId}`),
  ),

  def(
    "get_customer",
    "A party: name, country and denied-party screening status.",
    z.object({ partyId: Uuid }),
    (c, a) => c.get(`/parties/${a.partyId}`),
  ),

  def(
    "get_rate_cards",
    "This tenant's buy side. Each card carries validity dates and surcharges; a card outside its " +
      "validity window is not a cheap card, it is not a card.",
    z.object({}),
    (c) => c.get("/rates/cards"),
  ),

  def(
    "get_margin_rules",
    "The sell side. The engine applies the most specific matching rule, breaking ties by recency.",
    z.object({}),
    (c) => c.get("/rates/margin-rules"),
  ),

  def(
    "get_documents",
    "Documents waiting on a human, with how long each has waited.",
    z.object({}),
    (c) => c.get("/documents/review-queue"),
  ),

  def(
    "get_customs_entry",
    "The customs declaration for a shipment: lines, duty, VAT and where the entry has got to.",
    z.object({ shipmentId: Uuid }),
    (c, a) => c.get(`/customs/entries/by-shipment/${a.shipmentId}`),
  ),

  def(
    "get_invoice",
    "An invoice as issued — the document the customer received, not a recomputation of it.",
    z.object({ invoiceId: Uuid }),
    (c, a) => c.get(`/invoices/${a.invoiceId}/document`),
  ),

  def(
    "get_invoice_findings",
    "Findings from the four-way match on an invoice. Findings annotate; they never block billing.",
    z.object({ invoiceId: Uuid }),
    (c, a) => c.get(`/invoices/${a.invoiceId}/exceptions`),
  ),

  def(
    "get_open_exceptions",
    "The ops kanban: everything raised and not yet cleared.",
    z.object({}),
    (c) => c.get("/ops/exceptions"),
  ),

  def(
    "get_integrations",
    "Which external systems are configured and what the platform degrades to without each. " +
      "Check this before concluding a carrier went silent — a missing feed looks exactly like " +
      "a missing milestone.",
    z.object({}),
    (c) => c.get("/integrations"),
  ),
];

/**
 * Tools a skill may ask for that do not exist yet, with the reason.
 *
 * Answering "not built, here is what it waits on" is strictly better than a
 * generic unknown-tool error: it stops the agent substituting a different tool
 * and presenting the result as though it were the one requested.
 */
export const UNAVAILABLE_TOOLS: Record<string, string> = {
  get_carrier_performance:
    "Needs carrier_scorecards, from the learning slice in docs/target-architecture.md. " +
    "Rank on price and validity meanwhile, and say reliability is unknown.",
  get_shipment_outcome:
    "Needs shipment_outcomes. Expected-versus-actual is not reconciled anywhere yet.",
  list_lessons:
    "Lessons are policy_proposals, which do not exist yet. A proposal a human has not " +
    "approved must not be readable as fact.",
  create_lesson:
    "Write tool. None are built, by design — see hermes/TOOLS.md.",
};
