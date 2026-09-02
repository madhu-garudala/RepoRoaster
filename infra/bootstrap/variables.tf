variable "aws_region" {
  description = "AWS region for Repo Roaster resources."
  type        = string
  default     = "us-east-1"
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to assume the deployment role."
  type        = string
  default     = "madhu-garudala/RepoRoaster"
}

variable "github_environment" {
  description = "Protected GitHub environment allowed to deploy."
  type        = string
  default     = "production"
}
