# Deploying FORGE Freight to AWS

This is the runbook for standing up the platform on AWS with the Terraform in
`infra/aws/`. It assumes an AWS account, an IAM principal with permission to
create the resources below, and (optionally) a Route53 hosted zone for a real
domain.

**Honesty check on this document:** the Terraform in `infra/aws/` has been
written and formatted (`terraform fmt` is clean), but `terraform init` /
`validate` / `plan` / `apply` have **not** been run against a real AWS
account from this environment — the sandbox this was built in has no AWS
credentials and its network policy blocks `registry.terraform.io`, so
provider plugins can't even be downloaded here. Treat this as reviewed,
not verified. Run `terraform plan` yourself before `apply` and read it.

## What gets created

| Component | How |
|---|---|
| VPC, public/private subnets across 2 AZs, NAT | `networking.tf` |
| Security groups (ALB, ECS services, supporting services, RDS, OpenSearch, EFS) | `security.tf` |
| RDS Postgres 16 (single instance, multiple logical DBs) | `rds.tf` |
| S3 bucket for documents (versioned, encrypted, private) | `s3.tf` |
| ECR repos for api/worker/web | `ecr.tf` |
| ECS Fargate cluster, services, task defs for api/worker/web | `ecs.tf` |
| ALB with host-based routing (api./app./auth.) + ACM cert | `alb.tf`, `dns.tf` |
| Redpanda, Temporal, Keycloak, yente, OpenSearch — self-hosted on Fargate | `supporting.tf` |
| IAM roles (ECS execution, api task, generic task) | `iam.tf` |
| CloudWatch log groups per service | `observability.tf` |

Redpanda/Temporal/Keycloak/yente run as **single-task ECS services**, not
managed AWS equivalents (MSK, Temporal Cloud, Cognito). This mirrors
`docker-compose.yml`'s topology exactly and keeps the first deploy simple —
it is not highly available. Treat it as the on-ramp, not the end state; the
scale-up path (MSK, Temporal Cloud, RDS Multi-AZ per service) is a Terraform
change, not a rearchitecture, because application code only ever talks to
config-driven hostnames.

## Prerequisites

1. **AWS credentials** with sufficient IAM permissions (VPC, RDS, ECS, ECR,
   S3, IAM, Secrets Manager, CloudWatch, Route53, ACM, OpenSearch, EFS,
   Service Discovery). Easiest path for a first deploy: an IAM user with
   `AdministratorAccess`, tightened later.
2. **Terraform 1.9+** and the **AWS CLI** installed locally.
3. (Optional but recommended) A **Route53 public hosted zone** for your
   domain. Without one, set `domain_name = ""` in `terraform.tfvars` and the
   stack still deploys — reachable over plain HTTP via the ALB's own DNS
   name, with no TLS and no host-based routing to `api.`/`auth.` (see
   `alb.tf` — without a domain, port 80 forwards directly to `web`).
