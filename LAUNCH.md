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

**Gaps this pass surfaced — all four since closed:**

1. **`GET /shipments` truncated silently at 200.** Now keyset-paginated on
   `(created_at, id)` with an opaque cursor, and the response carries the
   filtered `total`, so a short page is visibly a page. Offset pagination was
   rejected deliberately: shipments are created while an operator pages, and
   offsets skip or repeat rows underneath them. A cursor is a position, not a
   capability — every query still re-filters by tenant, so a forged or borrowed
   cursor can move the window but never widen it, which the integration suite
   asserts directly. The console shows "Showing 50 of 1,204" with First/Next
   controls; a new index on `(tenant_id, created_at, id)` backs the scan.
2. **Nothing derived from that list may summarise a page.** The dashboard's
   corridor map now reads `GET /ops/corridors`, a database-side aggregate over
   the whole book with open-exception counts per lane, rather than counting the
   rows that happened to be on screen.
3. **No frontend tests.** `apps/web` now runs vitest + Testing Library (jsdom):
   27 tests over the corridor map's geometry, auto-zoom, label collision,
   tone-by-exception and hover readout; the LOCODE gazetteer (including a
   coordinate sanity check that catches a transposed lat/lon); and the money
   and date formatters. Deliberately no `@vitejs/plugin-react` — its Fast
   Refresh wiring is dev-server machinery tests don't need.
4. **CI had no Postgres and no integration tests.** `.github/workflows/ci.yml`
   gained an `integration` job with a `postgres:16-alpine` service running
   `pnpm test:integration`: 16 tests covering tenant isolation across list,
   timeline, exceptions and corridors; keyset paging over 25 shipments with
   deliberately colliding timestamps (walks every page and asserts no gaps or
   repeats); and event-store transaction semantics plus the partial unique
   index that makes redelivered carrier messages idempotent. Verified
   non-vacuous by mutation: deleting the tenant predicate from the shipments
   query fails three of them.
5. **CI ignored feature branches.** Now triggers on every `push`, not just
   `main` and open pull requests.

Unit and integration suites are split by config (`vitest.config.ts` vs
`vitest.integration.config.ts`), so `pnpm test` still runs with no services
started and `pnpm test:integration` needs `DATABASE_URL`. Totals as of the
latest pass: **216 unit tests (106 API + 98 web + 12 packages) + 56 integration
tests**, lint/typecheck/build clean.

## Console authentication (this round)

The audit's blocker: the API refuses to boot without `AUTH_MODE=jwt` in
production, but the console only knew how to send `x-dev-*` headers, so every
page would have 401'd against a production API. There was no OIDC flow, no
token storage, no refresh. The console is now a real OIDC client.

- **Authorization code + PKCE** against Keycloak, written directly against the
  OIDC endpoints (`lib/oidc.ts`) rather than pulling in an auth framework —
  the console needs exactly three operations, and the token shape is already
  what the API's verifier expects. PKCE is used even for confidential clients.
- **Encrypted session cookie** (`lib/session.ts`): JWE, A256GCM, keyed off
  `SESSION_SECRET`. Signed-only would leave a working bearer token legible to
  anything that can read the cookie. The cookie also records which mode minted
  it, so a dev-mode cookie stops authenticating the moment a deployment
  switches to OIDC, and sealing fails loudly rather than emitting a cookie
  over the browser's 4 KB limit that would be silently dropped.
- **Refresh in middleware**, not at the point of use: Server Components cannot
  set cookies, so a refresh discovered mid-render would have nowhere to
  persist. Middleware refreshes ~60s ahead of expiry, writes the new cookie,
  and rewrites the *request* cookie so the render below sees the fresh token
  in the same pass.
- **Dev mode kept**, and hardened: `POST /api/session` now 404s under OIDC, so
  a production deployment can't be talked into minting a credential-free
  session, and `AUTH_MODE=dev` throws outright when `NODE_ENV=production`.
- Sign-out goes through Keycloak's end-session endpoint rather than only
  dropping the local cookie.

**Pre-existing bug found while testing this**: `apps/web/middleware.ts` had
never executed. With a `src/` directory present, Next.js looks for middleware
at `src/middleware.ts`, so the file at the app root was silently unregistered
— the only thing keeping unauthenticated requests out was the belt-and-braces
`redirect("/login")` in the app layout. Moved to `apps/web/src/middleware.ts`;
the redirect now carries `?next=`, which is how the dead code was spotted.

