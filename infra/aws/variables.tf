variable "aws_region" {
  description = "AWS region. af-south-1 (Cape Town) is closest to the African trade corridors this platform serves; switch if your primary corridor points elsewhere."
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Deployment environment name, used in resource naming/tags."
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Short project slug used as a prefix for resource names."
  type        = string
  default     = "forge-freight"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets across. 2 is the minimum for an ALB and RDS Multi-AZ."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "Use one NAT gateway for all private subnets instead of one per AZ. Cheaper, less resilient to AZ failure — fine for initial launch, revisit before heavy production load."
  type        = bool
  default     = true
}

# --- Database -----------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.medium is a reasonable launch size; scale up as shipment volume grows."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "db_multi_az" {
  description = "Enable RDS Multi-AZ failover. Recommended once this is carrying real customer freight data."
  type        = bool
  default     = false
}

variable "db_name" {
  type    = string
  default = "forge_freight"
}

variable "db_username" {
  type    = string
  default = "forge_admin"
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

# --- Container images -----------------------------------------------------

variable "image_tag" {
  description = "Image tag deployed for the api/worker/web ECR repos. The GitHub Actions deploy workflow overrides this per-deploy with the commit SHA."
  type        = string
  default     = "latest"
}

variable "api_task_cpu" {
  type    = number
  default = 512
}

variable "api_task_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "worker_task_cpu" {
  type    = number
  default = 256
}

variable "worker_task_memory" {
  type    = number
  default = 512
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "web_task_cpu" {
  type    = number
  default = 256
}

variable "web_task_memory" {
  type    = number
  default = 512
}

variable "web_desired_count" {
  type    = number
  default = 2
}

# --- Supporting services (self-hosted on Fargate) --------------------------
#
# Redpanda, Temporal, and Keycloak run as single-task ECS services rather
# than managed AWS equivalents (MSK, Temporal Cloud, Cognito) — this keeps
# the stack close to docker-compose.yml for dev/prod parity and avoids
# vendor lock-in on day one. Each is a legitimate scaling ceiling to
# revisit once volume justifies the managed alternative; noted in DEPLOY.md.

variable "redpanda_task_cpu" {
  type    = number
  default = 512
}

variable "redpanda_task_memory" {
  type    = number
  default = 1024
}

variable "temporal_task_cpu" {
  type    = number
  default = 512
}

variable "temporal_task_memory" {
  type    = number
  default = 1024
}

variable "keycloak_task_cpu" {
  type    = number
  default = 512
}

variable "keycloak_task_memory" {
  type    = number
  default = 1024
}

variable "yente_task_cpu" {
  type    = number
  default = 512
}

variable "yente_task_memory" {
  type    = number
  default = 2048
}

variable "opensearch_instance_type" {
  description = "Instance type for the OpenSearch domain backing yente sanctions search."
  type        = string
  default     = "t3.medium.search"
}

variable "opensearch_volume_size_gb" {
  type    = number
  default = 30
}

# --- Kestra, n8n, freight-mcp (this session's automation/integration/agent
# layer) — same self-hosted-on-Fargate tradeoff as the block above, and the
# same scale path: managed alternatives exist for Kestra/n8n if volume ever
# justifies leaving this topology.

variable "kestra_task_cpu" {
  type    = number
  default = 512
}

variable "kestra_task_memory" {
  type    = number
  default = 1024
}

variable "n8n_task_cpu" {
  type    = number
  default = 512
}

variable "n8n_task_memory" {
  type    = number
  default = 1024
}

variable "freight_mcp_task_cpu" {
  type    = number
  default = 256
}

variable "freight_mcp_task_memory" {
  type    = number
  default = 512
}

variable "freight_mcp_desired_count" {
  description = "0 disables freight-mcp entirely — nothing else depends on it. Set to 1 once you have an agent host that will actually call it."
  type        = number
  default     = 0
}

variable "freight_tenant_id" {
  description = "The single tenant n8n and freight-mcp serve — both are one-instance-per-tenant by design (see infrastructure/n8n/README.md and services/freight-mcp/README.md). Required for either to start; leave empty to disable both (n8n still deploys but its workflow will refuse to quote, freight-mcp refuses to boot)."
  type        = string
  default     = ""
}

variable "kestra_admin_user" {
  type    = string
  default = "admin@forgefreight.local"
}

variable "n8n_admin_user" {
  type    = string
  default = "admin@forgefreight.local"
}

variable "waf_rate_limit_per_5min" {
  description = "WAFv2 rate-based rule: requests from one IP in a rolling 5-minute window before it's blocked at the edge. Well above legitimate traffic from a single office/NAT gateway, well below what a flood needs to hurt api's own ThrottlerModule limits (100 req/min/IP) upstream."
  type        = number
  default     = 3000
}

# --- DNS / TLS --------------------------------------------------------------

variable "domain_name" {
  description = "Root domain for the deployment, e.g. forgefreight.com. Must already exist as a Route53 public hosted zone in this account. Leave empty to skip DNS/ACM and expose the ALB's raw DNS name instead (fine for a first deploy, not for customer-facing use)."
  type        = string
  default     = ""
}

variable "api_subdomain" {
  type    = string
  default = "api"
}

variable "web_subdomain" {
  type    = string
  default = "app"
}

variable "auth_subdomain" {
  type    = string
  default = "auth"
}

# --- Secrets that must be supplied, not defaulted ---------------------------

variable "anthropic_api_key" {
  description = "Anthropic API key for document extraction. Empty disables extraction (documents go straight to manual review) — not a hard failure, but you probably want this set."
  type        = string
  default     = ""
  sensitive   = true
}

variable "aisstream_api_key" {
  description = "aisstream.io API key for live AIS vessel tracking. Empty disables the listener."
  type        = string
  default     = ""
  sensitive   = true
}

variable "novu_api_key" {
  description = "Novu API key for shipment-milestone notifications. Empty disables notification dispatch (logged only)."
  type        = string
  default     = ""
  sensitive   = true
}
