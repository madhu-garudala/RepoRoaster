variable "aws_region" {
  description = "AWS region for the service."
  type        = string
  default     = "us-east-1"
}

variable "image_tag" {
  description = "Immutable ECR image tag, normally the Git commit SHA."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.image_tag))
    error_message = "image_tag must be a full 40-character Git commit SHA."
  }
}

variable "site_url" {
  description = "Optional canonical public URL. Leave blank while using the App Runner domain."
  type        = string
  default     = ""
}

variable "enable_waf" {
  description = "Enable the regional WAF rate limit for the paid roast endpoint."
  type        = bool
  default     = true
}

variable "roast_requests_per_five_minutes" {
  description = "Maximum POST /api/roast requests allowed per source IP in five minutes."
  type        = number
  default     = 20

  validation {
    condition     = var.roast_requests_per_five_minutes >= 10
    error_message = "AWS WAF rate limits must be at least 10 requests per evaluation window."
  }
}
