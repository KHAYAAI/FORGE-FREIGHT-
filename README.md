# FORGE Freight

Digital freight forwarding operating system for African trade corridors —
instant quotes, real container visibility, AI-prepared customs entries, and
trade finance built into the same ledger that runs your payments.

## Stack

Next.js + shadcn/ui · NestJS modular monolith · PostgreSQL 16 + Drizzle ·
Temporal (shipment lifecycle) · Redpanda (event bus) · Keycloak
(multi-tenant auth) · Novu (notifications) · yente/OpenSanctions
(screening). TypeScript end to end. All money in integer cents.

## Getting started

```bash
pnpm install
docker compose up -d          # Postgres, Redpanda, Temporal, Keycloak, yente
pnpm db:migrate               # push schema
pnpm db:seed                  # SA launch lanes + demo tenant
pnpm --filter @forge-freight/api dev   # API on :3001
```

Try a quote (ids come from the seed output):

```bash
curl -s localhost:3001/quotes -H 'content-type: application/json' -d '{
  "tenantId": "<operator-tenant-id>",
  "customerId": "<customer-party-id>",
  "origin": "CNSHA", "destination": "ZADUR",
  "mode": "OCEAN", "containerType": "40HC",
  "quantity": 2, "incoterm": "FOB"
}'
```

## Repo map

| Path | What |
| --- | --- |
| `packages/events` | Versioned canonical event catalogue — the spine of the system |
| `packages/db` | Drizzle schema, migrations, seed (projections + append-only `events`) |
| `packages/ontology-bridge` | Freight event → Revenue Ontology mapper (see `docs/ontology-bridge.md`) |
| `apps/api` | NestJS modular monolith (rates, quoting; more modules per build order) |
| `docs/architecture.md` | Architecture, non-negotiables, milestone plan |

## Development

```bash
pnpm build       # build all packages
pnpm test        # vitest across the workspace
pnpm typecheck
```
