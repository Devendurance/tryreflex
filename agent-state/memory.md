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
- npm audit reported 5 high severity findings after the initial scaffold install (pre-slice-1). Not re-audited since the MCP deps were added; the count may be stale.
- npm warned `eslint@9.39.5` is deprecated during install.
- AGENTS.md requires Drizzle generate + migrate for schema changes and forbids `drizzle push`, but Drizzle is not installed yet.
- The agent.bitget.com MCP exposes only `guide` + `do_query` meta-tools; market entries are catalog ids like `equity_price_quote` / `equity_price_historical` invoked via `do_query`. Success envelope is `{success, status_code, data, error}` in structuredContent or JSON text.
- datahub.noxiaohao.com/mcp returns JSON strings in `content[0].text`; provider failures appear as `{"<provider>_error": "..."}` while `isError` stays false. Tool calls take 30-45s with SSE ping keepalives.
- On 2026-10-07 both upstreams were down during contract discovery: equity do_query returned HTTP 503 envelope, sentiment_index returned `{"alt_me_error": ""}`. Successful payload shape is still unverified.
- `@bitget-ai/bitget-signal` has no npm lifecycle scripts. Its `scripts/install.js` writes host config only when run explicitly via the `bitget-signal` bin.
- Next 16 with `cacheComponents: true` rejects `runtime`/`dynamic` route segment exports.
