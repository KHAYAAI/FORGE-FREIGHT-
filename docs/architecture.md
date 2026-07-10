# FORGE Freight — architecture

Event-sourced core inside a modular monolith. Every fact is an immutable
event; Postgres holds projections; Temporal holds the live workflow per
shipment; the same stream feeds the portal, ops console, analytics, and — via
the ontology bridge — the ForgePay Revenue Ontology.

## Non-negotiables

- Every state change is an event from the versioned catalogue
  (`@forge-freight/events`). Read models are projections, rebuildable from
  the `events` table.
- No business logic in controllers — controllers validate and delegate.
- Adapters (AIS, DCSA, EDIFACT, Traccar) emit canonical events only; no
  adapter writes to projections directly. Adapter idempotency is enforced by
  the unique `(type, source_ref)` index on `events`.
- All LLM extraction is human-reviewable with confidence surfaced.
- Integer cents everywhere; every amount carries its currency. ZAR-first.
- Event publish uses the transactional outbox: projection write + event
  append in one Postgres transaction; the relay
  (`apps/api/src/modules/outbox`) ships unpublished rows to the
  `freight.events` topic in recorded order, keyed by shipment, at-least-once
  (consumers dedupe on `eventId`).
- Auth: Keycloak JWTs verified against the realm JWKS; the tenant comes from
  the token's `tenant_id` claim, never from the request body. Dev-mode header
  auth exists but the config loader refuses it in production.

## Monorepo layout

```
packages/
  events/           versioned canonical event catalogue (zod)
  db/               Drizzle schema, migrations, seed (system of record)
  ontology-bridge/  freight event → Revenue Ontology ledger event mapper
apps/
  api/              NestJS modular monolith (rates, quoting, … )
  web/              Next.js — customer portal, ops console, partner console
```

## Module build order (milestones)

1. **Foundation** — this scaffold: monorepo, event catalogue, schema,
   multi-tenancy model, docker-compose infra, seed lanes (CNSHA→ZADUR,
   ZADUR→ZAJNB road, DEHAM→ZADUR). ✅
2. **Rates & Quoting** — rate cards with validity/surcharges, margin rules,
   quote engine, quote PDF, quote → booking → shipment conversion. ✅
3. **Shipment lifecycle** — pure lifecycle reducer (tested against the happy
   path plus rolled booking, customs stop, congestion delay), event
   dispatcher/projector maintaining status + exceptions, ops exception feed,
   Temporal workflow (apps/worker) for time-based escalation. ✅
4. **Tracking ingest** — adapter plugin interface (canonical events only,
   sourceRef idempotency): DCSA T&T, Traccar webhooks, EDIFACT IFTSTA parser
   with per-partner status maps, AIS vessel positions (aisstream.io — MMSI
   learned from ShipStaticData, matched to legs by IMO). ✅
5. **Documents** — multipart upload → Claude structured extraction per doc
   type (zod schemas, self-reported confidence) → review queue; degrades to
   manual review without an API key. ✅
6. **Customs** — SA duty/VAT calculator (ATV formula), HS classification
   with confidence + mandatory human confirm below threshold, entry state
   machine (DRAFT→PREPARED→SUBMITTED→QUERY/RELEASED/STOPPED), bureau-ready
   payload. ✅ (tariff dataset is a ~90-heading reference extract with a CSV
   loader for the real gazetted schedule — see tariff-data.ts)
7. **Compliance** — yente screening on party creation and re-screen at
   booking; HIT blocks the booking and places a compliance hold; screening
   infrastructure failure fails closed to REVIEW. ✅
8. **Billing & ForgePay bridge** — vessel.departed accrues quoted charges,
   entry.released accrues the duty/VAT disbursement, invoice + payment
   endpoints, ledger sink feeding ledger_events (Revenue Ontology), duty
   financing/factoring views at GET /finance/views, Novu milestone
   notifications (WhatsApp/SMS/email per the workflow's own config). ✅
9. **Customer portal** — quote form with one-click booking, shipment list,
   event timeline, ops exception kanban. ✅
10. **Partner console** — `tenants.platform_fee_bps`, operator-only
    tenant/partner administration (`/tenants/partners`), automatic platform
    fee accrual on partner freight, partner-facing fees-owed view. ✅
    (partners still can't self-serve their own rate cards — see LAUNCH.md)

## Out of scope (deliberately)

Accounting GL (ForgePay side), warehouse management, parcel/courier, direct
SARS EDI transmission (bureau adapter only).

## Tenancy

`tenants.type`: `OPERATOR` (FORGE Freight itself), `PARTNER_AGENT`
(franchise layer), `CUSTOMER` (shippers). Every business row carries
`tenant_id`; Keycloak organisations map onto tenants.