**Verified end to end** against a stub OIDC provider that enforces PKCE:
sign-in redirects with an S256 challenge, the callback exchanges the code and
seals a session whose tenant comes from the access token's claim, the proxy
sends `Authorization: Bearer` (confirmed by the dev-mode API rejecting it with
401 — proof the `x-dev-*` headers are gone), the token refreshes ahead of
expiry without refreshing needlessly while fresh, and logout redirects to the
provider's end-session endpoint. Dev mode re-verified unchanged afterwards.
40 unit tests cover mode resolution, PKCE (including the RFC 7636 vector),
discovery fallback, claim extraction, open-redirect rejection, cookie
encryption, mode confusion, and the refresh window.

## Customer portal (this round)

The audit's second-largest gap: a freight forwarder's customers had nowhere to
look. Every screen in the console assumed an operator, so "where is my cargo?"
was answered by phoning the forwarder. The platform now has a shipper-facing
product.

**The scoping problem, and why it gets its own controller.** A customer's cargo
does not belong to the customer's tenant — it belongs to the *forwarder's*
tenant, because the forwarder booked it. So the portal cannot use the
`tenantId = caller` predicate every other query in the system uses; it is the
one deliberate cross-tenant read on the platform. Rather than branch inside the
operator endpoints — which is exactly how a tenant-isolation bug gets written —
the portal is its own controller (`modules/portal/`) with its own scoping rule
in one file (`portal.scope.ts`):

- `parties.customer_tenant_id` links a forwarder's party record to a CUSTOMER
  tenant. The link is created deliberately by the forwarder via
  `POST /parties/:id/customer-tenant`, which 422s if the target tenant isn't of
  type `CUSTOMER`. No link, no visibility — the default is invisible.
- Every portal query resolves that link to a set of party ids and filters
  `bookings.customer_id` by it. A customer tenant with no links sees an empty
  list, never an error that would confirm anything exists.
- `GET /portal/shipments/:id` returns `null` rather than 403 for someone
  else's shipment, so probing cannot distinguish "not yours" from "doesn't
  exist".
- The timeline drops `charge.*` and `quote.issued`. A customer sees movement;
  the forwarder's cost build-up and margin are its own business.

Read-only by design. A customer can watch, not act: booking, documents and
customs stay with the forwarder who carries the liability for them.

**Screens**: `/track` (their shipments, keyset-paginated, with the corridor map
scoped to their own lanes), `/track/[id]` (a milestone timeline worded for a
shipper — "Container loaded on the vessel", not `container.loaded`; anything
not in the wording map is dropped rather than shown raw), and `/track/invoices`.

**Route access is now enforced, not just hidden.** The sidebar already filtered
by tenant type, but typing `/finance` into the address bar as a customer still
rendered the operator screen — a page of error states dressed up as a screen
they were entitled to. `lib/tenant-routes.ts` is now the authority the nav
merely reflects, and the middleware redirects a tenant that asks for the other
side's product. The session cookie carries the tenant *type*, resolved from the
API at sign-in rather than read from a token claim: the IdP owns the tenant id,
but what kind of tenant it is belongs to this platform's records — otherwise an
IdP admin could promote a customer to an operator by editing a claim. A test
asserts the nav and the route table cannot drift apart.

**Bug found while testing this**: a non-uuid tenant identifier — a malformed
`x-dev-tenant-id`, or a `tenant_id` claim someone set to a slug — flowed
straight into the query layer, where Postgres raised a cast error and the
request became a `500`. A bad credential now fails at the guard as `401`
(`isTenantId` in `auth.types.ts`), on both the dev and the JWT paths.

**Verified live**, not just by tests: linked a real party to a CUSTOMER tenant
on the running stack and confirmed the shipper sees its 126 shipments and no
one else's; an unlinked CUSTOMER tenant sees empty lists everywhere; an
operator gets 403 on `/portal/*`; a customer gets redirected off all eleven
operator routes and an operator off the portal; and the portal timeline
withholds a `charge.accrued` event that is present in the database. Integration
suite: **26 tests** (10 new for the portal), proven non-vacuous by mutation —
deleting the portal's scope predicate fails three of them, and flattening
`mayVisit` to `return true` fails two frontend tests.

## Rate cards and margin rules (this round)

Pricing a new lane used to mean an operator writing `INSERT`s against
`rate_cards` by hand: `RatesService` was read-only and seed-populated. That
made onboarding a corridor an engineering task rather than a commercial one,
and left partner agents — who are supposed to run their own book on these
rails — unable to price anything at all. Both are now a screen.

- **`/rates` API**: full CRUD for rate cards (with surcharges written in the
  same transaction — a card carrying half its costs is worse than no card) and
  for margin rules. Open to `OPERATOR` and `PARTNER_AGENT`, each scoped to its
  own tenant; a customer tenant is refused outright. Another tenant's card
  answers **404, not 403** — a rival probing for a competitor's card ids should
  learn nothing from the status code.
