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
- npm audit reports 5 high severity vulnerabilities after install. Not yet investigated or fixed.
- npm warned `eslint@9.39.5` is deprecated during install.
- AGENTS.md requires Drizzle generate + migrate for schema changes and forbids `drizzle push`, but Drizzle is not installed yet.
