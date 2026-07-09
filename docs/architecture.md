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
  append in one Postgres transaction; a relay ships events to Redpanda.

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
   quote engine, quote → booking. Engine ✅; PDF + booking conversion next.
3. **Shipment lifecycle** — Temporal workflow per shipment, signal-driven
   milestones, ops exception kanban. Workflow tests must cover the happy path
   plus rolled booking, customs stop, and port congestion delay.
4. **Tracking ingest** — adapter plugin interface: AIS (aisstream), DCSA
   T&T, EDIFACT IFTSTA/CODECO, Traccar webhooks.
5. **Documents** — upload → Claude extraction with structured output schemas
   per doc type → confidence-scored review queue → projections.
6. **Customs** — HS classification (SA tariff book, hybrid retrieval + LLM,
   human confirm below threshold), duty/VAT calc, bureau-ready entry payload.
7. **Compliance** — yente screening on party creation and booking; block +
   escalate on hits.
8. **Billing & ForgePay bridge** — charge accrual from events, invoicing,
   ontology bridge relay (spec: docs/ontology-bridge.md, already executable).
9. **Customer portal** — mobile-first shipment timeline, WhatsApp share
   links, documents, invoices.
10. **Partner console** — scoped multi-tenant ops tooling, platform fees.

## Out of scope (deliberately)

Accounting GL (ForgePay side), warehouse management, parcel/courier, direct
SARS EDI transmission (bureau adapter only).

## Tenancy

`tenants.type`: `OPERATOR` (FORGE Freight itself), `PARTNER_AGENT`
(franchise layer), `CUSTOMER` (shippers). Every business row carries
`tenant_id`; Keycloak organisations map onto tenants.
