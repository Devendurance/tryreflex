# Project State

Last updated: 2026-10-07

## What this is

- **Reflex**: a self-evolving trading decision intelligence desk for crypto and 24/7 tokenized US equities.
- Built for the Bitget AI Base Camp Hackathon S2, AI Trading Desk track, Review & Self-Evolution sub-theme.
- Core loop: Decide → Trade → Understand → Learn → Evolve → Recall → Decide better.
- Core thesis: separate decision quality from financial outcome, since P&L is a poor teacher.
- First backend slice shipped: public market-context API. Frontend still template.

## Stack

- Next.js 16.4.0, React 19.3, TypeScript 5
- Tailwind CSS 4, ESLint 9
- App Router, `src/` directory, import alias `@/*`, Turbopack
- Package manager: npm
- Git repo initialized locally, no remote configured

## Dependencies added beyond the scaffold

- `gsap` + `@gsap/react` (animation)
- `lenis` (smooth scrolling)
- `lucide-react` (icons)

## Key documents

- `docs/PRD.md`: product requirements, scope, acceptance criteria.
- `docs/TRD.md`: technical requirements.
- `docs/project plan.md`: positioning and build plan.
- `docs/messaging,language and copy.md`: voice and copy rules.
- `DESIGN.md`: "Market Desk" design system. Warm paper ground, ink-brown type, one orange accent, isometric line-art, serif headlines + Satoshi + Georama. Referenced by AGENTS.md for all UI work.

## Architecture

