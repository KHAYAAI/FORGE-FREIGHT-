# Self-hosted stateful services: Redpanda (event bus), Temporal (lifecycle
# workflows), Keycloak (auth), yente + OpenSearch (sanctions screening).
# Each runs as a single-task ECS service reachable only from api/worker/web
# via AWS Cloud Map service discovery (no public exposure except Keycloak,
# which is routed through the ALB in alb.tf for the OIDC login flow).
#
# Single-task means no HA for these — an acceptable launch tradeoff (this
# mirrors docker-compose.yml's topology exactly), not a permanent one. Scale
# path: MSK for Redpanda, Temporal Cloud, and RDS-per-service multi-AZ.

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${local.name}.internal"
  vpc  = aws_vpc.main.id
}

# --- EFS for Redpanda's data directory --------------------------------

resource "aws_efs_file_system" "redpanda" {
  creation_token   = "${local.name}-redpanda"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${local.name}-redpanda" }
}

resource "aws_efs_mount_target" "redpanda" {
  count           = var.az_count
  file_system_id  = aws_efs_file_system.redpanda.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "redpanda" {
  file_system_id = aws_efs_file_system.redpanda.id

  posix_user {
    uid = 101
    gid = 101
  }

  root_directory {
    path = "/redpanda-data"
    creation_info {
      owner_uid   = 101
      owner_gid   = 101
      permissions = "750"
    }
  }
}

# --- Redpanda ------------------------------------------------------------

resource "aws_service_discovery_service" "redpanda" {
  name = "redpanda"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "redpanda" {
  family                   = "${local.name}-redpanda"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.redpanda_task_cpu
  memory                   = var.redpanda_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  volume {
    name = "redpanda-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.redpanda.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.redpanda.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name  = "redpanda"
    image = "redpandadata/redpanda:v24.2.7"
    portMappings = [
      { containerPort = 9092, protocol = "tcp" },
      { containerPort = 9644, protocol = "tcp" },
    ]
    mountPoints = [{ sourceVolume = "redpanda-data", containerPath = "/var/lib/redpanda/data" }]
    command = [
      "redpanda", "start",
      "--mode", "dev-container",
      "--smp", "1",
      "--memory", "768M",
      "--overprovisioned",
      "--kafka-addr", "PLAINTEXT://0.0.0.0:9092",
      "--advertise-kafka-addr", "PLAINTEXT://redpanda.${local.name}.internal:9092",
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["redpanda"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "redpanda"
      }
    }
  }])
}

resource "aws_ecs_service" "redpanda" {
  name            = "${local.name}-redpanda"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.redpanda.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.redpanda.arn
  }
}

# --- Temporal --------------------------------------------------------------

resource "aws_service_discovery_service" "temporal" {
  name = "temporal"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "temporal" {
  family                   = "${local.name}-temporal"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.temporal_task_cpu
  memory                   = var.temporal_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name         = "temporal"
    image        = "temporalio/auto-setup:1.24"
    portMappings = [{ containerPort = 7233, protocol = "tcp" }]
    environment = [
      { name = "DB", value = "postgres12" },
      { name = "DB_PORT", value = "5432" },
      { name = "POSTGRES_SEEDS", value = aws_db_instance.main.address },
      { name = "POSTGRES_USER", value = var.db_username },
      { name = "DBNAME", value = "temporal" }, # created manually — see DEPLOY.md
      { name = "VISIBILITY_DBNAME", value = "temporal_visibility" },
    ]
    secrets = [
      { name = "POSTGRES_PWD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["temporal"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "temporal"
      }
    }
  }])
}

resource "aws_ecs_service" "temporal" {
  name            = "${local.name}-temporal"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.temporal.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal.arn
  }
}

# --- Keycloak ----------------------------------------------------------

resource "aws_ecs_task_definition" "keycloak" {
  family                   = "${local.name}-keycloak"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.keycloak_task_cpu
  memory                   = var.keycloak_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name = "keycloak"
    # Our own image (infra/aws/ecr.tf, infrastructure/keycloak/Dockerfile):
    # quay.io/keycloak/keycloak:26.0 plus the baked-in forge-freight realm —
    # see infrastructure/keycloak/README.md for what --import-realm sets up
    # automatically (MFA, password policy, brute-force lockout, roles, the
    # tenant_id claim mapper) vs what still needs a real customer's SAML
    # metadata by hand.
    image        = "${aws_ecr_repository.app["keycloak"].repository_url}:${var.image_tag}"
    command      = ["start", "--optimized", "--hostname-strict=false", "--proxy=edge", "--import-realm"]
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "KC_DB", value = "postgres" },
      { name = "KC_DB_URL", value = "jdbc:postgresql://${aws_db_instance.main.address}:5432/keycloak" }, # DB created manually — see DEPLOY.md
      { name = "KC_DB_USERNAME", value = var.db_username },
      { name = "KC_HOSTNAME", value = local.dns_enabled ? local.auth_fqdn : "" },
      { name = "KC_HTTP_ENABLED", value = "true" },
      # KC_BOOTSTRAP_ADMIN_* — the current names as of Keycloak 26;
      # KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD were the pre-26 names this
      # task definition used to carry, aligned now that the image is 26.0.
      { name = "KC_BOOTSTRAP_ADMIN_USERNAME", value = "admin" },
    ]
    secrets = [
      { name = "KC_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
      # Its own credential, not the database's — see orchestration.tf's
      # integration secret. Reusing the DB password here was the previous
      # shape; a bootstrap admin login and the database credential are two
      # different things with two different blast radii if either leaks.
      { name = "KC_BOOTSTRAP_ADMIN_PASSWORD", valueFrom = "${aws_secretsmanager_secret.integration.arn}:keycloak_admin_password::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["keycloak"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "keycloak"
      }
    }
  }])
}

resource "aws_ecs_service" "keycloak" {
  name            = "${local.name}-keycloak"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.keycloak.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.keycloak.arn
    container_name   = "keycloak"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]
}

# --- OpenSearch (yente's sanctions index) -----------------------------

resource "aws_opensearch_domain" "yente" {
  domain_name    = "${local.name}-yente"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type  = var.opensearch_instance_type
    instance_count = 1
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.opensearch_volume_size_gb
    volume_type = "gp3"
  }

  vpc_options {
    subnet_ids         = [aws_subnet.private[0].id]
    security_group_ids = [aws_security_group.opensearch.id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https = true
  }

  advanced_security_options {
    enabled                        = false # single-node, VPC-internal only — SG is the boundary
    internal_user_database_enabled = false
  }
}

# --- yente (sanctions screening API) --------------------------------------

resource "aws_service_discovery_service" "yente" {
  name = "yente"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "yente" {
  family                   = "${local.name}-yente"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.yente_task_cpu
  memory                   = var.yente_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name         = "yente"
    image        = "ghcr.io/opensanctions/yente:4.1.0"
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    environment = [
      { name = "YENTE_INDEX_URL", value = "https://${aws_opensearch_domain.yente.endpoint}" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["yente"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "yente"
      }
    }
  }])
}

resource "aws_ecs_service" "yente" {
  name            = "${local.name}-yente"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.yente.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.yente.arn
  }
}
