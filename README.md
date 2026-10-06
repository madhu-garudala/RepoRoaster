# Repo Roast

**Live demo: [repo-roaster-eta.vercel.app](https://repo-roaster-eta.vercel.app/)**

Paste a public GitHub repository, or pick a folder on your machine, choose a personality, and get a long-form roast of the codebase. Repo Roast reads repository metadata, maps the project tree, samples a bounded set of high-signal files, and asks GPT-5.6 Luna for a structured roast. Each roast has a vibes score from 0 to 100, a cold-open monologue, five escalating "hits" that quote the code, one backhanded compliment, three pieces of sarcastic first aid and a mic-drop closer that calls back to the opening.

It is entertainment, not a code review: the jokes are written from the files it actually read, but the advice is intentionally useless.

## Try it

1. Open [repo-roaster-eta.vercel.app](https://repo-roaster-eta.vercel.app/).
2. Click one of the **Try one** examples for a one-click roast, paste a URL such as `https://github.com/vercel/next.js`, or click **Local folder** to roast a project on your disk.
3. Pick a mode and hit roast. Status updates stream in while the repo is read and the roast is written.
4. Switch modes and roast again to rewrite the same roast in a new voice without re-analysing the repository.
5. Share it: **Share on X**, **Copy roast** as text, or **Download card** for a 1200×630 image.

## Roast modes

| Mode | Personality |
| --- | --- |
| **Pep Talk** | A relentlessly upbeat, deeply condescending kindergarten teacher handing out gold stars |
| **Code Review** | An insufferable 10x staff engineer leaving `nit:` and `blocking:` comments. LGTM… not. |
| **Napalm** | A roast-battle headliner with zero mercy |
| **NSFW** | Fully uncensored and explicit, swearing in every sentence (aimed at the code, never slurs) |
| **Funny** (default) | A stand-up set: cold open with crowd work, bits with act-outs, escalating tags and a callback closer |

Every mode is written to the same comedy brief: jokes must hang on something real in the repository (a file, a function name, a dependency, a metric), generic programmer jokes are banned unless twisted, and the hits escalate to the strongest burn last.

## How it works

```
GitHub URL ──► validate (github.com/{owner}/{repo} only)
               │
               ├─► GitHub REST API: metadata, languages, full tree
               ├─► rank files (README, manifests, configs, workflows, entry points, tests)
               └─► fetch up to 12 files (≤14k chars each, ≤72k total)
                                   │
Local folder ──► sampled in the browser with the same ranking and limits
                                   │
                                   ▼
               OpenAI Responses API (gpt-5.6-luna, medium reasoning,
               strict JSON schema, store: false, 52 s deadline)
                                   │
                                   ▼
               server-sent events ──► score dial, hits, first aid
```

- **Streaming:** `/api/roast` responds with server-sent events (status updates, then the result). Leaving the page cancels the upstream work.
- **Tone switching:** a repeat roast of the same target sends the previous roast back, so only the voice is rewritten. This saves the GitHub reads and most of the tokens.
- **Caching:** fresh GitHub roasts are cached for six hours per repository, mode and model. With Upstash Redis configured, the cache is shared by every server instance. Otherwise it lives in each instance's memory. Local-folder roasts and tone rewrites are never cached, because they are built from data the client sends.
- **Spend protection:** each fresh roast (a model call) counts against a per-visitor hourly limit and a site-wide daily cap. Cache hits are free. Visitors over the limit get a clear "come back later" message with a `Retry-After` header.
- **Friendly failures:** if the OpenAI account is out of credit, the key is invalid or the model isn't available, visitors see "the roaster is out of fuel" instead of a generic error. The real cause (status, error code, message) goes to the server log only.
- **Observability:** LangSmith traces with bounded, redacted inputs and outputs. Logs are structured, carry a request ID, and store a hash of the repository name instead of the name itself.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- OpenAI Responses API with Zod structured output
- GitHub REST API
- LangSmith (optional)
- Vitest, ESLint, GitHub Actions
- Deployed on Vercel. An alternative AWS App Runner deployment is defined in Terraform.

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local   # then set OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Roast generation |
| `ROAST_MODEL` | No | OpenAI model to use (default `gpt-5.6-luna`) |
| `ROAST_RATE_LIMIT_PER_HOUR` | No | Fresh roasts per visitor per hour (default 6) |
| `ROAST_DAILY_LIMIT` | No | Fresh roasts per UTC day across the site (default 300) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | No, but recommended in production | Shared cache and limits across server instances. Add them with the Upstash integration in the Vercel Marketplace. |
| `GITHUB_TOKEN` | No | Higher GitHub API rate limit |
| `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING` | No | Tracing |
| `NEXT_PUBLIC_SITE_URL` | No | Canonical origin for metadata and social cards |

Without Upstash, limits and the cache are kept per server instance, so on a serverless platform they are approximate. Pair them with a platform rate limit (for example a Vercel Firewall rule on `/api/roast`) and a spending alert on the OpenAI account.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs these checks on every pull request, plus `npm audit` and Terraform validation.

## Deployment

- **Vercel (live demo):** import the repo into Vercel and set `OPENAI_API_KEY`, plus any optional variables, in the project settings. `next.config.ts` turns off the standalone output when it builds on Vercel.
- **AWS:** a Terraform-defined deployment using ECR, App Runner, Secrets Manager and a WAF rate limit, deployed from GitHub Actions with OIDC. See [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md).

## Safety and privacy

- Only root URLs on `github.com/{owner}/{repo}` are accepted, which prevents arbitrary server-side URL fetching.
- Repository files are treated as untrusted data, and the prompt tells the model to ignore any instructions they contain.
- Analysis is bounded to 12 files, 14,000 characters per file and 72,000 characters in total. The server re-checks these limits on local-folder uploads, and request bodies are capped at 1 MB.
- For local-folder uploads, identity fields such as owner, URL and stars are set by the server, never taken from the client. The results page only links to `github.com`.
- OpenAI requests use `store: false`. No source code or roast history is persisted.
- Responses send security headers, including HSTS, `X-Frame-Options: DENY` and `nosniff`.

Rate limits key on a hash of the client IP address, never the raw address.
