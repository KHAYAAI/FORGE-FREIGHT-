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
