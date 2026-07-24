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

**AWS deployment infrastructure** (`infra/aws/`, this round):
- Full Terraform stack: VPC across 2 AZs with NAT, security groups scoped to
  least-privilege (only the ALB is internet-facing), RDS Postgres 16, S3 for
  documents, ECR repos, ECS Fargate cluster + services for api/worker/web
  behind an ALB with host-based routing and ACM TLS, and self-hosted
  single-task Fargate services for Redpanda/Temporal/Keycloak/yente (mirrors
  `docker-compose.yml`'s topology) plus a managed OpenSearch domain backing
  yente's sanctions index. IAM roles scoped per task (api gets S3 write,
  nothing else does). CloudWatch log group per service.
- GitHub Actions deploy workflow (`.github/workflows/deploy-aws.yml`,
  manual `workflow_dispatch` trigger): builds and pushes all three images to
  ECR tagged with the commit SHA, then `terraform apply`s that tag. OIDC
  federation to AWS — no long-lived access keys as GitHub secrets.
- Full runbook in `DEPLOY.md`, including the handful of genuine one-time
  manual steps (creating Temporal/Keycloak's logical databases on the shared
  RDS instance, Keycloak realm import, yente dataset load) — same
  "operator action, not code gap" honesty as the list below.
- **Not verified against a real AWS account**: `terraform fmt` is clean, but
  `init`/`validate`/`plan`/`apply` have not been run — this sandbox has no
  AWS credentials and its network policy blocks `registry.terraform.io`, so
  provider plugins can't even download here. Run `terraform plan` yourself
  and read it before `apply`. Documented explicitly at the top of
  `DEPLOY.md` rather than left implicit.

## Audit pass — corridor map + live re-verification

Stood the stack up again from scratch (Postgres 16, migrate, seed, API, web),
signed in, booked six shipments across three corridors, and drove the console
in a real browser rather than trusting the previous run's notes.

**Built this round**
- **Corridor map** (`components/ui/corridor-map.tsx`): geographic view of the
  book, on the dashboard ("Active corridors") and on Network Overview
  ("Corridor map"). Pure SVG — no mapping library, no tile server, no external
  request at render time, which keeps it inside the same CSP and offline
  posture as the rest of the console. Lanes are UN/LOCODE pairs weighted by
  volume; the viewport auto-fits the corridors present, so a Durban–Johannesburg
  book zooms into Southern Africa and a Shanghai lane pulls it back to the
  Indian Ocean. On the dashboard a lane turns red when any shipment on it has
  an open exception, which makes the map a triage surface rather than
  decoration. Port labels are placed greedily by volume and suppressed on
  collision, reappearing on hover.
- Supporting static data: `lib/world-land.ts` (Natural Earth 110m land
  outline, public domain, simplified and inlined — see the provenance note in
  the file) and `lib/locode.ts` (curated UN/LOCODE gazetteer, ~125 places on
  the corridors this platform actually serves). Codes outside the extract are
  reported as unmapped instead of guessed at.

**Bug found live and fixed**: quoting a lane with no rate card returned
`500 Internal server error` and logged a stack trace as an unhandled
exception. `NoRateError`/`NoMarginRuleError` are ordinary answers to an
ordinary request — a customer asking for a corridor we don't price — so
`QuotingService.issueQuote` now maps them to `422` carrying the lane in the
message. Bookings and customs already did this for their own domain errors;
quoting was the one path that didn't. Covered by
`apps/api/test/quoting-service.test.ts` and confirmed against the running API.

**Gaps this pass surfaced** (not fixed — each needs a product decision):
- `GET /shipments` caps at `limit(200)` with no pagination, no cursor and no
  total. Past 200 shipments an operator silently sees a truncated list, and
  anything derived from it — including the dashboard's corridor map — quietly
  under-reports. Fine for launch volumes; needs a cursor before it isn't.
- No frontend tests at all. Every test in the repo is API or package logic;
  the console is verified by eye and by typecheck only.
- CI runs no integration tests — there's no Postgres service in
  `.github/workflows/ci.yml`, so nothing exercises a real query, a real
  transaction, or the tenant isolation the whole security model rests on.
  The unit suite would pass with the database wired wrong.
- CI triggers on `push` to `main` and on pull requests only, so work on a
  feature branch runs no checks until a PR exists.

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
6. **Document storage**: now S3 (or any S3-compatible endpoint — AWS S3,
   Backblaze B2, Cloudflare R2, self-hosted MinIO), not local disk — config
   validation refuses to boot with `NODE_ENV=production` and
   `DOC_STORAGE_DRIVER=local`, precisely because local disk isn't shared
   across API replicas. Set `DOC_STORAGE_S3_BUCKET`; credentials come from
   the environment's default AWS credential chain (ECS task role in
   `infra/aws`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` elsewhere).
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
