resource "random_password" "db" {
  length  = 32
  special = false # avoid characters that need URL-encoding in DATABASE_URL
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${local.name}-db" }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"

  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage_gb
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.db.result
  port                   = 5432
  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Explicit, not relying on the provider default: the private subnet
  # placement already makes this unreachable from the internet, but a
  # reviewer shouldn't have to know that to confirm it.
  publicly_accessible = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window      = "mon:03:30-mon:04:30"

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"
  copy_tags_to_snapshot     = true

  # api, worker, Temporal, and Keycloak each get their own database on this
  # instance (see below) — one RDS instance is enough for launch, but nothing
  # stops splitting Temporal/Keycloak onto their own instance later.
  tags = { Name = "${local.name}-db" }
}

# Separate logical databases for Temporal and Keycloak, created via the
# postgresql provider would be cleaner, but that requires network access to
# RDS from the machine running `terraform apply` (a bastion or CI runner
# inside the VPC). Documented as a manual `psql` step in DEPLOY.md instead —
# it's a one-line `CREATE DATABASE`, not worth a provider dependency for a
# one-time bootstrap action.

resource "aws_secretsmanager_secret" "db" {
  name        = "${local.name}/database"
  description = "Postgres connection details for FORGE Freight"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db.result
    host     = aws_db_instance.main.address
    port     = 5432
    dbname   = var.db_name
    url      = "postgres://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
  })
}
