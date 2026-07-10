# Launch readiness

Status as of this checklist's last update. Re-run the verification commands
before every release — this file records what was true when written, not a
live dashboard.

## Done

**Product surface**
- Quoting, booking, shipment lifecycle, tracking ingest (DCSA/Traccar/EDIFACT),
  document extraction + review, customs entry + duty/VAT, compliance
  screening, billing + invoicing, finance views — all wired end to end and
  verified live against a real Postgres + API + web stack.
- Operator console covers every module: dashboard, quotes, shipments, ops
  kanban, customs workspace, document review queue, invoices, finance views,
  parties, and a system monitor (event throughput, consumer lag, exception
  backlog, infra health).

**Platform hardening**
- Config validation fails fast on missing production env vars
  (`AUTH_ISSUER`, `KAFKA_BROKERS`, `TEMPORAL_ADDRESS`, `INGEST_API_KEY`,
  `YENTE_URL`) — the process refuses to boot misconfigured.
- Multi-tenancy enforced at the query level; auth fails closed (dev-mode
  header auth is refused in production by the config loader).
- Rate limiting (`@nestjs/throttler`): global default 100 req/min/IP, tighter
  limits on cost-bearing endpoints (quoting, party screening, ingest
  webhooks); health checks exempted so orchestrators can poll freely.
