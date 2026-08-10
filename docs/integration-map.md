# Integration map — the learning layer

Sprint 1 deliverable: what exists, what the autonomous/human-centred scope adds,
and where the seams go. **No production code is modified by this document.**

The brief was "upgrade the platform, add what is missing, do not change the
foundations." So the first job was to establish what the foundations actually
are, because the architecture proposals under discussion were written without
sight of this repository and assume gaps that are already filled.

---

## 1. What is already here

| Layer | Where | State |
|---|---|---|
| System of record | `packages/db/src/schema.ts` — **29 tables** | Complete |
| Domain events | `packages/events/src/catalogue.ts` — **28 events**, versioned, enveloped | Complete |
| Event delivery | `outbox` → Redpanda, `consumer_offsets` for replay | Complete |
| API | **14 controllers** under `apps/api/src/modules/` | Complete |
| Orchestration | **Temporal** — `apps/worker/src/workflows/shipment-lifecycle.ts` | Complete |
| Projection | `apps/api/src/modules/projector/` + `workflow-signaler.ts` | Complete |
| Lifecycle | `shipment_status`: BOOKED → IN_TRANSIT → AT_DESTINATION_PORT → CUSTOMS → ON_DELIVERY → DELIVERED / CANCELLED | Complete |
| Exceptions + review | `shipment_exceptions`, `invoice_exceptions`, documents review queue | Complete |
| AI | `apps/api/src/modules/documents/extraction.service.ts` — **the only AI in the codebase** | Minimal |
| Learning | — | **Absent** |

### The two facts that reshape the plan

**Temporal already is the durable orchestrator.** Retries, timeouts, signals,
idempotency and multi-day waits on the shipment lifecycle are implemented in
`apps/worker/`. That is the job Kestra was proposed for. Running both would mean
two engines able to advance the same shipment, and no single answer to "who owns
this shipment's state right now." **Decision: Temporal stays, Kestra is not
added.** If an integration fabric for the messy outside world (email, WhatsApp,
CRM) is wanted later, n8n slots in at the edge — in front of the API, never
behind it — without disturbing any of this.

**The outcome data is already being written; nothing reads it back.**
`QuoteIssued` carries the expected transit and cost. `VesselArrived`,
`ContainerDischarged` and `PodConfirmed` carry the actuals. `BookingRolled`,
`ShipmentExceptionRaised` and `EntryQueried` record the failures. Every fact a
learning loop needs is already in the event stream. No consumer computes
expected-vs-actual, so the knowledge is discarded on arrival.

### The gap this scope fills

`apps/api/src/modules/quoting/quote-engine.ts` selects a carrier by
`selectRateCard` — *the cheapest valid rate card for the lane*, with a
deterministic tiebreak. It cannot know that a carrier missed its transit nine
times on that corridor last quarter, because nothing computes that. **Price is
currently the only input to carrier choice.**

---

## 2. What gets added

Four components, each a normal module in this codebase — not an external
platform, and not a rewrite of anything above.

```
   shipment closes
         │
         ▼
   ┌─────────────┐   expected (QuoteIssued) vs actual (PodConfirmed, charges)
   │  OUTCOMES   │   one immutable row per shipment
   └──────┬──────┘
          ▼
   ┌─────────────┐   carrier × lane × period reliability, from outcomes only
   │ SCORECARDS  │   rebuilt, never hand-edited
   └──────┬──────┘
          ▼
   ┌─────────────┐   proposes policy changes with evidence + backtest
   │  PROPOSALS  │   PROPOSED → BACKTESTED → REVIEWED → APPROVED → DEPLOYED
   └──────┬──────┘
          ▼
   ┌─────────────┐   decides what may act without a human, by risk
   │   POLICY    │   config/autonomy-policy.yaml
   └──────┬──────┘
          ▼
   selection reads scorecards ── quote-engine gains a reliability input
```

An **MCP server** (`services/freight-mcp/`) exposes this as read-only tools, so
Hermes — or any agent — can reason over the real system without being wired into
the database. Built natively means the loop works with no agent attached; the
agent makes it better, it is not load-bearing.

### New tables

| Table | Holds |
|---|---|
| `shipment_outcomes` | One row per closed shipment: planned vs actual carrier, route, transit, cost, margin; exception and document-error counts |
| `carrier_scorecards` | Derived: on-time rate, mean delay, roll rate, claim rate, per carrier × lane × period |
| `policy_proposals` | Proposed change, evidence, backtest result, state, decider, timestamps |
| `agent_actions` | Audit: every agent tool call — agent id, shipment id, tool, arguments, policy verdict, outcome |

