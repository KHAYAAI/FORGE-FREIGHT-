# Keycloak realm — forge-freight

Turns four things that used to be "log into the admin console and click
through it" into one versioned file: `realm-export.json`. It is baked into
a custom Keycloak image (`Dockerfile`) and imported automatically on first
boot via `--import-realm` — a fresh deploy comes up with these already
configured, not waiting on a person to remember every setting.

`--import-realm` only *creates* a realm that doesn't exist yet. It never
overwrites one that's already there, so redeploying is safe even after an
admin has customized things by hand.

## What's actually configured

| Ask | Where in `realm-export.json` | What it does |
|---|---|---|
| **MFA** | `otpPolicy*` fields + `requiredActions[CONFIGURE_TOTP]` with `defaultAction: true` | Every new user is forced to set up TOTP on first login. Realm-wide by design — see below for scoping it down instead. |
| **Password policy** | `passwordPolicy` | 12 char minimum, upper+lower+digit+special, can't equal username/email, last 5 passwords not reusable, forced rotation every 90 days. |
| **Brute-force lockout** | `bruteForceProtected` + `failureFactor`/`waitIncrementSeconds`/etc. | 5 failed attempts locks the account out with escalating wait times, capped at 15 minutes, never permanent. |
| **SAML federation** | `identityProviders[customer-saml]` | A complete, working SAML 2.0 broker configuration — **disabled**, with placeholder SSO URL and signing certificate. Needs a real customer's IdP metadata before it does anything. See below. |

Also included, because RBAC and tenant isolation don't work without them:

- The three realm roles from `apps/api/src/modules/auth/roles.ts`
  (`admin`, `finance`, `ops`) — without these existing in the realm,
  `RolesGuard`'s `AUTH_ROLES=advisory` warning
  (`"the token carries no roles at all"`) is not a hypothetical, it's what
  every login produces.
- A `tenant` client scope with a protocol mapper that puts `tenant_id` on
  the token from a required user attribute — without this,
  `token-verifier.ts` refuses every token (`"Token is missing the
  'tenant_id' claim"`).
- Two clients: `forge-web` (public, PKCE, the console's login flow) and
  `forge-api` (bearer-only, exists so `AUTH_AUDIENCE=forge-api` becomes an
  option later — not required today, `apps/api/src/config.ts` treats
  `AUTH_AUDIENCE` as optional).

## What's still a real operator action

Nothing here fabricates a customer relationship. Before SAML federation
does anything:

1. Get the actual customer IdP's metadata — SSO URL, signing certificate,
   entity ID. This requires a conversation with their IT/identity team;
   there is no way to know this in advance.
2. In the Keycloak admin console (or by editing `realm-export.json` and
   re-importing into a *new* realm, since import won't overwrite), replace
   the three `REPLACE-ME-*` values in `identityProviders[0].config` and set
   `"enabled": true`.
3. Confirm the SAML assertion's attribute names against
   `identityProviderMappers` — `saml-tenant-id` assumes the IdP sends a
   `tenant_id` attribute; real IdPs vary, and this mapper's `attribute.name`
   needs to match whatever the customer's IdP actually sends.
4. Replace `REPLACE-WITH-YOUR-DOMAIN.example.com` in the client redirect
   URIs and the SAML entity ID once a real domain exists (`DEPLOY.md` sets
   this via `local.web_fqdn`/`local.auth_fqdn` in Terraform, but the realm
   export can't reach into Terraform locals, so this one substitution stays
   manual). A forgotten placeholder fails loudly with "invalid
   redirect_uri" — never silently insecure.

## Scoping MFA to specific roles instead of everyone

The realm-wide default is the simpler, safer choice for a small forwarder's
whole staff (see `roles.ts`'s own note on why the role model stays coarse
rather than a full permission matrix). To require it only for `admin`/
`finance` instead: remove `"defaultAction": true` from the `CONFIGURE_TOTP`
required action in `realm-export.json`, then assign it as a required action
on specific users or groups post-import (Admin Console → Users → Required
User Actions, or the equivalent Admin REST API call).

## One image, two run modes

`docker-compose.yml` runs this image with `start-dev --import-realm`
(Keycloak's bundled dev database, no external Postgres needed — matches
what was there before this change). `infra/aws/supporting.tf` runs the same
image with `start --import-realm` against the real Postgres instance. The
image itself stays database-agnostic — it only adds the realm file — so one
`Dockerfile` serves both without hardcoding a database vendor that would
make the local path require a Postgres connection it doesn't have.

## Rebuilding after an edit

```bash
docker build -t forge-keycloak infrastructure/keycloak
```

For AWS, this is the same "build once, push to ECR" pattern as api/worker/
web/freight-mcp — see `.github/workflows/deploy-aws.yml` and
`infra/aws/ecr.tf`.

## What "reviewed" means here

`realm-export.json` is written against Keycloak 26's documented
`RealmRepresentation` import schema and is valid JSON, but — consistent
with every other infrastructure claim in this repo — it has **not** been
verified by an actual `--import-realm` run against a live Keycloak in this
environment (no Docker daemon here; see `DEPLOY.md`'s standing disclaimer).
Run it locally with `docker compose up -d keycloak` and confirm the import
succeeds — check `docker compose logs keycloak` for import errors — before
trusting it in production.
