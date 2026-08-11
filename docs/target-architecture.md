# Target architecture — audit and proposal

Response to the integration brief. Steps A–F are an inspection of what exists;
step G is the proposal. **No production code has been modified.**

Every count, path and quoted comment below was read from the repository during
this audit, not recalled.

---

## A. Current architecture

```
  Operator console · Partner console · Shipper portal        (apps/web, Next.js)
                              │
                              ▼
        ┌───────────────────────────────────────────┐
        │  API — NestJS, 22 modules, 14 controllers │  ← the only writer
        │  JWT guard (Keycloak JWKS) → tenantId     │
        └────────────────────┬──────────────────────┘
                             │  one transaction
                             ▼
        ┌───────────────────────────────────────────┐
        │  PostgreSQL — 29 tables + `events` outbox │
        └────────────────────┬──────────────────────┘
                             │  outbox relay (kafkajs, polling)
                             ▼
                    Redpanda — durable log
                             │
                             ▼
        Event dispatcher — 5 consumers, independent watermarks
        ├── lifecycle-projector      advances shipment status
        ├── billing-accrual          charges follow events that cost money
        ├── ledger-sink              revenue ontology
        ├── notification-dispatcher  Novu → WhatsApp / email
        └── workflow-signaler        signals Temporal
                             │
                             ▼
        Temporal — apps/worker, `shipment-lifecycle` workflow
        durable timers, retries, multi-day waits
```

**Inbound from the outside world:** four adapters behind `IngestKeyGuard`
(`x-api-key`) — `dcsa.adapter` (carrier track & trace), `traccar.adapter` (road
GPS), `edifact.adapter` (terminal EDI), `ais.adapter` + a WebSocket listener
(vessel positions).

### The two invariants everything else rests on

**1. The event row commits with the business rows.** A command does not write
data and then publish; the event is appended to the `events` table inside the
same transaction. An event therefore exists if and only if the fact it describes
is true. This is a transactional outbox, and it is why the invoice, the customer
timeline and the ledger cannot drift.

**2. Every read model is a projection.** From `packages/events/src/envelope.ts`:

> Events are immutable. Corrections are new events, never updates.
> `occurredAt` is when the fact happened in the real world; `recordedAt` is when
> we learned it. All read models are projections of this stream.

Each consumer holds its own watermark in `consumer_offsets`, so one projection
can be rebuilt by rewinding a single row without replaying into the other four.

---

## B. Services map

| Deployable | Path | Responsibility |
|---|---|---|
| API | `apps/api` | Every write. 22 modules; the only component permitted to mutate the database. |
| Worker | `apps/worker` | Temporal worker running `shipment-lifecycle`. |
| Web | `apps/web` | Operator console, partner console, shipper portal — separated by tenant type, not hostname. |
| Console | `console/` | Single-file build of the whole product, seeded, no server. Ports the same arithmetic. |

Shared: `packages/db` (Drizzle, 29 tables) · `packages/events` (28 events,
envelope, factory) · `packages/ontology-bridge` (revenue ontology mapping).

---

## C. Existing APIs

Fourteen controllers. Abbreviated to the shape that matters for integration:

| Domain | Surface |
|---|---|
| `quotes` | `POST /quotes` · `GET /quotes/:id` · `GET /quotes/:id/pdf` |
| `bookings` | `POST /quotes/:id/book` · `GET /shipments/:id` |
| `shipments` | `GET /shipments` · `/shipments/:id/events` · `/ops/exceptions` · `/ops/corridors` |
| `consignments` | `POST /consignments/measure` · `GET|PATCH /consignments/:id` |
| `rates` | Full CRUD on cards, surcharges, margin rules |
| `customs` | `GET /customs/classify` · entries: create, confirm-line, prepare, submit, outcome, bureau-payload |
| `documents` | `GET /documents/review-queue` · `POST /documents/:id/review` |
| `billing` | Invoices, charges, audit, exceptions, dispute-packet, payments, finance views, platform fees |
| `compliance` | `GET /parties/:id` · `POST /parties/:id/customer-tenant` |
| `integrations` | `GET /integrations` · compliance filings |
| `tenants` | Partners, fee rate, `me`, `network` |
| `portal` | Customer-scoped shipments, events, invoices |
| `ingest` | `POST /ingest/dcsa` · `/traccar` · `/edifact` — API-key guarded |
| `system` | `GET /system/monitor` |

