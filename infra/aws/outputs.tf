output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "web_url" {
  value = local.dns_enabled ? "https://${local.web_fqdn}" : "http://${aws_lb.main.dns_name}"
}

output "api_url" {
  value = local.dns_enabled ? "https://${local.api_fqdn}" : "http://${aws_lb.main.dns_name} (path-based routing not configured without a domain — set domain_name)"
}

output "auth_url" {
  value = local.dns_enabled ? "https://${local.auth_fqdn}" : null
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "db_secret_arn" {
  value = aws_secretsmanager_secret.db.arn
}

output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.app : k => v.repository_url }
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "opensearch_endpoint" {
  value = aws_opensearch_domain.yente.endpoint
}

output "integration_secret_arn" {
  description = "Secrets Manager ARN holding ingest_api_key, agent_api_key, kestra_admin_password, n8n_admin_password, n8n_encryption_key."
  value       = aws_secretsmanager_secret.integration.arn
}

output "kestra_internal_url" {
  description = "Kestra's UI/API, reachable only from inside the VPC (no ALB route). Use ECS Exec or a bastion/VPN to reach it — see DEPLOY.md."
  value       = "http://${aws_service_discovery_service.kestra.name}.${aws_service_discovery_private_dns_namespace.main.name}:8080"
}

output "n8n_internal_url" {
  description = "n8n's UI/API, reachable only from inside the VPC. Deployed with desired_count 0 until freight_tenant_id is set."
  value       = "http://${aws_service_discovery_service.n8n.name}.${aws_service_discovery_private_dns_namespace.main.name}:5678"
}

output "freight_mcp_internal_url" {
  description = "freight-mcp's HTTP MCP endpoint, reachable only from inside the VPC. Deployed with desired_count 0 by default — see var.freight_mcp_desired_count."
  value       = "http://${aws_service_discovery_service.freight_mcp.name}.${aws_service_discovery_private_dns_namespace.main.name}:9000/mcp"
}
