# Kestra (scheduler), n8n (integration/loading-dock) and freight-mcp (the
# read-only agent surface) — the automation/integration/agent layer added
# alongside the existing Freight Core. Same self-hosted-on-Fargate shape as
# supporting.tf: single task each, `supporting` security group, reachable
# from api/worker/web only. Kestra and n8n get their own logical database on
# the shared RDS instance (same pattern as Temporal/Keycloak — see DEPLOY.md
# for the manual `CREATE DATABASE` step); freight-mcp holds no database
# credentials at all, by design (see services/freight-mcp/README.md).
#
# Known Fargate gap: infrastructure/kestra/docker-compose.yml mounts the
# Docker socket so Kestra can run container-based tasks locally. Fargate
# gives no such socket, so only HTTP/webhook/script-based flows (everything
# built so far — see infrastructure/kestra/flows/) work here. Documented in
# DEPLOY.md; not a blocker for what exists today.

# --- Shared secrets ---------------------------------------------------------
#
# One secret, several keys — mirrors rds.tf's aws_secretsmanager_secret.db.
# ingest_api_key is shared by api (validates it), Kestra and n8n (present it
# on scheduled/ingest calls). agent_api_key is shared by api and freight-mcp
# only. Generating both here, instead of leaving them blank literals to
# rotate by hand, is what lets four separate services agree on the same
# value without anyone copy-pasting a secret between consoles.

resource "random_password" "ingest_api_key" {
  length  = 32
  special = false
}

resource "random_password" "agent_api_key" {
  length  = 32
  special = false
}

resource "random_password" "kestra_admin_password" {
  length  = 24
  special = false
}

resource "random_password" "n8n_admin_password" {
  length  = 24
  special = false
}

resource "random_password" "n8n_encryption_key" {
  length  = 32
  special = false
}

resource "random_password" "keycloak_admin_password" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "integration" {
  name        = "${local.name}/integration"
  description = "Shared credentials for the automation/integration/agent layer: api, Kestra, n8n, freight-mcp, Keycloak"
}

resource "aws_secretsmanager_secret_version" "integration" {
  secret_id = aws_secretsmanager_secret.integration.id
  secret_string = jsonencode({
    ingest_api_key          = random_password.ingest_api_key.result
    agent_api_key           = random_password.agent_api_key.result
    kestra_admin_password   = random_password.kestra_admin_password.result
    n8n_admin_password      = random_password.n8n_admin_password.result
    n8n_encryption_key      = random_password.n8n_encryption_key.result
    keycloak_admin_password = random_password.keycloak_admin_password.result
  })
}

# --- EFS: Kestra's local storage (flow outputs, task working dirs) ---------

resource "aws_efs_file_system" "kestra" {
  creation_token   = "${local.name}-kestra"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${local.name}-kestra" }
}

resource "aws_efs_mount_target" "kestra" {
  count           = var.az_count
  file_system_id  = aws_efs_file_system.kestra.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "kestra" {
  file_system_id = aws_efs_file_system.kestra.id

  # docker-compose.yml runs the Kestra container as root (it needs the
  # Docker socket locally); matching uid/gid 0 here for parity, even though
  # Fargate never grants the socket itself — see the module header.
  posix_user {
    uid = 0
    gid = 0
  }

  root_directory {
    path = "/kestra-storage"
    creation_info {
      owner_uid   = 0
      owner_gid   = 0
      permissions = "750"
    }
  }
}

# --- EFS: n8n's data dir (encrypted credentials, execution history cache) --

resource "aws_efs_file_system" "n8n" {
  creation_token   = "${local.name}-n8n"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${local.name}-n8n" }
}

resource "aws_efs_mount_target" "n8n" {
  count           = var.az_count
  file_system_id  = aws_efs_file_system.n8n.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "n8n" {
  file_system_id = aws_efs_file_system.n8n.id

  # n8n's official image runs as uid/gid 1000 (the "node" user).
  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/n8n-data"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "750"
    }
  }
}

# --- Kestra ------------------------------------------------------------

resource "aws_service_discovery_service" "kestra" {
  name = "kestra"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "kestra" {
  family                   = "${local.name}-kestra"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.kestra_task_cpu
  memory                   = var.kestra_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  volume {
    name = "kestra-storage"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.kestra.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.kestra.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name         = "kestra"
    image        = "kestra/kestra:latest"
    user         = "root"
    command      = ["server", "standalone", "--worker-thread=2"]
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    mountPoints  = [{ sourceVolume = "kestra-storage", containerPath = "/app/storage" }]
    environment = [
      {
        # Micronaut (which Kestra is built on) resolves `$${VAR}` placeholders
        # from the container's own environment at startup — the same
        # mechanism docker-compose.yml relies on, just substituted by Kestra
        # itself instead of by compose. That's what lets the jdbc/basic-auth
        # passwords below come from Secrets Manager (via the `secrets` block)
        # without ever appearing in this JSON or in Terraform state twice.
        name = "KESTRA_CONFIGURATION"
        value = yamlencode({
          datasources = {
            postgres = {
              url      = "jdbc:postgresql://${aws_db_instance.main.address}:5432/kestra" # DB created manually — see DEPLOY.md
              username = var.db_username
              password = "$${KESTRA_DB_PASSWORD}"
            }
          }
          kestra = {
            server = {
              basic-auth = {
                enabled  = true
                username = var.kestra_admin_user
                password = "$${KESTRA_ADMIN_PASSWORD}"
              }
            }
            repository = { type = "postgres" }
            queue      = { type = "postgres" }
            storage = {
              type  = "local"
              local = { base-path = "/app/storage" }
            }
          }
        })
      },
      { name = "KESTRA_ENV_FREIGHT_API_URL", value = "http://${aws_service_discovery_service.api.name}.${aws_service_discovery_private_dns_namespace.main.name}:3001" },
    ]
    secrets = [
      { name = "KESTRA_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
      { name = "KESTRA_ADMIN_PASSWORD", valueFrom = "${aws_secretsmanager_secret.integration.arn}:kestra_admin_password::" },
      { name = "SECRET_FREIGHT_INGEST_API_KEY", valueFrom = "${aws_secretsmanager_secret.integration.arn}:ingest_api_key::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["kestra"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "kestra"
      }
    }
  }])
}

