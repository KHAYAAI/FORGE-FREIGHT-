locals {
  # kestra and n8n pull their public images directly (kestra/kestra,
  # n8nio/n8n) — same as temporal/yente in supporting.tf. freight-mcp is our
  # own code; keycloak is the public image plus the baked-in forge-freight
  # realm (infrastructure/keycloak/) — both need a repo like api/worker/web do.
  ecr_repo_names = ["api", "worker", "web", "freight-mcp", "keycloak"]
}

resource "aws_ecr_repository" "app" {
  for_each             = toset(local.ecr_repo_names)
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
