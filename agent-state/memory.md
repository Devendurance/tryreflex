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
- Groq gpt-oss-120b supports strict JSON Schema. Zod validates again and isDeepStrictEqual rejects coercion, default injection, or unknown-key stripping. Evidence refs default-deny without server-owned allowed IDs.
- Jina v5 API uses task retrieval.passage for documents and retrieval.query for queries, dimensions 1024, float embeddings. Do not manually prefix API inputs. Dedupe by owned entity/model/dimensions/source hash before paid calls.
- AI run metadata uses existing token_usage JSON: run contains provider/start/end/attempts, usage contains normalized counts. Raw prompts, provider bodies, keys and hidden reasoning are never persisted.
- verify:ai uses only rollback-scoped test identities/entities. Actual Jina vectors verified social-call-first Neon ranking and owner filtering. Temporary rows were zero after rollback.
- Git Bash artifact paths must use /c/Users/USER/... or quoted Windows paths. Unquoted backslashes caused root filenames C:UsersUSER... during this slice, repaired by moving the generated artifacts to the correct external folder.
- Current Neon Auth is Managed Better Auth through `@neondatabase/auth`, not Stack Auth. Server config requires `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` with at least 32 characters. `auth.getSession()` returns `data.user` or null.
- Reflex maps Neon external subjects through `public.users(auth_provider='neon-auth', auth_subject=...)`; the generated Reflex UUID is the only repository ownership id. Never accept a caller user id.
- The auth proxy returns `200 null` without a cookie and protected endpoints401. Two REAL managed test sessions now passed decision parse/confirm/read with actual Groq and Neon rollback. Three managed test accounts remain, no direct managed auth-table edits.
- Decision confirmation preserves `confirmed_snapshot`; exact repeats are idempotent and changed confirmations append `decision_revisions`. Context snapshots are written transactionally with market-data evidence only when normalized provider components are available.
- Bitget Agent SDK3.3.1 is ESM-only: use dynamic import under this tsx/CJS project. It adds one zero-runtime-dependency package. readOnlytrue/history-only does not establish that API-key permissions themselves are read-only.
- Bind global private credentials to BITGET_ACCOUNT_AUTH_SUBJECT before user-facing import. Unset->503, different subject->403. No auto-binding.
- Jina/Groq infrastructure retained. Review policy decision-quality.v1:weights25/20/25/15/15, threshold70 approved assumption, incomplete evidence->nulloverall, open/unknown/break-even->nullquadrant. Metric money uses BigInt fixed decimals, supplied net authoritative, unknown fees never assumed0.
- pg returns Date objects: pass Date|string directly to metric calculations and format timestamps with toISOString to preserve milliseconds. Imported position created/updated times are aggregate provenance, not exact fills.
- Public market reprobe all unavailable; private read failed BitgetApiError/code400. Not evidence of empty history. Real autopsy blocked without genuine trade, verifier never manufactures one.
- Fresh production server3002 remains running, reuse it. log-autopsy-*.txt and log-authenticated-decisions-live.txt contain safe evidence outside repo.
