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
- Persistence: drizzle-orm 0.45.3, pg 8.23.0, drizzle-kit 0.31.11, @types/pg 8.23.1. Neon `neondb` now has the 19-table public schema; managed `neon_auth` schema left untouched (not integrated as app auth).
- `src/server/db/`: schema modules (19 tables: users + 18 owned, composite (user_id,id) FKs, append-only triggers), config (lazy env, Neon/TLS + locked embedding validation), client (pooled session), repositories, validation. `src/server/auth/context.ts`: AuthProvider/requireAuth seam, no provider configured yet.
- Locked stack: Groq openai/gpt-oss-120b for reasoning (never Qwen), Jina jina-embeddings-v5-text-small @ 1024 dims, AgentKey later.
- Migration `drizzle/0000_lucky_mother_askani.sql` APPLIED to Neon (2026-10-07): CREATE EXTENSION vector, all checks/FKs, HNSW index, immutability + append-only + user-identity triggers. Verified by `tests/db/live.integration.ts` (`npm run db:verify`) inside full ROLLBACK. Never regenerate or alter 0000.
- Tests: node:test via tsx under `tests/market/` (`npm test`), `tests/db/` (`npm run test:persistence`), `npm run test:all` (111 total). Live probes: `npm run verify:market`, `npm run db:verify`.

## Decisions made

- Scaffolded with create-next-app defaults plus `--src-dir` and `--turbopack`.
- Product direction locked to Reflex per docs/.
