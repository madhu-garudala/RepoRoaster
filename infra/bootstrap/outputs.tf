output "state_bucket_name" {
  value = aws_s3_bucket.terraform_state.id
}

output "ecr_repository_name" {
  value = aws_ecr_repository.app.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "apprunner_ecr_access_role_arn" {
  value = aws_iam_role.apprunner_ecr_access.arn
}

output "apprunner_instance_role_arn" {
  value = aws_iam_role.apprunner_instance.arn
}

output "openai_api_key_secret_arn" {
  value = aws_secretsmanager_secret.openai_api_key.arn
}

output "langsmith_api_key_secret_arn" {
  value = aws_secretsmanager_secret.langsmith_api_key.arn
}
