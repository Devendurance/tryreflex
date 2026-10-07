# Project State

Last updated: 2026-10-07

## What this is

- **Reflex**: a self-evolving trading decision intelligence desk for crypto and 24/7 tokenized US equities.
- Built for the Bitget AI Base Camp Hackathon S2, AI Trading Desk track, Review & Self-Evolution sub-theme.
- Core loop: Decide → Trade → Understand → Learn → Evolve → Recall → Decide better.
- Core thesis: separate decision quality from financial outcome, since P&L is a poor teacher.
- Scaffold done, no application code written beyond the create-next-app template.

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

- `src/app/` holds the App Router entry points. Template files untouched.
- No backend, database, or API routes yet.
- AGENTS.md expects Drizzle if a database is added (generate + migrate, never push).

## Decisions made

- Scaffolded with create-next-app defaults plus `--src-dir` and `--turbopack`.
- Product direction locked to Reflex per docs/.