**This is already the authorized-API boundary the brief requires.** Nothing new
is needed to satisfy "must go through authorized APIs" — the surface exists and
is guarded.

---

## D. Database schema

29 tables in `packages/db/src/schema.ts`:

`tenants` · `parties` · `shipment_parties` · `rate_cards` · `rate_surcharges` ·
`margin_rules` · `consignments` · `cargo_items` · `quotes` · `quote_lines` ·
`bookings` · `shipments` · `legs` · `containers` · `shipment_exceptions` ·
`consumer_offsets` · `documents` · `customs_entries` · `customs_entry_lines` ·
`charges` · `invoices` · `tenant_billing_profiles` · `charge_code_aliases` ·
`invoice_exceptions` · `fuel_index_quotes` · `compliance_filings` · `payments` ·
`ledger_events` · `events`

Shipment lifecycle: `BOOKED → IN_TRANSIT → AT_DESTINATION_PORT → CUSTOMS →
ON_DELIVERY → DELIVERED`, plus `CANCELLED`.

---

## E. Missing events

The catalogue holds 28 events and covers the operational chain well. Against the
target architecture, the gaps are:

| Missing | Why it is needed |
|---|---|
| **`ShipmentClosed`** | The catalogue ends at `PaymentReceived`; `PodConfirmed` is delivery, not commercial closure. **Nothing marks a job finished, so a postmortem has no trigger.** |
| **`DocumentRejected`** | **A live defect.** `documents.controller.ts` accepts `decision: "APPROVED" \| "REJECTED"` and the schema carries a `REJECTED` state, but the catalogue holds only `DocumentApproved`. A rejection changes state and **emits nothing** — so it is invisible to every projection, and the platform's own invariant ("all read models are projections of this stream") is violated for that path. Found by checking the proposed event list against the catalogue. |
| `OutcomeRecorded` | Expected vs actual has been reconciled for a shipment. |
| `ScorecardUpdated` | Carrier/lane performance recomputed. |
| `PolicyProposed` / `PolicyApproved` / `PolicyRejected` / `PolicyDeployed` | The proposal lifecycle the brief requires for controlled recommendations. |
| `AgentActionTaken` | Audit of every agent tool call. |

### Idempotency and retryability — already satisfied

The brief requires idempotent events and retryable consumers. Both exist:

- `EventEnvelope.sourceRef` is documented as *"Idempotency key for
  adapter-sourced events (e.g. carrier message id)"* — inbound de-duplication is
  designed in.
- Handlers are required to be idempotent by contract (`event-dispatcher.service.ts`:
  *"Handlers must be idempotent — a crash…"*), and replay is driven off
  `consumer_offsets`.