- Security headers: `helmet` on the API, equivalent headers
  (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`) on the Next.js app; `robots: noindex` + `robots.txt`
  since this is an authenticated operator tool, not a public site.
- Global exception filter: unhandled errors are logged server-side in full
  and never leak internals in the HTTP response.
- `trust proxy` set in production so per-IP rate limiting and audit logs are
  accurate behind a reverse proxy.
- Session cookie is `httpOnly` + `secure` in production; all client-side API
  calls go through a same-origin proxy (`/api/proxy`) so the session never
  touches the browser's JS runtime and no CORS config is needed for it.
- `.dockerignore` added — builds no longer ship `node_modules`/`.git` into
  the build context.
- ESLint (flat config, TypeScript + React Hooks rules) actually runs now —
  previously `pnpm lint` silently no-op'd because no config existed anywhere
  in the repo.
- CI gate: lint → typecheck → build → test, in that order, so a broken build
  never reaches the test stage silently.
- DB backup script (`scripts/backup-db.sh`) — gzip dump + 14-day retention,
  cron-ready.
- Web app: error boundary, 404 page, route-level loading skeleton, favicon.

**Product surface, round two** (M10 + the three integrations previously
listed as deferred — now built, not stubbed):
- **M10 Partner console**: `tenants.platform_fee_bps` (basis points),
  operator-only `TenantsController` (`/tenants/partners` list/create,
  `PATCH .../fee-rate`, `/tenants/me`), `BillingAccrual` charges a `FEE`-kind
  line automatically on `vessel.departed` for any `PARTNER_AGENT` tenant with
  a rate set, `GET /billing/platform-fees` for a partner to see what it owes.
  Web: `/partners` (operator admin — create partners, edit fee rates inline)
  and `/platform-fees` (partner-facing), both gated by tenant type in the
  nav, not just by the API's own 403.
- **AIS vessel tracking**: new `vessel.position_reported` catalogue event,
  `AisAdapter` (learns the MMSI→IMO mapping from `ShipStaticData` messages,
  since AIS position reports are MMSI-keyed and `legs.vessel_imo` is
  IMO-keyed — a real protocol detail, not a shortcut), `AisListenerService`
  maintaining a `wss://stream.aisstream.io` subscription and refreshing the
  tracked-vessel set from active ocean legs every `AIS_VESSEL_REFRESH_MS`.
  Disabled (logged, not failed) without `AISSTREAM_API_KEY` — same posture
  as every other optional integration here.
- **Novu milestone notifications**: `NotificationsService` posts to Novu's
  `/v1/events/trigger` REST endpoint directly (not the SDK — fewer moving
  parts, the endpoint's contract has outlived several SDK majors) on
  `vessel.departed`, `vessel.arrived`, `entry.released`, `pod.confirmed`.
  Which channel actually fires (WhatsApp/SMS/email) is the Novu workflow's
  own configuration, not this codebase's. Disabled without `NOVU_API_KEY`.
- **Tariff book**: grown from 15 to ~90 headings across the chapters that
  actually move on these corridors (electronics, textiles/apparel, footwear,
  vehicles/parts, machinery, foodstuffs, furniture, base metals), plus a CSV
  loader (`TARIFF_CSV_PATH`) so the real gazetted schedule can override the
  built-in extract line-by-line without a code change. Still not a verbatim
  copy of SARS Schedule 1 — see the provenance note in
  `apps/api/src/modules/customs/tariff-data.ts` before relying on it for a
  real entry.

**Verified live**: stood up Postgres + the API + the web app locally, logged
in via the dev session, exercised every route against real seeded data,
confirmed a genuine pre-existing bug — `tsx`'s esbuild transform drops
`emitDecoratorMetadata`, silently breaking NestJS DI for any constructor
parameter without an explicit `@Inject()` — and fixed it across every
affected controller/service (documents, billing, customs, compliance,
bookings, quoting, ingest). For M10 specifically: created a partner tenant
as operator, confirmed a non-operator tenant gets a 403 trying to do the
same, booked a shipment under the partner, fired a DCSA departure webhook,
and watched the correct platform fee (5% of $7,700.00 freight = $385.00)
accrue automatically and show up on both `/billing/platform-fees` and the
`/platform-fees` screen. 77/77 tests pass, both typechecks clean, `pnpm
lint` clean, production build succeeds.

## Must do before going live (operator action, not code)

These aren't code gaps — they're steps whoever deploys this has to take
themselves, because they depend on real infrastructure this repo can't
provision on its own:

1. **Keycloak realm**: create the `forge-freight` realm, a `tenant_id` claim
   mapper, and OIDC clients for the web app and any partner integrations.
   `AUTH_MODE=dev` must never run in production — the config loader already
   refuses this, but confirm `AUTH_ISSUER`/`AUTH_JWKS_URL` point at the real
   realm before cutover.
2. **TLS**: put a reverse proxy (Caddy/Traefik) in front of `api:3001` and
   `web:3000`. Neither container terminates TLS itself.
3. **Secrets**: `INGEST_API_KEY`, `ANTHROPIC_API_KEY`, Postgres credentials,
   and the Keycloak client secret must come from a real secrets manager in
   production, not the `.env` file used for local dev.
4. **Backups**: schedule `scripts/backup-db.sh` via cron (or your
   orchestrator's equivalent) against the production `DATABASE_URL`, and
   confirm the restore path (`gunzip -c ... | psql`) at least once before
   relying on it.
5. **yente index**: the sanctions screening index (`docker-compose.yml`'s
   `index`/`yente` services) needs a populated OpenSanctions dataset, not
   just the empty Elasticsearch container the dev compose file spins up.
   Follow yente's own data-loading docs.
6. **Document storage**: `DOC_STORAGE_DIR` is local disk today, backed by a
   named Docker volume in `docker-compose.prod.yml`. Fine for a single-host
   launch; migrate to S3-compatible storage before running multiple API
   replicas (local disk isn't shared across containers).
7. **DNS + CORS**: set `CORS_ORIGINS` and `PORTAL_ORIGIN` to the real
   production domain before cutover — they default to `localhost`.
8. **Optional integrations, if you want them live at launch**: `AISSTREAM_API_KEY`
   (aisstream.io account) for live vessel positions, `NOVU_API_KEY` +
   a workflow named to match `NOVU_WORKFLOW_ID` configured in the Novu
   dashboard with the WhatsApp/SMS/email channels you actually want, and
   `TARIFF_CSV_PATH` pointing at the real SARS Schedule 1 if you have a
   licensed data feed for it. All three are genuinely optional — the
   platform is fully functional and degrades gracefully without any of
   them, exactly like `YENTE_URL`/`ANTHROPIC_API_KEY` already do.

## Deliberately deferred (not launch blockers)

Called out explicitly so nobody mistakes "not built yet" for "forgotten":

- **Rate cards for partner tenants**: `BillingAccrual` will charge a
  partner's platform fee correctly once it books freight, but partners
  currently can't self-serve their own rate cards — there's still no write
  endpoint for `rate_cards` (`RatesService` is read-only, seed-populated).
  Onboarding a partner today means an operator inserting rate cards
  directly, same as it's always been for the operator tenant itself.
- **SARS tariff book is a reference extract, not the gazette**: ~90 headings
  covering the common corridor commodities, not the full Schedule 1 with
  every subheading, specific/formula duty, anti-dumping margin, or
  AfCFTA/SACU preferential rate. `TARIFF_CSV_PATH` exists precisely so the
  real schedule can be loaded without a code change — see
  `tariff-data.ts` for the full provenance note.
- **AIS listener has no automated test of the live WebSocket connection**:
  the parsing logic (`AisAdapter`) is unit-tested; the connection/reconnect
  logic (`AisListenerService`) is verified by code review and a clean boot
  with the feature disabled, not by an actual `aisstream.io` session — that
  requires a real API key and open egress this environment doesn't have.
  Confirm connectivity against a real key before relying on it in production.
- **Structured/shipped logging** (e.g., JSON logs to a log aggregator): the
  API logs to stdout via NestJS's default logger. Fine for a single-host
  launch with `docker logs`; wire a real sink before scaling to multiple
  hosts.
- **Error tracking** (Sentry or equivalent): the global exception filter
  logs everything server-side, but there's no external alerting on
  unhandled errors yet — someone has to be tailing logs.

## Verification commands

Run these before every deploy:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

All four must be clean. CI (`.github/workflows/ci.yml`) runs them in this
order on every push and PR.
