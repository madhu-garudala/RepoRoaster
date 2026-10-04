# Repo Roast

**Live demo: [repo-roaster-eta.vercel.app](https://repo-roaster-eta.vercel.app/)**

Paste a public GitHub repository, or pick a folder on your machine, choose a personality, and get a roast of the codebase. Repo Roast reads repository metadata, maps the project tree, samples a bounded set of high-signal files, and asks GPT-5.6 Luna for a structured roast. The roast has a vibes score from 0 to 100, four "hits" quoting the code, one redeeming quality and three pieces of sarcastic first aid.

It is entertainment, not a code review: the jokes are written from the files it actually read, but the advice is intentionally useless.

## Try it

1. Open [repo-roaster-eta.vercel.app](https://repo-roaster-eta.vercel.app/).
2. Paste a URL such as `https://github.com/vercel/next.js`, or click **Local folder** to roast a project on your disk.
3. Pick a mode and hit roast. Status updates stream in while the repo is read and the roast is written.
4. Switch modes and roast again to rewrite the same roast in a new voice without re-analysing the repository.

## Roast modes

| Mode | Personality |
| --- | --- |
| **Pep Talk** | A condescending kindergarten teacher praising your macaroni-art code |
| **Code Review** | An insufferable 10x tech bro gatekeeping your "aesthetic" |
| **Napalm** | Merciless internet roasting of your life choices |
| **NSFW** | Unfiltered and explicitly profane |
| **Funny** | A five-minute stand-up set about your repository |

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
- **Caching:** fresh GitHub roasts are cached in process for one hour (up to 50 entries). Local-folder roasts and tone rewrites are never cached, because they are built from data the client sends.
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
| `GITHUB_TOKEN` | No | Higher GitHub API rate limit |
| `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING` | No | Tracing |
| `NEXT_PUBLIC_SITE_URL` | No | Canonical origin for metadata and social cards |

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

The cache and the absence of a per-user rate limit are per-instance and in memory. For heavier public traffic, add a platform rate limit (for example a Vercel Firewall rule on `/api/roast`) and a shared cache.