4. **A Terraform state backend.** `versions.tf` ships without one configured
   (every account's bucket/table names differ). Create an S3 bucket +
   DynamoDB lock table by hand, uncomment the `backend "s3"` block in
   `versions.tf`, fill in your bucket/table names, then
   `terraform init -migrate-state`. Skipping this means state lives on
   whatever machine ran `apply` — fine for a personal sandbox, not for a
   team.

## First deploy

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: domain_name, db_instance_class, desired_counts, secrets

terraform init
terraform plan   # read it — this is the point of Terraform
terraform apply
```

This provisions everything **except application images** — `ecs.tf`
references `${ecr_repo_url}:${var.image_tag}` (default `latest`), and the
ECR repos are empty on a first apply. Build and push once by hand before the
ECS services can start healthy:

```bash
aws ecr get-login-password --region af-south-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.af-south-1.amazonaws.com

docker build -f apps/api/Dockerfile -t <account-id>.dkr.ecr.af-south-1.amazonaws.com/forge-freight-production/api:latest .
docker push <account-id>.dkr.ecr.af-south-1.amazonaws.com/forge-freight-production/api:latest
# repeat for worker, web
```

Then force a fresh deployment so the services pick up the images:

```bash
aws ecs update-service --cluster forge-freight-production --service forge-freight-production-api --force-new-deployment
aws ecs update-service --cluster forge-freight-production --service forge-freight-production-worker --force-new-deployment
aws ecs update-service --cluster forge-freight-production --service forge-freight-production-web --force-new-deployment
```

## Manual one-time steps Terraform can't do for you

These are genuine operator actions, not gaps in the code — the same
distinction `LAUNCH.md` draws for the non-AWS deployment path.

1. **Create the `temporal` and `keycloak` logical databases** on the RDS
   instance. Terraform provisions one RDS instance with `db_name` for the
   application; Temporal and Keycloak each need their own database on the
   same instance, and creating a database requires a live connection
   Terraform doesn't have in this setup (no bastion/CI runner inside the VPC
   wired up here). From a host that can reach RDS (a bastion, an ECS Exec
   session into any running task, or a temporary security-group opening):
   ```sql
   CREATE DATABASE temporal;
   CREATE DATABASE temporal_visibility;
   CREATE DATABASE keycloak;
   ```
   Get the admin password with:
   ```bash
   aws secretsmanager get-secret-value --secret-id forge-freight-production/database --query SecretString --output text | jq -r .password
   ```
2. **Keycloak realm import.** The `keycloak` container starts with an empty
   realm. Log into `https://auth.<domain>` with the bootstrap admin
   (`admin` / the same Secrets Manager password reused for convenience — see
   `supporting.tf`; rotate this immediately after first login), then create
   the `forge-freight` realm, clients, and roles. If you have an existing
   realm export from another environment, import it here instead of
   clicking through by hand.
3. **yente's sanctions dataset.** The OpenSearch domain starts empty — yente
   needs its OpenSanctions dataset indexed before screening returns anything
   meaningful. Trigger yente's own index-build process per its docs; this is
   a data load, not infrastructure.
4. **TLS validation.** If `domain_name` is set, `dns.tf` creates the ACM
   certificate and its DNS validation records automatically (assuming the
   hosted zone is in the same AWS account) — `apply` will hang at the
   `aws_acm_certificate_validation` resource until DNS propagates, typically
   a few minutes.
5. **Secrets you must supply**, not generate: `anthropic_api_key`,
   `aisstream_api_key`, `novu_api_key` in `terraform.tfvars` (all optional —
   each feature degrades gracefully when unset, per `.env.example`), and
   `INGEST_API_KEY` — currently left blank in `ecs.tf`'s environment block on
   purpose (a machine-to-machine webhook key shouldn't live in Terraform
   state as plaintext). Set it via `aws ecs update-service` with a
   `--task-definition` override referencing a Secrets Manager ARN, or extend
   `rds.tf`'s secret pattern with a dedicated `aws_secretsmanager_secret` for
   it — either way, treat plaintext task-definition env vars as fine for
   non-secret config and Secrets Manager as required for anything that acts
   as a credential.

## CI/CD

`.github/workflows/deploy-aws.yml` is a manually-triggered
(`workflow_dispatch`) pipeline: build and push all three images to ECR
tagged with the commit SHA, then `terraform apply` with that tag as
`image_tag`. It authenticates via OIDC federation (`aws-actions/configure-aws-credentials`
with `role-to-assume`) — no long-lived AWS access keys stored as GitHub
secrets. To use it:

1. Create an IAM role trusting GitHub's OIDC provider
   (`token.actions.githubusercontent.com`), scoped to this repo, with
   permission to push to ECR and run `terraform apply`.
2. Set `AWS_DEPLOY_ROLE_ARN` as a repository secret.
3. Trigger the workflow from the Actions tab, or wire
   `on: push: branches: [main]` back in once you trust it enough for
   merge-to-deploy.

## Rollback

ECS keeps the previous task definition revision. Fastest rollback:

```bash
aws ecs update-service --cluster forge-freight-production \
  --service forge-freight-production-api \
  --task-definition forge-freight-production-api:<previous-revision>
```

For a full environment rollback, re-run `terraform apply -var image_tag=<previous-sha>`.

## Cost shape (rough, af-south-1, launch-sized defaults)

Single NAT gateway, `db.t4g.medium` single-AZ, 2 api tasks, 1 worker, 2 web,
one task each for Redpanda/Temporal/Keycloak/yente, `t3.medium.search`
OpenSearch — expect low-to-mid hundreds of USD/month before data transfer
and storage growth. Multi-AZ RDS and per-AZ NAT gateways roughly double the
networking/database line items; flip `db_multi_az` and `single_nat_gateway`
in `terraform.tfvars` when you're ready to pay for that resilience.