- Writes use `onConflictDoNothing` / `onConflictDoUpdate` throughout —
  `ledger-sink`, `payments` (keyed on `invoiceId + paymentRef`), `fuel_index`,
  `sars-filing` (*"Our idempotency key. Retrying a submission with the same
  reference must…"*).

**No new idempotency machinery is required.** This is a completed requirement,
not an outstanding one.

### The proposed envelope, measured against the existing one

The brief proposes a standard envelope. The platform already has one, and the
differences are not cosmetic — adopting the proposed shape would remove
capabilities the freight domain depends on.

| Proposed | Existing | Why the existing one wins |
|---|---|---|
| `timestamp` | `occurredAt` **and** `recordedAt` | A carrier reports Tuesday's departure on Friday. One timestamp forces you to pick which of the two truths to record. **Late-arriving milestones are the norm in freight, not an edge case.** |
| `source: "tracking-service"` | `actor: { kind, id, tenantId }` | A string cannot be authorised or audited. The typed actor already spans `USER \| SYSTEM \| ADAPTER \| WORKFLOW`. |
| *(no tenant)* | `tenantId` on every event | The platform is multi-tenant and sold to competing forwarders. Tenant on the event is not optional. |
| *(no idempotency key)* | `sourceRef` | The brief itself requires idempotent events; the proposed envelope has no key to deduplicate on. |
| `data: {}` untyped | Zod-validated payload per `type` + `version` | Malformed events are rejected at the boundary rather than discovered in a projection. |

**Proposal: keep the existing envelope unchanged.** The only amendment needed is
adding `AGENT` to `EventActor.kind`.

Event names differ (`shipment.departed` vs `VesselDeparted`), but renaming 28
events across the schema, catalogue, five consumers and Temporal signals would be
a large, purely cosmetic migration with real risk and no functional gain.

### One correction on direction of flow

The brief's diagram has the event bus at the top, feeding Kestra, n8n and Hermes,
which then write into Freight Core. The existing design inverts that, and the
inversion is the point:

```
   Freight Core  ──emits──►  event log  ──►  consumers (incl. n8n, an agent)
   (writes fact + event                          │
    in ONE transaction)                          └──►  act via authorized APIs
```

Events **originate from the system of record**, inside the transaction that made
the fact true. A bus that tells the core what happened can carry an event for a
write that never committed. A bus fed *by* the core cannot.

### The finding that most affects the agent design

`EventActor.kind` is already `USER | SYSTEM | ADAPTER | WORKFLOW`, with an id and
tenant. The system was built expecting non-human actors and attributing their
writes. Adding `AGENT` to that union gives full agent attribution **through the
existing audit trail** — every action an agent takes is already recorded in the
same immutable log as everything else, with no parallel audit system.

---

## F. Integration boundaries

| Boundary | Mechanism | Status |
|---|---|---|
| Human → platform | JWT (Keycloak JWKS); `tenantId` from token, never body | Exists |
| Machine → platform (inbound facts) | `POST /ingest/*` behind `IngestKeyGuard` | **Exists — this is the n8n seam** |
| Platform → outside | 11 declared integrations, each with `degradesTo` | Exists |
| Platform → orchestration | `workflow-signaler` → Temporal | Exists |
| Platform → agent | — | **Missing. This is the work.** |

---

## G. Proposed architecture

### G.1 The orchestration question, settled once

The brief assigns Kestra: *durable orchestration, shipment lifecycle, retries,
timeouts, scheduled and event-driven workflows, exception workflows.*

Every item on that list is implemented and running in Temporal
(`apps/worker/src/workflows/shipment-lifecycle.ts`, signalled by
`workflow-signaler`). The brief was written before the repository was inspected,
which is exactly what step A was for.

Running both would mean two engines able to advance the same shipment, with no
single answer to which one owns its state when they disagree — the failure mode
is a container nobody is driving.

**Proposal: Temporal fills the Kestra role. Kestra is not added.** If it is
adopted later regardless, the safe division is by *domain*, never by shipment:
Temporal keeps the shipment lifecycle, Kestra takes scheduled data jobs
(scorecard rebuilds, rate ingestion, reporting) that never touch shipment state.
That split is stable; splitting the lifecycle is not.

### G.2 n8n — adopted, at the edge only

n8n fills a genuinely empty slot: the outside world's mess. Customer email,
carrier PDFs, WhatsApp, CRM sync. Without it, that logic accretes inside the API
and changes every time a carrier changes an email template.

```
  email · WhatsApp · CRM · carrier portals
                  │
                  ▼
                n8n            ← translates chaos into canonical requests
                  │  HTTP + x-api-key
                  ▼
        POST /ingest/*  ·  POST /quotes  ·  authorized API surface
                  │
                  ▼
             Freight Core      ← still the only writer
```

**Rules, non-negotiable:** n8n never writes to PostgreSQL; it never holds
shipment state; it calls only authenticated API endpoints; it is not the state
machine. It sits *in front of* the platform, never behind it.

### G.3 Hermes — adopted, but sequenced behind the data it needs

Hermes is the reasoning and learning layer. It cannot be attached first: an
analyst with no records to read produces confident advice with nothing behind
it, which is worse than no advice because it invites action.

Two things must exist before it is useful:

1. **Outcome data** — expected vs actual per shipment. Does not exist today.
2. **A read-only tool surface** — an MCP server over the existing API, so the
   agent reaches freight data through authorized endpoints and never the
   database.

```
   Hermes  ──MCP (read-only first)──►  freight-mcp  ──HTTP──►  API  ──►  DB
      │                                     │
      │ proposes                            └── every call logged to agent_actions
      ▼
  policy_proposals ──backtest──► human approval ──► deployed policy
      │
      └── carrier selection gains a reliability input beside price
```

**The brief's rule — no agent may mutate critical state except through
authorized APIs — is enforced structurally:** the agent's only route to the
platform is the MCP server, whose only route is the guarded API surface. There is
no path that bypasses it, because none is built.

### G.4 Autonomy, tiered by risk

`config/autonomy-policy.yaml`. The agent decides what it wants to do; the policy
engine decides whether it may. A prompt is not an access-control mechanism.

**Status: the file exists and is enforced today, but only for the three live
scheduled automations** (SLA sweep, carrier confirmation, sanctions
re-screening — see `infrastructure/kestra/WORKFLOWS.md`) — those sections are
validated at API boot and the process refuses to start if they're missing or
malformed. The agent-write-action governance below (`carrier_booking`,
`price_adjustment`, etc.) is captured in the file's `not_yet_enforced` section
with the same numbers, but **no code reads that section** — there are no
write tools for it to gate, since `services/freight-mcp/` is read-only by
construction (see `hermes/TOOLS.md`). This subsection stays the design target
for when that changes.

```yaml
customer_notification:    { level: automatic }
document_validation:      { level: automatic }
carrier_recommendation:   { level: automatic }
carrier_booking:          { level: automatic, max_value_zar: 100000 }
price_adjustment:         { level: approval,  max_variance_pct: 5 }
shipment_cancellation:    { level: approval }
customer_refund:          { level: approval }
production_policy_change: { level: approval }
```

Above the ceiling, the action becomes a queued proposal with its evidence — the
same raise-it-for-a-human pattern `shipment_exceptions` already uses, so
operators meet one idea rather than two. **No policy change reaches production
routing without a human, at any autonomy level.**

---

## Files that would need modification

Additive in every case; no existing behaviour is replaced.

| File | Change |
|---|---|
| `packages/events/src/catalogue.ts` | Add `ShipmentClosed` + 7 learning/agent events |
| `packages/events/src/envelope.ts` | Add `AGENT` to `EventActor.kind` |
| `packages/db/src/schema.ts` | Add 4 tables (below) |
| `apps/api/src/app.module.ts` | Register `OutcomesModule`, `ScorecardsModule`, `PolicyModule` |
| `apps/api/src/modules/projector/projector.module.ts` | Register `outcome-recorder` as a 6th consumer |
| `apps/api/src/modules/quoting/quote-engine.ts` | `selectRateCard` takes an optional reliability input; **feature-flagged, price-only when confidence is low** |
| `apps/api/src/modules/billing/*` | Emit `ShipmentClosed` when a shipment's commercial life ends |
| `apps/web/src/app/*` | Two screens: carrier performance, proposal approval queue |
| `docker-compose.yml` | n8n service (dev) |
| `.env.example` | n8n, MCP, agent, policy config |

## New services required

| Service | Path | Notes |
|---|---|---|
| `freight-mcp` | `services/freight-mcp/` | MCP server over the API. **Read-only tools only** — not write tools behind a flag. Contract in `hermes/TOOLS.md`; the skills that consume it are in `hermes/skills/`. |
| n8n | `infrastructure/n8n/` | Deployment + credentials only. No custom code. |
| Simulator | `services/freight-sim/` | Synthetic shipments with injected delay, congestion, rejection. The only honest way to test whether the loop learns. |

## APIs required

| Endpoint | Purpose |
|---|---|
| `GET /shipments/:id/outcome` | Reconciled expected vs actual |
| `GET /carriers/performance` | Scorecards, filterable by lane and period |
| `GET /policy/proposals` · `POST /policy/proposals/:id/approve` · `/reject` | Approval queue |
| `GET /policy/autonomy` | Effective policy, for display and audit |
| `POST /agent/actions` | Agent action audit sink |

All tenant-scoped through the existing guard. No new auth mechanism.

## New tables

| Table | Holds |
|---|---|
| `shipment_outcomes` | One immutable row per closed shipment: planned vs actual carrier, route, transit, cost, margin; exception and document-error counts |
| `carrier_scorecards` | Derived: on-time rate, mean delay, roll rate, per carrier × lane × period, **with sample size** |
| `policy_proposals` | Proposal, evidence, backtest result, state, decider, timestamps |
| `agent_actions` | Agent id, shipment id, tool, arguments, policy verdict, outcome |

---

## Risks

| Risk | Severity | Handling |
|---|---|---|
| Learning from too little data | High | Scorecards carry sample size; below threshold, selection ignores them entirely. A carrier is not "unreliable" on two shipments. |
| Self-fulfilling scores | High | A carrier starved of volume stops accruing evidence and can never recover. Reserve an exploration share of allocation. |
| Plausible but wrong proposal | High | Backtest against history before review. **A proposal that cannot be backtested cannot be approved.** |
| Correlation mistaken for cause | Medium | Season, congestion and carrier confound. Proposals state evidence; humans approve; never auto-deploy. |
| Cross-tenant data leakage | **High — commercial** | Scorecards are tenant-scoped by default. See below. |
| n8n becoming a second system of record | Medium | Enforced by rule: no DB access, no state, API-only. Worth a review gate, since this erodes quietly. |
| Agent action without attribution | Medium | `AGENT` actor kind + `agent_actions`; an unattributable action is a defect. |
| Two orchestrators | High | Avoided by not adding Kestra. If adopted, split by domain, never by shipment. |

### The commercial risk that needs your decision, not mine

The stated intent is to sell the platform to forwarders **and** operate as one.
That forces an explicit answer: **may a partner tenant's shipment outcomes inform
scorecards that another tenant — including our own operating business — can
see?**

The default in this proposal is **no**: scorecards are tenant-scoped. A
cross-tenant intelligence layer may well be the more valuable product, but it is
a commercial and legal decision, and building it quietly would be exactly the
conflict your own strategy notes flagged. Flagged, not built.

---

## Migration plan

Vertical slices. Each ships on its own, each proves the one before it. No slice
begins before its predecessor is tested.

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| 1 | **`ShipmentClosed` + outcomes** | Expected-vs-actual reporting that does not exist today | — |
| 2 | **Scorecards** | Which carriers actually perform, per lane. Read-only in the console | 1 |
| 3 | **Reliability in selection** | `selectRateCard` weighs reliability beside price, behind a flag | 2 |
| 4 | **Policy engine + proposals** | `autonomy-policy.yaml`, proposal lifecycle, approval queue | 3 |
| 5 | **`freight-mcp`, read-only** | The agent seam, with audit logging | 4 |
| 6 | **Hermes attached, advisory** | Reasoning over real data; recommends, executes nothing | 5 |
| 7 | **Simulator** | Whether the loop actually learns, measured | 3 |
| 8 | **Controlled writes** | Low-risk agent actions under the policy ceiling | 6, 7 |
| 9 | **n8n** | Email/CRM/WhatsApp edge | *independent — can start any time* |

Slices 1–3 are valuable with no agent involved at all. Slices 5–7 are what make
attaching one safe. Slice 9 is independent of the whole sequence.

**Recommended start: slice 1.** It is additive, has no dependencies, and answers
a question the business cannot answer today — which carriers actually deliver
when they said they would.

## Not changing

`packages/db` core tables · the event envelope's existing invariants · the 28
existing events · Temporal workflows · the 14 controllers · quote arithmetic
(gaining an input, not new maths) · billing · customs · compliance · documents ·
the console · the shipper portal.
