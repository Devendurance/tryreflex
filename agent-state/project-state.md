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
- Tests: node:test via tsx under `tests/market/`, run with `npm run test`. Live probe: `npm run verify:market`.
- No database, auth, or API routes beyond market context yet.
- AGENTS.md expects Drizzle if a database is added (generate + migrate, never push).

## Decisions made

- Scaffolded with create-next-app defaults plus `--src-dir` and `--turbopack`.
- Product direction locked to Reflex per docs/.
