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
latest pass: **254 unit tests (144 API + 98 web + 12 packages) + 74 integration
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

## Role enforcement and the system-monitor gate (this round)

`AuthContext.roles` was parsed off the token from the first commit and then
never read by anything, so every authenticated user of a tenant could reprice a
lane, onboard a partner, or record a payment. Separately, the system monitor
showed two platform-wide figures to every caller: the outbox backlog counted
*every* tenant's unpublished events, and consumer offsets are a single global
table — so a partner agent could read how far behind the platform's projectors
were and infer the whole network's throughput from a screen meant to show its
own queue depth.

- **Three roles, deliberately few** (`apps/api/src/modules/auth/roles.ts`):
  `admin` changes what the business is (prices, margins, partners, and which
  customer tenant may see which party's cargo), `finance` moves money (issuing
  invoices, recording payments), `ops` moves freight. `admin` is accepted
  everywhere without being listed — an administrator who cannot record a
  payment on a Friday afternoon borrows a finance login, and then the audit
  trail is a lie.
- **Reads are not role-gated.** A forwarder is a small team; hiding the
  shipment list from a colleague protects nobody and gets worked around with a
  shared login, which is worse than the thing it was guarding.
- **`AUTH_ROLES=advisory`** logs what would have been refused instead of
  refusing it. Enforcing by default is right, but an upgrade into a realm with
  no role mapper would otherwise lose every write at once — this lets a
  deployment see exactly which calls would fail before committing.
- **System monitor**: refuses customer tenants outright, scopes the outbox
  backlog to the caller's own tenant, and returns platform infrastructure
  health and consumer watermarks to the operator only. Non-operators get an
  empty consumers list rather than our projector names reported "healthy" on no
  data — that would be telling a partner about our internals and telling them
  something untrue at the same time.

**Bug found by running it, not by testing it**: the guard 500'd on every
request because `Reflector` was injected implicitly. `tsx`'s esbuild transform
drops `emitDecoratorMetadata`, so a constructor parameter without an explicit
`@Inject()` resolves to `undefined` at runtime rather than failing at boot —
the same class of failure this repo hit once before across seven
controllers. A hand-constructed unit test cannot see it, which is why the live
call mattered.

**Verified live**: an `ops` user is refused a rate card (403 naming the role it
needs and the roles it has) and refused a payment; a `finance` user gets
through to a genuine 404; an `admin` writes the card; reads stay open to `ops`;
and the monitor returns `infra` + 4 consumers + a tenant-scoped backlog of 24
to the operator, against `null` + 0 consumers + 6 to a partner agent.

## Consignment capture — what is actually in the box (this round)

The platform could price a lane but not describe the freight on it. A quote
knew the corridor, the container type and a count; it did not know what the
goods were, what they were packed in, what they weighed, where they were
collected, or how urgently they had to move. Every one of those changes the
price or the paperwork, so the platform was pricing on assumptions.

**Domain** — `consignments` + `cargo_items`, created with the quote and carried
to the shipment **by reference rather than copied**, so the cargo a customer was
quoted for and the cargo that sails are provably the same rows. Weights are
integer grams and volumes integer cubic centimetres, for the same reason money
is integer cents.

- **Type of package** — pallet, carton, crate, drum, bag, bale, roll, IBC,
  bulk, loose. A terminal handles and a customs officer inspects against these
  words, and "40 pallets" and "40 loose pieces" are different prices.
- **Description**, per line and for the consignment as it will read on the B/L.
- **Pick-up point** — LOCODE, address, site contact and a collection window,
  held **separately from the port of exit**. Conflating them sends a truck to
  the wrong address.
- **Weight and dimensions** — and the asymmetry the industry actually uses,
  stated in the code rather than left to be inferred: a packing list reads
  "10 CTNS, 40 × 60 × 40 cm, 250 KGS", so **dimensions are per piece and weight
  is the line total**. Reading either the other way is a ten-fold error.
- **Port of exit** and port of entry, normalised on the way in — a lane filed
  as `zadur` would silently match no rate at all.
- **Urgency** — economy, standard, express, critical.
- **Type of cargo** — general, hazardous, reefer, perishable, oversized,
  valuable, live animals.

**These are not form fields; they are inputs to arithmetic:**

1. **Chargeable weight** (`packing.ts`). Freight is sold on the greater of what
   the goods weigh and what their space is deemed to weigh — IATA's 6000 cm³/kg
   for air, the freight tonne for ocean LCL. A pallet of pillows and a pallet of
   steel take the same slot, and a quote priced on gross weight loses money on
   every low-density shipment. In the live run below, 2,640 kg of cartons
   billed as **21,120 kg**.