- `src/app/` holds the App Router entry points plus `api/market/context` (POST, dynamic).
- Server domain code in `src/server/market/` (schemas, service, normalize, concurrency, context-handler). MCP adapters in `src/server/integrations/bitget/` (mcp.ts, stock.ts, signal.ts, errors.ts).
- Two public MCP servers: agent.bitget.com/mcp (equities via `do_query` catalog), datahub.noxiaohao.com/mcp (crypto sentiment direct tools). Sessions bounded by MCP_TIMEOUT_MS (default 60000).
- Deps added: @bitget-ai/bitget-signal 1.2.0 (skills bundle, installer never run), @modelcontextprotocol/sdk 1.31.0, zod 4.6.5, tsx 4.23.15 (dev). All pinned exact.
- Persistence: drizzle-orm 0.45.3, pg 8.23.0, drizzle-kit 0.31.11, @types/pg 8.23.1. Neon `neondb` has the 19-table public schema. Managed neon_auth sessions resolve through the official SDK, without direct managed-table edits.
- `src/server/db/`: schema modules (19 tables: users + 18 owned, composite (user_id,id) FKs, append-only triggers), config (lazy env, Neon/TLS + locked embedding validation), client (pooled session), repositories, validation. `src/server/auth/`: AuthProvider seam plus official `@neondatabase/auth` Managed Better Auth adapter. External Neon subjects map idempotently to generated Reflex users.
- Locked stack: Groq openai/gpt-oss-120b for reasoning (never Qwen), Jina jina-embeddings-v5-text-small @ 1024 dims, AgentKey later.
- Migration `drizzle/0000_lucky_mother_askani.sql` APPLIED to Neon (2026-10-07): CREATE EXTENSION vector, all checks/FKs, HNSW index, immutability + append-only + user-identity triggers. Verified by `tests/db/live.integration.ts` (`npm run db:verify`) inside full ROLLBACK. Never regenerate or alter 0000.
- AI foundation in `src/server/ai/`: separate LLMProvider/EmbeddingProvider, Groq strict JSON Schema + Zod with grounding/no coercion, Jina retrieval.passage/query with locked 1024-vector validation, canonical memory text and deduped owner-scoped storage/search. Prompt is `src/server/decision-origin-prompt.ts`, version decision-origin.v1. No provider SDK/dependency additions.
- Real AI verifier `scripts/verify-ai.ts` passed: Groq openai/gpt-oss-120b classified borrowed_conviction + social_confirmation with exact quotes, Jina v5 produced 3 document/1 query vectors of 1024 dimensions, Neon ranked social-call memory first and enforced ownership/dedupe. All temporary users/decisions/embeddings/ai_runs rolled back and zero remaining rows verified. Artifact `C:/Users/USER/bitget-mcp-discovery/log-ai-live.txt`.
- Groq records user-scoped ai_runs with model/prompt version/status/latency, safe errors and token usage. Provider/start/end/attempts are in token_usage.run. No request/output/hidden reasoning persisted.
- Tests: node:test via tsx under tests/market, tests/db, tests/ai, tests/decisions. Checkpoint suites passed 48 market + 65 persistence + 55 AI, and the final decision/auth suite passed 11. Type-check, lint, and build passed. Scripts test:ai, test:decisions, verify:ai, and test:all include the current boundaries.
- Decision slice added: `/api/auth/[...path]`, `/api/decisions/parse`, `/api/decisions/[id]`, `/confirm`, and `/context`. Routes are owner-scoped and fail closed. Parse persists exact raw input, inference, origins, source/evidence rows, and AI metadata. Confirmed snapshots are immutable, exact repeats are idempotent, corrections append revisions. Context persists only available market facts and evidence.
- Real auth/decision proof now passed: two managed signup/session accounts, real Groq parse returned borrowed_conviction + social_confirmation, confirmed/read with owner200 and foreign404, idempotency and raw-input immutability, transaction rollback left zero verification decision/AI rows. Evidence log-authenticated-decisions-live.txt. Three managed test accounts remain including an extra initial failed-run account; no direct auth-table edits.
- Trade/autopsy checkpoint: SDK @bitget-ai/bitget-agent-sdk3.3.1 exact, readOnly position-history adapter, owned manual/selected import routes, symbol-override audit and import dedupe. New src/server/trades and reviews plus shared authenticated HTTP helper. No schema/migration or existing provider rewrite.
- Autopsy uses original confirmed snapshot, verified owned refs/exact observations and server decimal metrics. review-policy.ts owns weights25/20/25/15/15 and approved threshold70. No overall score if any dimension lacks evidence, no quadrant for unknown/open/break-even. Successful review saves atomically with dimensions/links and version history. New POST /api/trades/manual, /api/trades/import, /api/reviews/generate, GET /api/reviews/:id.
- Sparse input/context checkpoint: migration0001_supreme_squadron_supreme applied to real Neon, quantity/entry/opening time nullable only for manual evidence while trades_bitget_execution_required protects Bitget. Manual cash/cap observations stay in immutable event JSON; unknowns preserved. Market-cap multiples never realized return, cash-flow PnL requires explicit basis/currency. Parser decision-parse.v2 and sparse autopsy decision-autopsy.v2 preserve valuation vs execution and original vs retrospective knowledge.
- AgentKey fixed MCP client/discovery/gateway and context primary/secondary provenance boundary built/tested, not a verified live data integration. Configured key initialization401, no catalog or verified business read plan. Existing Bitget providers/public endpoint retained. Real snapshot creation still fails honestly if no provider supplies valid facts.
- More precise Bitget diagnosis: getAccountInfo GET /api/v3/account/settings {} returned HTTP400/provider40099 exchange environment is incorrect; history not retried afterward. Auth/account type/UTA remain unproven, no automatic demo/agent-account change. Public quote/history/sentiment once-only reprobe all unavailable.
- Current app binding is external subjectB0a20e1f0-ee85-4f8a-8963-edd3d5eb32da, mappedReflex2a2cac1d-b014-40a3-b278-0399588511db; A is forbidden403, B passes binding then invalid body400 without SDK requests. Both existing managed sessions refreshed via real signin; no new test accounts. Application binding is not proof of private credential ownership.
- Full checkpoint274 tests passed; final affected sparse36 and decision routes8 passed, latest typecheck/lint/build green. Lead real-Neon sparse constraint fixture test rolled back0users/decisions/trades. No actual token/trade values/rationale supplied, so no genuine origin/review/quality/quadrant claimed. Fresh server3002 PID21012. Finish genuine live proof before DNA/playbook.
- AgentKey skill1.14.0 installed in .devin/skills/agentkey. Devin project MCP .devin/mcp_config.json uses HTTP https://api.agentkey.app/v1/mcp with no key header. OAuth flow initiated; native Devin tools subsequently callable. Real agentkey_account returned10credits; CoinMarketCap/getCryptocurrencyQuotesLatestV3 {symbol:BTC,convert:USD} returned Bitcoin id1/slugbitcoin and USD quote (provider timestamp2026-10-07T21:51:05Z), charged0.6credits, provider error_code0. No API-key fallback or Reflex backend changes. This proves agent-client access only, not the existing Reflex backend integration; prior backend401 remains historical/unretested.

## Decisions made

- Scaffolded with create-next-app defaults plus `--src-dir` and `--turbopack`.
- Product direction locked to Reflex per docs/.