- **Input is normalised, not just validated**: a lane filed as `zadur` would be
  invisible to every quote for `ZADUR` and read as a missing rate rather than a
  typo, so LOCODEs and currency codes are upper-cased on the way in. Percentage
  surcharges are capped at 10000 basis points, because that column holds cents
  for every other basis and a 15% BAF typed as `150000` would bill 1,500% of
  freight.
- **Surcharges are replaced as a set**, not patched row by row. A tariff
  arrives as a sheet; "these are the costs now" is the only statement that
  cannot leave a withdrawn BAF behind.
- **Deleting the last catch-all margin rule is refused** — it would leave every
  lane unquotable, and discovering that from a customer-facing 422 is a worse
  way to learn it.
- **`/rates` screen**: rate cards with expiry/not-yet-live badges and an
  inline surcharge editor, margin rules ordered most-specific-first (the order
  the quote engine resolves them in, so the table reads as "this is the rule
  that will apply"), and banners when there is no catch-all rule or when two
  rules cover the same scope.

**Two bugs found while building this, both pre-existing:**

1. **Every validation error on the entire API was a `500`.** A
   `@Catch(ZodError)` filter was registered *before* the catch-all on the
   assumption that listing it first gave it priority — but Nest evaluates
   global filters in reverse registration order, so the catch-all swallowed
   every one. `POST /parties {}` answered "Internal server error" rather than
   naming the missing field. Folded the Zod case into the single global filter
   so there is no ordering left to get wrong; `apps/api/test/exception-filter.test.ts`
   now asserts on the status a bad body produces, which is what nothing did
   before.
2. **Equally specific margin rules resolved nondeterministically.**
   `resolveMarginRule` kept the first rule of the highest score, and the rules
   were fetched with no `ORDER BY` — so with two catch-alls the same quote
   could be priced at 15% or 18% on two runs with nothing changed. Ties now
   break by recency (newest wins, which is what an operator means when they add
   a rule on top of an old one), the fetch is ordered, and the screen warns
   when two rules overlap.

**Verified live**: created a lane through the API and again through the
browser form, edited its buy price, replaced its surcharge set, and then
quoted it — the quote came back priced off the edited buy with the new
surcharges and without the withdrawn one, through the untouched quoting
engine. 16 new integration tests, mutation-proven: dropping the `tenantId`
predicate from the card and rule write paths fails two of them.

## Payment reconciliation (this round)

Payments existed only as events. `recordPayment` compared a single payment
against the whole invoice total and set the status from that, and there was no
`payments` table at all — so two half payments left an invoice `PART_PAID`
forever, and a redelivered bank webhook credited the customer twice with no
constraint anywhere to stop it. Separately, `OVERDUE` was in the enum and the
console already rendered it — a red badge, its own filter, an overdue count on
the invoices screen — but nothing ever set it, so the count was permanently
zero. That is worse than absent: the screen asserted nothing was late.

- **`payments` table**, unique on `(invoice_id, payment_ref)`. The reference is
  the bank's, and banks redeliver, so the write does nothing on conflict and
  the response says `duplicate: true` — no second credit, and no second
  `payment.received` event reaching the ledger sink and the customer's
  notifications as though money had arrived twice. The constraint is per
  invoice rather than per tenant on purpose: one transfer allocated across
  several invoices is legitimate, and a tenant-wide constraint would reject the
  second allocation as a duplicate.
- **Settlement is decided by the running total**, and the response carries
  `paidCents` / `outstandingCents` / `overpaidCents`. An overpayment is money
  to refund, not revenue, so it is reported rather than absorbed.
- **A part payment does not cure lateness**: paying a token amount on an
  overdue invoice keeps it `OVERDUE`. Otherwise it would drop off the overdue
  list until the sweep put it back, and the screen would give two different
  answers for the same invoice within the hour.
- **`OverdueSweepService`** moves unsettled invoices past their due date to
  `OVERDUE` — hourly, plus once at boot so a restart after downtime catches up
  immediately.
- **Console**: the invoices table gained Paid and Outstanding columns and a
  per-invoice payment history; the payment form defaults to the outstanding
  balance rather than the full total (on a part-paid invoice the total is the
  one number that is certainly wrong) and now **requires** a reference. It used
  to invent one from the clock when left blank, which meant every retry looked
  like new money — the idempotency key was being generated by the thing it was
  meant to protect against. A new "Owed" tile totals actual money outstanding
  by currency, which is the question a finance lead asks; a count of unpaid
  invoices is not.

**Also fixed**: `money()` delegated to `toLocaleString("en-ZA")`, whose
separators depend on the runtime's ICU build — so the invoices screen rendered
its server-side total as `ZAR 8 700,00` and the table rows beside it as
`ZAR 4,500.00`, and anything rendered both ways was a hydration mismatch. It
formats by hand now and the tests pin the exact output.

**Verified live**: issued a real invoice from a shipment's charges, paid half,
replayed the identical reference (no-op, `duplicate: true`, running total
unchanged, still two events for three requests), paid the rest (settled),
backdated three invoices and watched the boot sweep flip exactly the two that
were late, then recorded a part payment through the browser form and saw the
row, the outstanding balance and the "Owed" tile all move together. 14
integration tests, mutation-proven twice: restoring the per-payment status
comparison fails the accumulation test, and removing the conflict target fails
both redelivery tests.

## Must do before going live (operator action, not code)

These aren't code gaps — they're steps whoever deploys this has to take
themselves, because they depend on real infrastructure this repo can't
provision on its own:

1. **Keycloak realm**: create the `forge-freight` realm and a `tenant_id`
   claim mapper on the **access** token (the console and the API both read the
   tenant from there — an ID-token-only mapper leaves the console signed in
   but unable to name a tenant, and it says so on the login page rather than
   failing silently). Create two clients:
   - `forge-console` for the web app — standard flow on, PKCE (S256)
     required, redirect URI `https://<console-host>/api/auth/callback`, and
     post-logout redirect `https://<console-host>/login`. Public or
     confidential both work; set `AUTH_CLIENT_SECRET` only for the latter.
   - one client per partner/machine integration that calls the API directly.

   Then set `AUTH_MODE`, `AUTH_ISSUER`, `AUTH_CLIENT_ID` and a 32+ character
   `SESSION_SECRET` (`openssl rand -base64 48`) on the web service. Behind a
   load balancer, also set `AUTH_PUBLIC_ORIGIN`/`AUTH_REDIRECT_URI` so the
   redirect URI the console sends matches what Keycloak has registered.
   `AUTH_MODE=dev` is refused in production by both services.
2. **Customer tenants**: the portal shows a shipper nothing until someone
   links it. For each customer you want to give access to, create a tenant of
   type `CUSTOMER`, give its users a `tenant_id` claim pointing at it, and
   `POST /parties/:id/customer-tenant` for each party record that customer
   books under. Unlinked is the safe default — a new CUSTOMER tenant sees an
   empty portal, not someone else's freight.
3. **TLS**: put a reverse proxy (Caddy/Traefik) in front of `api:3001` and
   `web:3000`. Neither container terminates TLS itself.
4. **Secrets**: `INGEST_API_KEY`, `ANTHROPIC_API_KEY`, Postgres credentials,
   and the Keycloak client secret must come from a real secrets manager in
   production, not the `.env` file used for local dev.
5. **Backups**: schedule `scripts/backup-db.sh` via cron (or your
   orchestrator's equivalent) against the production `DATABASE_URL`, and
   confirm the restore path (`gunzip -c ... | psql`) at least once before
   relying on it.
6. **yente index**: the sanctions screening index (`docker-compose.yml`'s
   `index`/`yente` services) needs a populated OpenSanctions dataset, not
   just the empty Elasticsearch container the dev compose file spins up.
   Follow yente's own data-loading docs.
7. **Document storage**: now S3 (or any S3-compatible endpoint — AWS S3,
   Backblaze B2, Cloudflare R2, self-hosted MinIO), not local disk — config
   validation refuses to boot with `NODE_ENV=production` and
   `DOC_STORAGE_DRIVER=local`, precisely because local disk isn't shared
   across API replicas. Set `DOC_STORAGE_S3_BUCKET`; credentials come from
   the environment's default AWS credential chain (ECS task role in
   `infra/aws`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` elsewhere).
8. **DNS + CORS**: set `CORS_ORIGINS` and `PORTAL_ORIGIN` to the real
   production domain before cutover — they default to `localhost`.
9. **Optional integrations, if you want them live at launch**: `AISSTREAM_API_KEY`
   (aisstream.io account) for live vessel positions, `NOVU_API_KEY` +
   a workflow named to match `NOVU_WORKFLOW_ID` configured in the Novu
   dashboard with the WhatsApp/SMS/email channels you actually want, and
   `TARIFF_CSV_PATH` pointing at the real SARS Schedule 1 if you have a
   licensed data feed for it. All three are genuinely optional — the
   platform is fully functional and degrades gracefully without any of
   them, exactly like `YENTE_URL`/`ANTHROPIC_API_KEY` already do.

## Deliberately deferred (not launch blockers)

Called out explicitly so nobody mistakes "not built yet" for "forgotten":

- ~~**Rate cards for partner tenants**~~ — closed. `/rates` gives both
  operators and partner agents full CRUD over their own rate cards and margin
  rules, so onboarding a lane no longer means an operator writing SQL.
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