2. **Handling uplift** by cargo type, carried as its own `HND` line rather than
   folded into the freight rate — a customer asking why dangerous goods cost
   more deserves a line that says so, and an operator renegotiating a carrier
   rate needs the base untouched.
3. **Service level as a filter, not just a fee.** `EXPRESS` caps transit at 21
   days and `CRITICAL` at 10; a lane that cannot meet it raises
   `NoServiceLevelError`, deliberately distinct from `NoRateError` — "we don't
   serve that corridor" and "we serve it in 34 days and you asked for 10" are
   different conversations, and answering the second with the first loses the
   sale for the wrong reason. A carrier with no stated transit is *not* dropped:
   unknown is unknown, not slow.
4. **Compliance refused at the cheapest moment.** Hazardous cargo without a
   complete UN number, IMO class and packing group cannot be quoted, let alone
   booked — an incomplete declaration is the most common reason a container is
   turned away at a terminal gate. Reefer without a temperature range is refused
   the same way. Both are caught at quote time rather than at the port.

**Console** — the quote screen gained a *Cargo details* panel that measures the
packing list as it is typed (`POST /consignments/measure`, saving nothing) and
shows the chargeable weight moving in real time, with a sentence explaining
which basis won and why. Cargo type switches reveal the declaration or the
temperature block inline, and requirements render live as `Required` or `Note`.
Everything is entered in kilograms and centimetres and converted at the edge.
The consignment then appears on the operator's shipment screen and, in the
customer's own words, in the shipper portal — it is their declaration coming
back to them, so nothing is withheld there except the forwarder's carrier and
terminal obligations.

**Bug found by clicking through it**: "View shipment →" after booking went to
`/shipments/undefined`. The API answers with `shipmentId`; the form read `id`.
Pre-existing, and invisible to every test because no test clicked the link.

**Verified live**: measured a real packing list (220 cartons, 2,640 kg, 21.12 m³
→ 21,120 kg chargeable), quoted against it, watched a hazardous declaration
block and then clear, confirmed `EXPRESS` refused on a 28-day sailing with the
fastest available transit named in the message, booked it, and found the cargo
on the shipment screen. 18 new integration tests and 20 new unit tests over the
arithmetic itself.

## The standardised freight-forwarder invoice, and the audit over it (this round)

The platform could bill a shipment. It could not produce a document another
company would want to send under its own name, and it had no answer to the
question a forwarder's customer actually asks: *what am I paying you for, and is
this number right?*

An invoice was a total, a due date and a currency. Charges were a code, a
description and two amounts. That is a ledger entry, not a billing document —
and it is nowhere near enough for a platform other companies bill from.

### What a forwarder invoice actually is

A consolidated **multi-party** billing document. The forwarder pays the carrier,
the origin agent, the terminal, the customs broker and the authority, then bills
the customer for the lot. Some lines pass through at cost, some carry a margin,
some are the forwarder's own service with no third-party cost behind them — and
nothing on a conventional invoice tells them apart.

Two documents get confused with it constantly, and the confusion is expensive:
a **commercial invoice** states the value of the *goods* and is what customs
assesses duty on; a **bill of lading** is the contract of carriage and, when
negotiable, a document of title. A forwarder invoice used as either one is a
customs valuation problem rather than a billing one. Every document this
platform issues now says so on its face.

### The taxonomy (`charge-codes.ts`)

29 canonical codes across 11 categories — origin, main carriage, fuel and
currency surcharges, destination and port, customs, duties and taxes,
documentation, demurrage and detention, insurance, platform fees, other — each
carrying the basis it is billed on, whether it is taxable, and **how often it is
wrong**. `BAF`, `THC` and `DOC` are marked HIGH, because those three receive the
least scrutiny from accounts payable and leave the most discretion to whoever
raised the line.

Vendor dialects collapse onto it before anything is compared: `OHC`, `OTHC`,
`Origin Handling`, `ORIG.HANDLING CHG` are one code with four spellings, and
until they are one code you cannot compare two vendors or match a line to a
contract. Each tenant can add its own aliases, which beat the built-in list.
Nothing is ever dropped — an unrecognised code lands in `MSC` **visibly**, and
the audit says the line is unauditable rather than passing it.

Every automatically-accrued charge now carries the taxonomy too. Left on the
column defaults, a lifecycle-accrued line would claim to be an uncategorised
charge the forwarder originated with no cost behind it — which is precisely the
shape the audit is built to pass.

### Per-line provenance

