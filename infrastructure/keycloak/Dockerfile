FROM quay.io/keycloak/keycloak:26.0

# Bake the realm in so a fresh deploy never boots into an empty auth system
# waiting on manual clicking — see realm-export.json and this directory's
# README for exactly what's configured (MFA, password policy, brute-force
# lockout, the forge-web/forge-api clients, a disabled SAML template) and
# what still needs a real customer's IdP metadata before it's usable.
# --import-realm (passed in infra/aws/supporting.tf and docker-compose.yml)
# only creates the realm if it doesn't already exist, so re-deploys never
# clobber whatever an admin has since changed by hand.
#
# Deliberately no `kc build` step here: that would hard-select a database
# vendor at image-build time, which is right for the Postgres-backed AWS
# deployment but would break this same image locally, where docker-compose
# runs Keycloak in `start-dev` mode against its bundled dev database with no
# KC_DB_* wired up. One image, two run modes — see docker-compose.yml
# (start-dev) vs infra/aws/supporting.tf (start, against real Postgres).
