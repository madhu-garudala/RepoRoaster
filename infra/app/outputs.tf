output "service_arn" {
  value = aws_apprunner_service.app.arn
}

output "service_url" {
  value = "https://${aws_apprunner_service.app.service_url}"
}

output "deployed_image" {
  value = "${data.terraform_remote_state.bootstrap.outputs.ecr_repository_url}:${var.image_tag}"
}
