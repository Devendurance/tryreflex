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
- Database: Neon `neondb`, 19-table public schema applied via original `drizzle/0000_lucky_mother_askani.sql` (immutable, never regenerate), then sparse-manual migration0001. Managed neon_auth integrates through the official SDK, never direct managed-table writes. Stack locked: Groq via GROQ_MODEL (never Qwen), Jina embeddings jina-embeddings-v5-text-small1024. AgentKey boundary exists, live business capability unverified.
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
- More precise private diagnosis now HTTP400/provider40099, exchange environment is incorrect on GET/v3/account/settings with no params. Authentication/account-mode requirements unproven; do not infer classic/UTA/Agent account or switch demo. Public once-only reprobe still unavailable.
- Sparse manual evidence supports null quantity/price/time with manual observations in immutable events. Migration0001 retains a conditional Bitget non-null execution check; no original migration rewrite.
- Financial semantics: gross cash flows need known fees, net-including-fees totals must not subtract fees twice, unknown proceeds/basis stays unknown. Market-cap ratio is not realized trading return. Never infer an observation currency from a plan; compare only matching declared currencies.
- Prompts decision-parse.v2 and decision-autopsy.v2 separate unit prices from cash/capitalization and retrospective comments from original knowledge. An untimed peak does not prove that a target was executable while held.
- AgentKey official MCP key rejected401. Connector/explicit fallback provenance boundary is built, but no real tools/catalog/business read plan verified. No guessed operations or invented live data. Gateway requires discovery, immediate describe_tool and execute_tool, scoped server-owned read plan and runtime schema checks.
- Application private owner binding currently points to actual managed sessionB0a20...; A7ca... is excluded. Never confuse public.users identity mapping with BITGET_ACCOUNT_AUTH_SUBJECT or with proven Bitget-account ownership.
- Fresh production server3002 PID21012/shellee47c5 is running, reuse. log-sparse-*.txt/log-binding-final.txt and agentkey-discovery-status.json are current safe artifacts outside repo. Actual trade values/rationale still missing; type alone isn't genuine verification data.
- Devin MCP uses .devin/mcp_config.json with HTTP URL and OAuth-first/no headers. AgentKey client read proof succeeded; AGENTKEY_API_KEY is a Reflex convention, not mandated by skill1.14.0. Client auth does not prove backend integration.
- Bitget Agentic onboarding: .devin/skills/bitget-agentic is the official agentic SKILL.md copied verbatim from npm @bitget-ai/bitget-agent-skill3.3.1 (agentic subtree ships SKILL.md only, no references). Trading MCP is global @bitget-ai/bitget-agent-mcp@3.3.1. SDK loadConfig (node_modules/@bitget-ai/bitget-agent-sdk/lib/index.js ~line3358) reads BITGET_API_KEY/SECRET_KEY/PASSPHRASE env first, throws on partial auth, and only falls back to OAuth disk credentials when no env triple exists. A BITGET_API_KEY env var name is inherited in this shell (value unread), so the mcp_config launch wraps npx in cmd /d /s /c with set-empty builtins for all three BITGET_* names, clearing them in the child process only. Saved user variables and Reflex env are untouched. Public HTTP bitget-mcp-server https://agent.bitget.com/mcp also registered. OAuth credentials stay client-local on disk, never auto-bound into Reflex. First-time registration must stop before OAuth and resume in a new session; authorizeBaseUrl is https://www.bitget.careers.
- Bitget Agentic OAuth authorized 2026-10-07T22:18:50.505Z; credentials file C:\Users\USER\.bitget\oauth_token.json stays client-local and is never bound into Reflex env. get_auth_status authorized:true reports local credential presence only, not independent exchange-side validity. Machine has no proxy env, no Windows system proxy, no local proxy listeners.