`PASS_THROUGH` / `MARKED_UP` / `FORWARDER_ORIGINATED`, on every line, with the
subtotal split three ways on the document. No forwarder invoice in the wild
carries this field. It makes margin explicable instead of something a customer
guesses at, and it tells the audit which lines can be matched against a vendor
invoice at all — a pass-through line with a margin on it is refused at the API,
not discovered later.

### The document (`invoice-document.ts`, pure)

Issuer block with registration, VAT number and **SARS customs client number**;
bill-to block; the shipment with its bill of lading, carrier booking and
container numbers; the cargo summary; charges grouped in the order the trade
reads them with per-section subtotals; per-line VAT (duty and import VAT stay
outside its scope, because charging output tax on a recovered statutory amount
overstates the invoice and the issuer's own VAT return together); bank details;
payment terms; and the notice distinguishing it from a commercial invoice and a
bill of lading.

**Multi-company from the ground up.** `tenant_billing_profiles` gives every
company its own legal identity, registrations, bank account, footer, VAT rate,
default terms and **its own gapless numbering series** — a column incremented
with `update ... returning` inside the issuing transaction, not a shared
sequence, because several jurisdictions require an issuer's numbering to be
sequential and gapless and a shared sequence hands company B the numbers company
A did not use. Issuer and bill-to are **snapshotted onto the invoice**: a
company that changes its bank account tomorrow must not change what today's
invoice says.

### The four-way match (`invoice-audit.ts`, pure)

Most AP teams run a two-way match — invoice against quote total — which catches
nothing, because the discrepancies live inside lines that were never quoted.
Every line is now checked against four sources:

1. **The contract** — the accepted quote's own lines, not the rate card. The
   quote is what this customer was sold, at the margin that applied on the day,
   and it is the document they would produce in a dispute.
2. **Vendor cost or a published benchmark** — the recorded buy, or a fuel index.
3. **The shipment's own facts** — container count, document count, weights.
4. **The service event record** — did the thing being billed for happen.

Sixteen rules, among them: contract rate variance; margin on a pass-through
disbursement (critical); VAT charged on an amount outside its scope; a
per-container charge billed once on a two-container booking; a documentation fee
billed per container instead of per bill of lading; a delivery charge on a
container that never left the terminal; demurrage days recomputed from free time
and the gate clock; demurrage and detention counting the same days; duplicate
lines; and totals that do not equal the lines under them.

**`matchDepth` is reported on every audit.** "No exceptions found" against one
source is a different claim from the same words against four, and conflating
them is how an audit becomes theatre. The console renders the missing sources as
prominently as the findings.

Findings persist as `invoice_exceptions`, upserted on re-run so opening the
screen twice does not double the list, and **a human's decision survives the
next run** — accepting or querying a finding is not reset by a re-audit.
Querying a line marks the charge, and the document holds that amount back from
the balance while still showing it: netting it off would quietly reissue the
invoice.

A **dispute packet** generates from the open findings as plain text ready to
paste into an email, with the days remaining in the window on its face. Disputes
are worth nothing after the window closes, and month-end is after the window
closes.

### Compliance and the external systems, stated honestly

Half the value chain is somebody else's system, and several of those cannot be
switched on with a URL. `GET /integrations` and **Compliance → External
Systems** now enumerate all eleven, each with what it does, what it degrades to,
the config keys it needs (names only — never values), and the **accreditation**
a person has to go and get. Six need one.

- **SARS Customs EDI** (`SARS_EDI_URL` + client number + client certificate).
  Requires the company to be registered with a customs client number and to hold
  an EDI user profile SARS issues on application — a paper process measured in
  weeks. Unconfigured, declarations are still **built, validated and stored
  complete**; they stop at `QUEUED` with the reason on them and export for
  manual capture. Submissions are idempotent, and a network failure leaves the
  filing queued rather than rejected, because the declaration may or may not
  have been lodged and a duplicate customs entry has to be unwound by hand.
- **SARS eFiling** (`SARS_EFILING_URL`) for VAT201 and deferment statements.
- **Fuel index** (`FUEL_INDEX_URL`) — Platts, Argus or IATA, all licensed.
  Unset, the audit raises `FUEL_BENCHMARK_UNAVAILABLE` and states the total left
  unchecked. It does **not** invent a benchmark: fuel is the highest-error
  category on the document, and a fabricated figure produces confident findings
  that collapse the moment a vendor asks where the number came from.
- **Terminal gate events** (`TERMINAL_EVENTS_URL`) — Navis N4 or carrier
  equipment history. Unset, demurrage is reported unverifiable rather than
  passed. The platform's own event log is preferred where carrier tracking has
  already delivered the milestones.

All four follow the pattern already established by `YENTE_URL` and
`NOVU_API_KEY`: config-gated, log-and-degrade, never a hard dependency of the
domain logic. Written up in `docs/INTEGRATIONS.md`.

### Console

- **Invoice document** at `/invoices/:id` — the full document, with the audit
  beneath it on the same page. Separating "the invoice" from "is the invoice
  right" is exactly what produces a process where the first is sent and the
  second happens after the dispute window shuts.
- **Billing settings** — the company's identity, bank details, numbering and
  terms, with what is still missing reported both here and on the invoice
  itself. Saved in pieces, because onboarding a forwarder takes days and a form
  that refuses a partial save is a form people fill with placeholder text.
- **Invoice exceptions** — the portfolio view, grouped by rule and ordered by
  money. A R40 terminal-handling overcharge on one container is beneath anyone's
  review threshold; the same R40 on every container through one port for a year
  is the largest single recoverable number a forwarder has, and it is invisible
  from invoice-level review.
- **External systems** — integration status and the SARS filing queue.

### Found by running it, not by testing it

The quote engine emits `THC-D`, `TOLL` and `PLATFORM_FEE`; the taxonomy had none
of them and every one fell through to `MSC`. It surfaced on the first live
invoice, not in any unit test, because the tests used the codes the taxonomy
already knew. Added as aliases, plus a proper `TOL` code for road tolls.

Two nullable-column unique indexes would have been silent no-ops: `NULL` never
equals `NULL` in Postgres, so a three-column unique index over a nullable
`charge_id` would have let every audit re-run insert another copy of exactly the
findings that matter most — the invoice-level ones. Split into two partial
indexes.

### Verified live

Quoted a real consignment, booked it, added seven charge lines across seven
categories, issued `FF-2026-000001` under the seeded company's own numbering,
read the document (VAT correct per line, duty zero-rated, subtotal split
30,290 / 0 / 3,650 across the three provenances), ran the audit against all four
sources, and got eight findings — including the documentation fee billed per
container rather than per bill of lading, and the two lines nobody could check
because the fuel index and the terminal feed are not configured, each naming the
variable that would enable it. Generated the dispute packet. Lodged a SARS
filing with the channel unconfigured and watched it queue with the reason
attached rather than fail.

Full gate green: lint, typecheck, build, **317 unit tests + 93 integration
tests** — 203 in the API, 102 in the console, 12 across the packages. 59 of the
unit tests and 19 of the integration tests are new this round.

## Must do before going live (operator action, not code)

These aren't code gaps — they're steps whoever deploys this has to take
themselves, because they depend on real infrastructure this repo can't
provision on its own:

1. **Keycloak realm**: create the `forge-freight` realm, a `tenant_id`
   claim mapper on the **access** token (the console and the API both read the
   tenant from there — an ID-token-only mapper leaves the console signed in
   but unable to name a tenant, and it says so on the login page rather than
   failing silently). Create two clients:
   - `forge-console` for the web app — standard flow on, PKCE (S256)
     required, redirect URI `https://<console-host>/api/auth/callback`, and
     post-logout redirect `https://<console-host>/login`. Public or
     confidential both work; set `AUTH_CLIENT_SECRET` only for the latter.
   - one client per partner/machine integration that calls the API directly.

   Map the realm roles `admin`, `finance` and `ops` onto the access token as
   well — the API refuses writes without them. Set `AUTH_ROLES=advisory` first
   if you want to see what would be refused before enforcing it.

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
9. **Each company's billing profile**: before a tenant issues its first
   invoice, fill in **Finance → Billing Settings** — legal name, company
   registration, VAT number, SARS customs client number, registered address,
   bank account and numbering prefix. The platform will invoice without them
   and says on the document exactly what is missing, but an invoice with no
   bank account on it is one the customer cannot pay. Nothing here is shared
   between companies.
10. **SARS accreditation** (only if you want filings lodged electronically):
   the operating company must be registered with SARS as an importer, exporter
   or clearing agent with a customs client number, then apply for an EDI user
   profile and be issued a client certificate for the gateway. That is a paper
   process measured in weeks, and no code path shortens it. Until then
   declarations are built, validated and stored complete, and stop at `QUEUED`
   for manual capture — which is a working state, not a broken one. See
   `docs/INTEGRATIONS.md`.
11. **Invoice audit references**, if you want the four-way match running at
   full depth: `FUEL_INDEX_URL` needs a Platts/Argus/IATA data licence, and
   `TERMINAL_EVENTS_URL` needs a per-terminal or per-carrier data agreement.
   Without them the audit still runs against the contract and the shipment
   data, and reports on each affected invoice which checks it could not
   perform — it never passes a line it could not validate.
12. **Optional integrations, if you want them live at launch**: `AISSTREAM_API_KEY`
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
