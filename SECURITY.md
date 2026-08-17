# Security

What FORGE Freight actually does today, in code and in the Terraform that
deploys it — not a checklist of aspirations. Where a control lives outside
this repository (Keycloak realm settings, mostly) that's stated explicitly,
because "we use an OIDC provider" and "MFA is enforced" are different claims
and this document does not conflate them.

## Identity and access

**SSO is already the architecture, not a gap.** `apps/api` never authenticates
a human directly — every user-facing request carries a Keycloak-issued JWT,
verified against Keycloak's own JWKS (issuer + audience checked, `jose`
library, `apps/api/src/modules/auth/token-verifier.ts`). Keycloak is a
standards-based identity broker: it federates to an enterprise IdP (Okta,
Azure AD/Entra, Google Workspace, any SAML 2.0 or OIDC provider) as a realm
configuration, not an application code change. Standing up federation to a
customer's IdP is an operator task in the Keycloak admin console — see
[Operator-configured controls](#operator-configured-controls-not-in-this-repo)
below for what that actually requires.

- **RBAC, enforced by default.** Three roles (`admin`, `finance`, `ops`) —
  see `apps/api/src/modules/auth/roles.ts`. `AUTH_ROLES` defaults to
  `enforce`; a token missing a required realm role gets a 403, not a log
  line. `advisory` mode exists as an explicit, visible escape hatch for a
  realm mid-migration — it warns loudly on every boot and every would-be
  refusal, and production config validation (`apps/api/src/config.ts`)
  still requires `AUTH_MODE=jwt` and a real `AUTH_ISSUER`.
- **Tenant isolation is tested, not just asserted.** The CI `integration`
  job (`.github/workflows/ci.yml`) runs against a real Postgres specifically
  to exercise the tenant predicate as SQL — a unit suite that mocks the
  query builder would keep passing with the tenant filter deleted; this job
  would not.
- **Machine callers get scoped, purpose-built credentials, never a shared
  admin key.** Tracking webhooks (`/ingest/*`) and Kestra's scheduled sweeps
  (`/scheduled/*`) present a timing-safe-compared API key
  (`node:crypto timingSafeEqual` — no early-exit string comparison anywhere
  a secret is checked). freight-mcp, the read-only agent surface, presents a
  *separate* key bound to exactly one tenant server-side
  (`x-agent-tenant-id`, never caller-supplied) and is granted `roles: ["ops"]`
  only — never `admin` or `finance`. Each of these is opt-in: an unset key
  means the path never activates, not that it fails open.
- **The browser never talks to the API.** `apps/web` is a same-origin BFF —
  the Keycloak session lives in an **encrypted** (JWE, A256GCM, not merely
  signed) `httpOnly`, `sameSite=lax`, `secure`-in-production cookie
  (`apps/web/src/lib/session.ts`), and a server-side proxy route forwards a
  Bearer token to the API. No CORS configuration is needed for the console
  itself, and the API's CORS policy carries no `credentials: true` — it
  never sets or reads a cookie for auth, so there is no cookie-based
  cross-origin attack surface to have.

## Audit trail

Every domain state change is an event with a mandatory `actor` field —
`{ kind: USER | SYSTEM | ADAPTER | WORKFLOW, id, tenantId }`
(`packages/events/src/envelope.ts`). This is not a bolted-on audit log
table that can drift from what actually happened: it's the event store
itself, the same one every read model is a projection of. "Who changed this
rate card, and when" is a query against the system of record, not a
best-effort side log that might be missing an entry.

## Network and transport

- TLS 1.2+ only at the ALB (`ELBSecurityPolicy-TLS13-1-2-2021-06`), HTTP→HTTPS
  redirect once a domain is configured (`infra/aws/alb.tf`).
- **AWS WAFv2** in front of the ALB (`infra/aws/waf.tf`): AWS's managed rule
  groups for common exploits, known bad inputs, and SQL injection, plus the
  Amazon IP reputation list and an edge-level per-IP rate limit — all ahead
  of and independent from the application's own `ThrottlerModule`, so a
  flood is dropped before it costs an ECS task any CPU.
- Security-group topology is default-deny and layered: only the ALB is
  internet-reachable; `ecs_services` (api/worker/web) accepts only from the
  ALB; `supporting` (Redpanda/Temporal/Keycloak/yente/Kestra/n8n/freight-mcp)
  accepts only from `ecs_services`; RDS/OpenSearch/EFS accept only from
  `supporting` (`infra/aws/security.tf`).
- RDS is `publicly_accessible = false` — explicit, not relying on the
  provider default — and lives in private subnets only.
- helmet on the API (CSP intentionally off — this is a JSON API with no HTML
  to inject into; a browser-facing CSP is `apps/web`'s job). `apps/web` sets
  its own header set including HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, and a locked-down `Permissions-Policy`
  (`apps/web/next.config.ts`).
- Rate limiting is real, not aspirational: `@nestjs/throttler` globally
  (100 req/min/IP) with tighter per-route limits on quoting and party
  screening — the two cheapest-to-abuse, most expensive-to-serve endpoints.

## Data protection

- RDS, S3 (documents bucket), and EFS (Kestra/n8n/Redpanda local state) are
  all encrypted at rest; EFS mounts additionally encrypt in transit. The S3
  documents bucket blocks all public access and versions every object.
- All credentials — DB, the shared ingest/agent API keys, Kestra/n8n admin
  passwords, n8n's encryption key — live in AWS Secrets Manager, generated
  by Terraform (`random_password`), never a manually-rotated blank literal
  or a value copy-pasted between consoles (`infra/aws/rds.tf`,
  `infra/aws/orchestration.tf`).
- File uploads are capped at 32 MB (`apps/api/src/modules/documents/documents.controller.ts`)
  and every external input is validated by a zod schema at the boundary —
  see `apps/api/src/modules/ingest/rfq.dto.ts` for a representative example.
- Containers run as non-root (`USER node` in every Dockerfile that has an
  equivalent user available).

## Supply chain

Dependency vulnerabilities are found and fixed on a schedule, not
discovered when someone asks:

- **`.github/dependabot.yml`** — weekly updates across npm (grouped
  patch/minor into one PR), GitHub Actions, Terraform, and every Dockerfile
  in the workspace.
- **`.github/workflows/codeql.yml`** — CodeQL SAST on every push to `main`,
  every PR, and weekly on a schedule (so a newly-published query can flag
  unchanged code).
- **CI audit gate** (`.github/workflows/ci.yml`) — `pnpm audit
  --audit-level=critical` fails the build; `--audit-level=high` runs
  informationally so findings stay visible without stalling every PR on a
  transitive dev-tooling advisory with no fix yet.

**This session's remediation, for the record:** an audit at the start of
this hardening pass found 39 known vulnerabilities in the dependency tree
(1 low, 18 moderate, 19 high, 1 critical), including two that were reachable
in production, not just build tooling — `drizzle-orm` (SQL injection via
improperly escaped identifiers, fixed in 0.45.2) and the `multer` version
bundled internally by `@nestjs/platform-express` (three DoS advisories,
pinned to a patched version via a `pnpm.overrides` entry in the root
`package.json` since Nest's own dependency, not our direct one, was the
vulnerable copy). `next` was one patch release behind a fix for two SSRF
advisories and a Server Actions DoS. After bumping `drizzle-orm`,
`drizzle-kit`, `next`, `vitest` (2.1→3.2, the line that fixes a critical
arbitrary-file-execution advisory in its UI server), and overriding `sharp`,
`nanoid`, `postcss`, `fast-uri`, and `brace-expansion` to their patched
versions: **10 findings remain (1 low, 8 moderate, 1 high), 0 critical**,
full lint/typecheck/test/build verified green against every change. The one
remaining high finding is a Windows-only `vite` dev-server file-access
bypass reachable only through `vite --serve`, which nothing in this stack
runs — `vite` here is purely `vitest`'s internal test-runner dependency,
never a network-facing process, on Linux CI and Linux containers only.
Left unforced because overriding it risks breaking `vitest`'s internal
`vite-node` wiring for a bug this deployment cannot be reached by.

## Identity provider controls

Keycloak realm settings, not application code — but as of this pass they're
no longer manual clicking either. `infrastructure/keycloak/realm-export.json`
is baked into a custom Keycloak image
(`infrastructure/keycloak/Dockerfile`) and imported automatically via
`--import-realm` on first boot, in both `docker-compose.yml` (local) and
`infra/aws/supporting.tf` (AWS) — see
`infrastructure/keycloak/README.md` for the full detail.

| Control | Where | Status |
|---|---|---|
| SSO / OIDC | Keycloak, federated to any IdP | **Live** — this is the architecture, not a setting to turn on |
| RBAC realm roles + `tenant_id` claim mapper | `realm-export.json` `roles` / `clientScopes` | **Live** — imported automatically; without this, `AUTH_ROLES=advisory`'s "token carries no roles at all" warning is what every login would actually produce |
| MFA / TOTP | `realm-export.json` `requiredActions[CONFIGURE_TOTP]` | **Live** — required for every new user on first login, realm-wide by default; scoping it to specific roles instead is documented in the Keycloak README |
| Password policy (length, complexity, history, rotation) | `realm-export.json` `passwordPolicy` | **Live** — 12 char minimum, mixed case + digit + special, no username/email reuse, 5-password history, 90-day rotation |
| Brute-force / account lockout | `realm-export.json` `bruteForceProtected` + thresholds | **Live** — 5 failures locks the account out with escalating wait, capped at 15 minutes, never permanent |
| SAML federation to a specific customer IdP | `realm-export.json` `identityProviders[customer-saml]` | **Templated, disabled** — a complete, working SAML broker config with placeholder SSO URL/certificate; enabling it for a real customer requires their actual IdP metadata, which cannot be known in advance (see the Keycloak README's step-by-step) |
| Access/refresh token lifetimes | `realm-export.json` `accessTokenLifespan` etc. | **Live** — 5-minute access token, 30-minute idle session, 10-hour max session |
| Client redirect URIs for the real production domain | `realm-export.json` `clients[forge-web].redirectUris` | **Placeholder** — the realm export can't reach into Terraform's `local.web_fqdn`; replace `REPLACE-WITH-YOUR-DOMAIN.example.com` once a real domain exists |

The `--import-realm` mechanism only creates a realm that doesn't already
exist — a redeploy never clobbers whatever an admin has since changed by
hand in the Keycloak console. And as with everything else in this document:
`realm-export.json` is written against Keycloak 26's documented import
schema and is valid JSON, but has not been verified by an actual import
against a live Keycloak in this environment — no Docker daemon here. Run
`docker compose up -d keycloak` locally and confirm the import succeeds
before trusting it in production.

## Reporting a vulnerability

Open a private security advisory on this repository, or contact the
maintainer directly. Please do not open a public issue for a suspected
vulnerability.

## What "reviewed" means here

Consistent with `DEPLOY.md`'s own disclaimer: the WAF, security-group, and
RDS changes in this document are Terraform that has been written and
reviewed but not `terraform apply`'d against a real AWS account from this
environment — no AWS credentials and no `terraform` binary here. The
application-level controls (auth guards, rate limiting, CORS, dependency
versions) are all covered by the test suite that runs in CI and were
verified green in this session. Treat the infrastructure claims as
reviewed, the application claims as tested, and run `terraform plan`
yourself before trusting either in production.
