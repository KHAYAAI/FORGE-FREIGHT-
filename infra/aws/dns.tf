locals {
  dns_enabled = var.domain_name != ""
  api_fqdn    = local.dns_enabled ? "${var.api_subdomain}.${var.domain_name}" : null
  web_fqdn    = local.dns_enabled ? "${var.web_subdomain}.${var.domain_name}" : null
  auth_fqdn   = local.dns_enabled ? "${var.auth_subdomain}.${var.domain_name}" : null
}

data "aws_route53_zone" "root" {
  count        = local.dns_enabled ? 1 : 0
  name         = var.domain_name
  private_zone = false
}

resource "aws_acm_certificate" "main" {
  count                     = local.dns_enabled ? 1 : 0
  domain_name               = local.web_fqdn
  subject_alternative_names = [local.api_fqdn, local.auth_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.dns_enabled ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = data.aws_route53_zone.root[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count                   = local.dns_enabled ? 1 : 0
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "api" {
  count   = local.dns_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = local.api_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "web" {
  count   = local.dns_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = local.web_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# auth.<domain> (Keycloak) is reachable through the same ALB, path-routed
# like api/web — see alb.tf. Record still needed so the hostname resolves.
resource "aws_route53_record" "auth" {
  count   = local.dns_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = local.auth_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
