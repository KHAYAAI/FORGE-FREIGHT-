# Security groups. All inter-service traffic stays inside the VPC — only the
# ALB is reachable from the internet, and only on 80/443.

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Internet-facing ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP (redirected to HTTPS by the listener)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-alb" }
}

resource "aws_security_group" "ecs_services" {
  name        = "${local.name}-ecs-services"
  description = "api/web/worker ECS tasks — reachable from the ALB only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-ecs-services" }
}

resource "aws_security_group" "supporting" {
  name        = "${local.name}-supporting"
  description = "Self-hosted Redpanda/Temporal/Keycloak/yente tasks — internal only, reachable from api/worker/web"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From api/worker/web"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_services.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-supporting" }
}

# Supporting services also need to reach each other (e.g. Temporal -> RDS is
# covered by rds SG below; Keycloak has no peer dependency beyond RDS).
resource "aws_security_group_rule" "supporting_self" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  security_group_id        = aws_security_group.supporting.id
  source_security_group_id = aws_security_group.supporting.id
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Postgres — reachable from ECS services and supporting services only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From api/worker/web"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_services.id]
  }

  ingress {
    description     = "From Temporal/Keycloak"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.supporting.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-rds" }
}

resource "aws_security_group" "opensearch" {
  name        = "${local.name}-opensearch"
  description = "OpenSearch domain backing yente sanctions search — reachable from supporting services only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From yente"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.supporting.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-opensearch" }
}

resource "aws_security_group" "efs" {
  name        = "${local.name}-efs"
  description = "EFS mount targets for Redpanda's data directory"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from supporting services"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.supporting.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-efs" }
}