`agent_actions` is not optional. An autonomous system whose actions cannot be
reconstructed afterwards is not auditable, and freight is a regulated trade.

### New events

`ShipmentClosed` — **the catalogue has no closure event.** It ends at
`PaymentReceived`; `PodConfirmed` is delivery, not commercial closure. Without
it there is no trigger for a postmortem. This is the one genuinely missing
event.

Then: `OutcomeRecorded`, `ScorecardUpdated`, `PolicyProposed`, `PolicyApproved`,
`PolicyRejected`, `PolicyDeployed`, `AgentActionTaken`.

All follow the existing envelope in `packages/events/src/envelope.ts`. No new
event format.

---

## 3. Autonomy: tiered by risk, not by prompt

Both human-control models were requested, and together they are coherent: act
automatically where a mistake is cheap and reversible, require a person where it
is not. The boundary belongs in configuration, not in a model's instructions —
a prompt is not an access-control mechanism.

`config/autonomy-policy.yaml`:

```yaml
customer_notification:      { level: automatic }
document_validation:        { level: automatic }
carrier_recommendation:     { level: automatic }
carrier_booking:            { level: automatic, max_value_zar: 100000 }
price_adjustment:           { level: approval,  max_variance_pct: 5 }
shipment_cancellation:      { level: approval }
customer_refund:            { level: approval }
production_policy_change:   { level: approval }
```

The engine sits between intent and execution: the agent decides what it wants to
do, the policy engine decides whether it may. Anything above its ceiling becomes
a queued proposal with its evidence attached — which is the same
raise-it-for-a-human pattern `shipment_exceptions` already uses, so operators
meet one idea, not two.

**No policy change reaches production routing without a human.** Ever, at any
autonomy level. The system may act inside the rules; changing the rules is a
person's decision.

---

## 4. Risks

| Risk | Handling |
|---|---|
| Learning from too little data | Scorecards carry sample size and confidence; below threshold, selection ignores them and falls back to price. A carrier is not "unreliable" on two shipments. |
| Feedback loop / self-fulfilling scores | A carrier starved of volume stops accruing evidence and can never recover its score. Reserve an exploration share of allocation. |
| Agent proposes a plausible, wrong policy | Backtest against historical shipments before review. A proposal that cannot be backtested cannot be approved. |
| Confusing correlation with cause | Congestion, season and carrier confound. Proposals state their evidence; humans approve. Never auto-deploy. |
| Cost of AI in the loop | The loop is deterministic; the agent is optional and runs per-shipment-close, not per-event. Postmortems batch. |
| Tenant data leakage | Scorecards are tenant-scoped by default. A cross-tenant carrier intelligence layer is a commercial and legal decision, not a technical default — flagged, not built. |

That last row matters given the stated intent to sell the platform to forwarders
while also operating as one. Whether a partner tenant's outcomes may inform
anything another tenant sees needs an explicit answer before scorecards span
tenants. The default here is: they may not.

---

## 5. Build order

Vertical slices, each shippable, each proving the one before it.

1. **Outcomes** — `ShipmentClosed`, `shipment_outcomes`, reconciliation from the existing event stream. Value on its own: expected-vs-actual reporting that does not exist today.
2. **Scorecards** — derived carrier × lane reliability, with confidence. Surfaced read-only in the console.
3. **Selection** — `quote-engine` gains a reliability input behind a feature flag, price-only when confidence is low. The first behavioural change.
4. **Policy engine + proposals** — `autonomy-policy.yaml`, the proposal lifecycle, the approval queue in the console.
5. **MCP server** — read-only freight tools, audit logging on every call. The Hermes seam.
6. **Simulator** — synthetic shipments with injected delays, congestion, rejections. The only honest way to test whether the loop learns rather than merely explains.

Steps 1–3 are useful with no agent involved at all. Steps 5–6 are what make an
agent safe to attach.

## 6. Not changing

`packages/db` core tables · `packages/events` envelope and existing 28 events ·
Temporal workflows · the 14 controllers · quote arithmetic in `quote-engine.ts`
(gaining an input, not new maths) · billing, customs, compliance, documents ·
the console.
