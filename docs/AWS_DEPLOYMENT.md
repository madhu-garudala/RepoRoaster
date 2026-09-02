# AWS production deployment

## Outcome

Every pull request is linted, typechecked, tested, dependency-audited, container-built,
and Terraform-validated. Every merge to `main` repeats the quality gate, builds an
immutable container tagged with the commit SHA, pushes it to ECR, applies a reviewed
Terraform plan, and verifies the live health endpoint.

The application deployment itself never uses local `terraform apply` or long-lived AWS
keys. GitHub Actions exchanges its OIDC token for a short-lived, repository-scoped AWS
role.

## Architecture

```text
GitHub main branch
  -> GitHub Actions quality gate
  -> immutable linux/amd64 image in ECR
  -> Terraform plan and apply using GitHub OIDC
  -> AWS WAF rate limit
  -> AWS App Runner (1-3 small instances)
  -> OpenAI, GitHub API, and optional LangSmith

Terraform state -> encrypted/versioned S3 bucket with native lock files
Runtime secrets -> AWS Secrets Manager -> App Runner instance role
Application logs -> CloudWatch Logs (managed automatically by App Runner)
```

App Runner is the first production target because this application needs a server runtime
and streams responses for as long as 52 seconds. It has no database and does not need a
VPC. App Runner preserves those requests, provides TLS and autoscaling, and avoids the
fixed cost of an ECS load balancer, NAT gateway, or Kubernetes cluster.

## Cost envelope

Approximate baseline in `us-east-1`, before application traffic and third-party API use:

- App Runner 0.5 GB provisioned memory: about $2.56/month while idle. Active requests add
  memory and 0.25-vCPU usage billed by the second.
- AWS WAF: about $6/month for one web ACL and one rule, plus request charges. This protects
  the paid AI endpoint at 20 requests per source IP per five minutes.
- Secrets Manager: about $0.80/month for the OpenAI and LangSmith secrets.
- ECR, S3 state, and CloudWatch logs: usage-based and normally pennies at hobby scale;
  ECR retains only the newest 20 images.

The expected quiet-project baseline is roughly $9-10/month plus OpenAI/LangSmith usage.
Set `enable_waf=false` only if accepting abuse risk is worth saving roughly $6/month.
App Runner is capped at three instances, so infrastructure scale-out is bounded.

Prices change; confirm the AWS pricing pages before using this as a formal budget.

## One-time trust bootstrap

The OIDC role and its state bucket have a deliberate bootstrap dependency: CI cannot assume
a role or use a state bucket before they exist. This is the only locally initiated apply;
it creates the trust plane with Terraform, after which CI/CD owns all changes.

From `infra/bootstrap`:

```sh
terraform init -backend=false
terraform apply
terraform init -migrate-state
```

The role trust is restricted to this repository's protected `production` environment. It
accepts both GitHub's legacy repository subject and the immutable owner/repository-ID subject
used by repositories created after July 15, 2026.

Populate secret values without putting them in Terraform state:

```sh
aws secretsmanager put-secret-value \
  --secret-id repo-roaster/production/openai-api-key \
  --secret-string 'REPLACE_INTERACTIVELY'

aws secretsmanager put-secret-value \
  --secret-id repo-roaster/production/langsmith-api-key \
  --secret-string 'REPLACE_INTERACTIVELY'
```

Never add secret values to `.tfvars`, Markdown, workflow YAML, or Terraform resources. Secret
values are operational data; Terraform manages the secret containers and access policies.

## Normal deployment

1. Open a pull request. The `CI` workflow must pass.
2. Merge to `main`.
3. `Deploy production` builds and pushes the commit image.
4. The workflow creates a Terraform plan, applies it, and calls `/api/health`.
5. The workflow summary publishes the App Runner URL and deployed commit.

Rollback is a normal Git revert followed by merge. The resulting commit is built and deployed
through exactly the same pipeline. Do not retag images or update App Runner by hand.

## Scaling and safety controls

- Minimum instances: 1, preserving responsive hobby-project UX.
- Maximum instances: 3, bounding infrastructure spend.
- Concurrency target: 20 requests per instance.
- WAF: blocks more than 20 roast POSTs per IP in five minutes.
- App request body: capped at 1 MiB in application code.
- Roast execution: capped at 52 seconds, below App Runner's 120-second request limit.
- ECR: immutable tags and scan-on-push.
- Secrets: referenced from Secrets Manager; values never enter images or Terraform state.
- Logs: structured application events flow to CloudWatch through stdout.

The first scale bottleneck will be the unauthenticated GitHub API allowance, followed by
OpenAI spend—not App Runner compute. Before broad promotion, create a GitHub App or a narrowly
scoped token, add a global application quota, and set provider-side OpenAI project budgets.

## Operations

Check the public health endpoint:

```sh
service_url=$(terraform -chdir=infra/app output -raw service_url)
curl --fail "${service_url}/api/health"
```

Inspect App Runner status:

```sh
aws apprunner list-services \
  --query 'ServiceSummaryList[?ServiceName==`repo-roaster`]'
```

Application and deployment logs are under `/aws/apprunner/repo-roaster/...` in CloudWatch
Logs. Use request IDs from API responses to correlate user-visible errors with structured
log events.

## Next hardening milestone

The next iteration should add a custom Route 53 domain, CloudWatch alarms with an explicit
notification destination, a distributed global request/spend quota, end-to-end browser tests,
and a GitHub App integration. Those are intentionally separate from the first deployment so
the app can exist on AWS without speculative infrastructure.