resource "aws_ecs_service" "kestra" {
  name            = "${local.name}-kestra"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.kestra.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.kestra.arn
  }

  depends_on = [aws_ecs_service.api]
}

# --- n8n -----------------------------------------------------------------

resource "aws_service_discovery_service" "n8n" {
  name = "n8n"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "n8n" {
  family                   = "${local.name}-n8n"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.n8n_task_cpu
  memory                   = var.n8n_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  volume {
    name = "n8n-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.n8n.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.n8n.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name         = "n8n"
    image        = "n8nio/n8n:latest"
    portMappings = [{ containerPort = 5678, protocol = "tcp" }]
    mountPoints  = [{ sourceVolume = "n8n-data", containerPath = "/home/node/.n8n" }]
    environment = [
      { name = "DB_TYPE", value = "postgresdb" },
      { name = "DB_POSTGRESDB_HOST", value = aws_db_instance.main.address },
      { name = "DB_POSTGRESDB_DATABASE", value = "n8n" }, # DB created manually — see DEPLOY.md
      { name = "DB_POSTGRESDB_USER", value = var.db_username },
      { name = "N8N_BASIC_AUTH_ACTIVE", value = "true" },
      { name = "N8N_BASIC_AUTH_USER", value = var.n8n_admin_user },
      { name = "GENERIC_TIMEZONE", value = "Africa/Johannesburg" },
      { name = "N8N_DIAGNOSTICS_ENABLED", value = "false" },
      { name = "EXECUTIONS_DATA_SAVE_ON_SUCCESS", value = "all" },
      { name = "EXECUTIONS_DATA_SAVE_ON_ERROR", value = "all" },
      { name = "EXECUTIONS_DATA_MAX_AGE", value = "720" },
      { name = "N8N_LOG_LEVEL", value = "info" },
      { name = "FREIGHT_API_URL", value = "http://${aws_service_discovery_service.api.name}.${aws_service_discovery_private_dns_namespace.main.name}:3001" },
      { name = "FREIGHT_TENANT_ID", value = var.freight_tenant_id },
    ]
    secrets = [
      { name = "DB_POSTGRESDB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
      { name = "N8N_BASIC_AUTH_PASSWORD", valueFrom = "${aws_secretsmanager_secret.integration.arn}:n8n_admin_password::" },
      { name = "N8N_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.integration.arn}:n8n_encryption_key::" },
      { name = "FREIGHT_INGEST_API_KEY", valueFrom = "${aws_secretsmanager_secret.integration.arn}:ingest_api_key::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["n8n"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "n8n"
      }
    }
  }])
}

resource "aws_ecs_service" "n8n" {
  name            = "${local.name}-n8n"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.n8n.arn
  desired_count   = var.freight_tenant_id == "" ? 0 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.n8n.arn
  }

  depends_on = [aws_ecs_service.api]
}

# --- freight-mcp -----------------------------------------------------------
#
# Holds no database credentials — an HTTP client against api, nothing more.
# desired_count defaults to 0 (var.freight_mcp_desired_count): nothing else
# in the platform depends on it being up, and there's no point running a
# read-only agent surface with no agent host configured to call it yet.

resource "aws_service_discovery_service" "freight_mcp" {
  name = "freight-mcp"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "freight_mcp" {
  family                   = "${local.name}-freight-mcp"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.freight_mcp_task_cpu
  memory                   = var.freight_mcp_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.generic_task.arn

  container_definitions = jsonencode([{
    name         = "freight-mcp"
    image        = "${aws_ecr_repository.app["freight-mcp"].repository_url}:${var.image_tag}"
    portMappings = [{ containerPort = 9000, protocol = "tcp" }]
    environment = [
      { name = "FREIGHT_API_URL", value = "http://${aws_service_discovery_service.api.name}.${aws_service_discovery_private_dns_namespace.main.name}:3001" },
      { name = "FREIGHT_MCP_TENANT_ID", value = var.freight_tenant_id },
      { name = "MCP_TRANSPORT", value = "http" },
      { name = "MCP_HTTP_PORT", value = "9000" },
    ]
    secrets = [
      { name = "FREIGHT_MCP_AGENT_KEY", valueFrom = "${aws_secretsmanager_secret.integration.arn}:agent_api_key::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc["freight-mcp"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "freight-mcp"
      }
    }
  }])
}

resource "aws_ecs_service" "freight_mcp" {
  name            = "${local.name}-freight-mcp"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.freight_mcp.arn
  desired_count   = var.freight_tenant_id == "" ? 0 : var.freight_mcp_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.supporting.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.freight_mcp.arn
  }

  depends_on = [aws_ecs_service.api]
}
