resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# --- api ---------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_task_cpu
  memory                   = var.api_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([{
    name         = "api"
    image        = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "AUTH_MODE", value = "jwt" },
      { name = "AUTH_ISSUER", value = local.dns_enabled ? "https://${local.auth_fqdn}/realms/forge-freight" : "" },
      { name = "CORS_ORIGINS", value = local.dns_enabled ? "https://${local.web_fqdn}" : "*" },
      { name = "KAFKA_BROKERS", value = "${aws_service_discovery_service.redpanda.name}.${aws_service_discovery_private_dns_namespace.main.name}:9092" },
      { name = "TEMPORAL_ADDRESS", value = "${aws_service_discovery_service.temporal.name}.${aws_service_discovery_private_dns_namespace.main.name}:7233" },
      { name = "YENTE_URL", value = "http://${aws_service_discovery_service.yente.name}.${aws_service_discovery_private_dns_namespace.main.name}:8000" },
      { name = "INGEST_API_KEY", value = "" }, # set via console/Secrets Manager rotation — not committed to state as a literal
      { name = "ANTHROPIC_API_KEY", value = var.anthropic_api_key },
      { name = "AISSTREAM_API_KEY", value = var.aisstream_api_key },
      { name = "NOVU_API_KEY", value = var.novu_api_key },
      { name = "DOC_STORAGE_DRIVER", value = "s3" },
      { name = "DOC_STORAGE_S3_BUCKET", value = aws_s3_bucket.documents.bucket },
      { name = "DOC_STORAGE_S3_REGION", value = var.aws_region },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db.arn}:url::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["api"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_services.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.http, aws_ecs_service.temporal, aws_ecs_service.redpanda]
}

# --- worker (Temporal workflow worker) ----------------------------------

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_task_cpu
  memory                   = var.worker_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name  = "worker"
    image = "${aws_ecr_repository.app["worker"].repository_url}:${var.image_tag}"
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "TEMPORAL_ADDRESS", value = "${aws_service_discovery_service.temporal.name}.${aws_service_discovery_private_dns_namespace.main.name}:7233" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db.arn}:url::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["worker"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_services.id]
  }

  depends_on = [aws_ecs_service.temporal]
}

# --- web -----------------------------------------------------------------

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_task_cpu
  memory                   = var.web_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name         = "web"
    image        = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "NEXT_PUBLIC_API_URL", value = local.dns_enabled ? "https://${local.api_fqdn}" : "http://localhost:3001" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["web"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_services.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}
