# Memory

Durable facts, conventions, and gotchas that should survive across sessions.

## User workflow

- Long sessions keep state in `agent-state/`: `project-state.md`, `memory.md`, `left-off.md`.
- When a session gets compacted or messy, the user starts a new session and has the model read these files to resume.
- Rules and preferences live in `AGENTS.md`. Read it first.

## Project facts

- Project name: **Reflex**, for the Bitget AI Base Camp S2 hackathon (AI Trading Desk, Review & Self-Evolution).
- PRD, TRD, project plan, and copy guidelines live in `docs/`. Read them before product or feature decisions.
- Design system is `DESIGN.md` ("Market Desk"). All UI work must follow it.
- npm audit reported 9 findings (4 moderate, 5 high) after the drizzle/pg install; earlier count of 5 high was from the pre-slice-1 install. Historical record only, no broad remediation authorized.
- npm warned `eslint@9.39.5` is deprecated during install.
- AGENTS.md requires Drizzle generate + migrate for schema changes and forbids `drizzle push`. Drizzle is installed; migrations run via `npm run db:migrate` on DATABASE_URL_UNPOOLED.
- Database: Neon `neondb`, 19-table public schema applied via `drizzle/0000_lucky_mother_askani.sql` (immutable, never regenerate). `neon_auth` is Neon-managed auth, present but not integrated into the app. Stack locked: Groq via GROQ_MODEL (never Qwen), Jina embeddings jina-embeddings-v5-text-small 1024 dims, AgentKey later.
- pg 8.x treats sslmode=require as verify-full; pg 9 will weaken it. Prefer sslmode=verify-full in connection URLs.
- zod 4 runs `.refine` checks even when an earlier `.regex` issue exists; guard non-throwing checks yourself (decimal BigInt conversion needed this).
- tsconfig targets pre-ES2020: no `0n` BigInt literals or `/s` regex flags.
- node-postgres Pool is the repo Queryable seam; repositories build exact parameterized SQL, tests fake the session, no ORM query builder in repos.
- The agent.bitget.com MCP exposes only `guide` + `do_query` meta-tools; market entries are catalog ids like `equity_price_quote` / `equity_price_historical` invoked via `do_query`. Success envelope is `{success, status_code, data, error}` in structuredContent or JSON text.
- datahub.noxiaohao.com/mcp returns JSON strings in `content[0].text`; provider failures appear as `{"<provider>_error": "..."}` while `isError` stays false. Tool calls take 30-45s with SSE ping keepalives.
- On 2026-10-07 both upstreams were down during contract discovery: equity do_query returned HTTP 503 envelope, sentiment_index returned `{"alt_me_error": ""}`. Successful payload shape is still unverified.
- `@bitget-ai/bitget-signal` has no npm lifecycle scripts. Its `scripts/install.js` writes host config only when run explicitly via the `bitget-signal` bin.
- Next 16 with `cacheComponents: true` rejects `runtime`/`dynamic` route segment exports.
