provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "repo-roaster"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

data "terraform_remote_state" "bootstrap" {
  backend = "s3"
  config = {
    bucket       = "repo-roaster-tfstate-137812392649-us-east-1"
    key          = "bootstrap/terraform.tfstate"
    region       = var.aws_region
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  service_name = "repo-roaster"
  runtime_environment_variables = merge(
    {
      APP_VERSION             = var.image_tag
      LANGSMITH_PROJECT       = "RepoRoasterNew"
      LANGSMITH_TRACING       = "true"
      LANGCHAIN_TRACING_V2    = "true"
      NEXT_TELEMETRY_DISABLED = "1"
    },
    var.site_url == "" ? {} : { NEXT_PUBLIC_SITE_URL = var.site_url },
  )
}

resource "aws_apprunner_auto_scaling_configuration_version" "app" {
  auto_scaling_configuration_name = "${local.service_name}-production"
  max_concurrency                 = 20
  max_size                        = 3
  min_size                        = 1

  tags = {
    Name = "${local.service_name}-production"
  }
}

resource "aws_apprunner_service" "app" {
  service_name                   = local.service_name
  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.app.arn

  source_configuration {
    auto_deployments_enabled = false

    authentication_configuration {
      access_role_arn = data.terraform_remote_state.bootstrap.outputs.apprunner_ecr_access_role_arn
    }

    image_repository {
      image_identifier      = "${data.terraform_remote_state.bootstrap.outputs.ecr_repository_url}:${var.image_tag}"
      image_repository_type = "ECR"

      image_configuration {
        port                          = "3000"
        runtime_environment_variables = local.runtime_environment_variables
        runtime_environment_secrets = {
          OPENAI_API_KEY    = data.terraform_remote_state.bootstrap.outputs.openai_api_key_secret_arn
          LANGSMITH_API_KEY = data.terraform_remote_state.bootstrap.outputs.langsmith_api_key_secret_arn
        }
      }
    }
  }

  instance_configuration {
    cpu               = "0.25 vCPU"
    memory            = "0.5 GB"
    instance_role_arn = data.terraform_remote_state.bootstrap.outputs.apprunner_instance_role_arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = {
    Name = local.service_name
  }
}

resource "aws_wafv2_web_acl" "app" {
  count = var.enable_waf ? 1 : 0

  name  = "${local.service_name}-production"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-roast"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        limit                 = var.roast_requests_per_five_minutes

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                positional_constraint = "EXACTLY"
                search_string         = "/api/roast"

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }

            statement {
              byte_match_statement {
                positional_constraint = "EXACTLY"
                search_string         = "POST"

                field_to_match {
                  method {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RepoRoasterRateLimit"
      sampled_requests_enabled   = false
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "RepoRoasterWebAcl"
    sampled_requests_enabled   = false
  }
}

resource "aws_wafv2_web_acl_association" "app" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_apprunner_service.app.arn
  web_acl_arn  = aws_wafv2_web_acl.app[0].arn
}
