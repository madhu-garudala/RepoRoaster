# Repo Roast

Repo Roast turns a public GitHub repository into an evidence-backed code roast. It reads repository metadata, maps the project tree, samples a bounded set of high-signal source and configuration files, and asks GPT-5.6 Luna for a structured review in one of five personalities.

## Roast modes

- **Pep Talk** — gentle, constructive feedback.
- **Code Review** — direct and professional.
- **Napalm** — brutal, unsweetened criticism.
- **NSFW** — extremely brutal and explicitly profane; aimed at the code, never the author.
- **Funny** — actionable analysis written like a comedy set.

The personality changes delivery, not evidence. Every finding must cite a sampled file or a repository metric.

## Stack

- React 19, TypeScript, vinext, Vite, and Tailwind CSS 4
- Cloudflare Worker-compatible server routes
- GitHub REST API for public repository metadata, trees, languages, and file blobs
- OpenAI Responses API with `gpt-5.6-luna`, medium reasoning, and strict structured output
- LangSmith tracing with bounded/redacted inputs and outputs
- Server-sent status events, client cancellation, request IDs, safe error messages, and a bounded one-hour in-process response cache

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`OPENAI_API_KEY` is required. `GITHUB_TOKEN` is optional but recommended for a higher GitHub API allowance. LangSmith is optional; traces are enabled when `LANGSMITH_API_KEY` exists unless `LANGSMITH_TRACING=false`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
```

## Safety and privacy

- Only root URLs on `github.com/{owner}/{repo}` are accepted, preventing arbitrary server-side URL fetching.
- Repository files are treated as untrusted data, and embedded prompt instructions are ignored.
- Analysis is bounded to 12 files, 14,000 characters per file, and 72,000 total sampled characters.
- OpenAI requests use `store: false` and a 52-second server deadline.
- Trace payloads are redacted and bounded. Structured logs contain a hash of the public repository name rather than the raw name.
- No source code or roast history is persisted by the app. A process-local cache keeps up to 50 results for one hour.

For production-scale spend controls, add a distributed rate limiter and distributed cache rather than relying on per-instance memory.
