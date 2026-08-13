locals {
  log_services = [
    "api", "worker", "web", "redpanda", "temporal", "keycloak", "yente",
    "kestra", "n8n", "freight-mcp",
  ]
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(local.log_services)
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = 30
}
