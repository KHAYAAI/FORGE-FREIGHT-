# FORGE Freight

Digital freight forwarding operating system for African trade corridors —
instant quotes, real container visibility, AI-prepared customs entries, and
trade finance built into the same ledger that runs your payments.

## Stack

Next.js + Tailwind (custom component kit) · NestJS modular monolith ·
PostgreSQL 16 + Drizzle · Temporal (shipment lifecycle) · Redpanda (event
bus) · Keycloak (multi-tenant auth) · yente/OpenSanctions (screening) ·
Anthropic Claude (document extraction). TypeScript end to end. All money in
integer cents. See `LAUNCH.md` for production readiness status.

## Getting started

```bash
pnpm install
docker compose up -d          # Postgres, Redpanda, Temporal, Keycloak, yente
pnpm db:migrate               # push schema
pnpm db:seed                  # SA launch lanes + demo tenant
pnpm --filter @forge-freight/api dev   # API on :3001
```

Copy `.env.example` to `.env` and adjust. In production the API verifies
Keycloak-issued JWTs (`AUTH_MODE=jwt`, tenant from the `tenant_id` claim);
for local development `AUTH_MODE=dev` trusts `x-dev-*` headers — the config
loader refuses to boot dev auth in production.

The web console (`pnpm --filter @forge-freight/web dev`, port 3000) has its
own dev-mode session: visit `/login` and paste the operator tenant id from
the seed output. It forwards `x-dev-*` headers to the API via a same-origin
proxy — swap `apps/web/src/lib/session.ts` for real Keycloak sessions in
production.

Try the quote → PDF → booking flow (ids come from the seed output):

```bash
# itemised quote in one call
curl -s localhost:3001/quotes -H 'content-type: application/json' \
  -H 'x-dev-tenant-id: <operator-tenant-id>' -d '{
  "customerId": "<customer-party-id>",
  "origin": "CNSHA", "destination": "ZADUR",
  "mode": "OCEAN", "containerType": "40HC",
  "quantity": 2, "incoterm": "FOB"
}'

# customer-facing PDF (sell side only)
curl -s -H 'x-dev-tenant-id: <tenant>' localhost:3001/quotes/<quote-id>/pdf -o quote.pdf

# convert to booking + shipment (FF-YYYY-NNNNN reference, containers, leg plan)
curl -s -X POST -H 'x-dev-tenant-id: <tenant>' -H 'content-type: application/json' \
  localhost:3001/quotes/<quote-id>/book -d '{"carrierBookingRef":"MAEU12345678"}'
```

Every write emits catalogue events into the transactional outbox; with
`KAFKA_BROKERS` set, the relay ships them to the `freight.events` Redpanda
topic (keyed by shipment for per-shipment ordering).

## Repo map

| Path | What |
| --- | --- |
| `packages/events` | Versioned canonical event catalogue — the spine of the system |
| `packages/db` | Drizzle schema, migrations, seed (projections + append-only `events`) |
| `packages/ontology-bridge` | Freight event → Revenue Ontology mapper (see `docs/ontology-bridge.md`) |
| `apps/api` | NestJS modular monolith — quoting, bookings, shipments, tracking ingest (DCSA/Traccar/EDIFACT), documents (Claude extraction), customs, compliance, billing + finance views |
| `apps/worker` | Temporal worker — shipment lifecycle workflow (time-based exception escalation) |
| `apps/web` | Operator console — quoting, shipments, ops kanban, customs, documents, invoices, finance views, parties, system monitor |
| `docs/architecture.md` | Architecture, non-negotiables, milestone plan |
| `LAUNCH.md` | Production readiness checklist — what's done, what's deferred, operator setup steps |

## Deploying

`docker-compose.prod.yml` overlays application containers (api, worker, web)
on the infra stack. Point a TLS-terminating proxy at api (3001) and web
(3000), configure the env in `.env` (see `.env.example` — production refuses
to boot without AUTH_ISSUER, KAFKA_BROKERS, TEMPORAL_ADDRESS, INGEST_API_KEY,
YENTE_URL), create the Keycloak realm with a `tenant_id` claim mapper, run
`pnpm db:migrate && pnpm db:seed`, and:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Development

```bash
pnpm build       # build all packages
pnpm test        # vitest across the workspace
pnpm typecheck
pnpm lint        # eslint across the workspace
```
