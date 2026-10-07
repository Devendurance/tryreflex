# CRITICAL RULES - MUST FOLLOW

- Auto-log meaningful rules to the project’s AGENTS.md.
- Auto-commit and push after every meaningful checkpoint.
- Auto-clean temporary files and build clutter.
- Keep the repository in a recoverable state.

## WRITING

- Never use em dashes. Use commas, periods, hyphens, or rewrite the sentence.
- Do not use the “It’s not X, it’s Y” correction pattern. State the correct point directly.
- Avoid choppy writing. Keep the flow natural.
- Avoid semicolons in casual replies. Use periods or normal conjunctions.
- Remove stock transitions like “however,” “furthermore,” “it’s worth noting,” and “in conclusion.”
- Use contractions in casual contexts. Say “don’t” instead of “do not.”
- Use simple words. Say “use” instead of “utilize,” “start” instead of “commence,” and “find out” instead of “ascertain.”
- Avoid mid-sentence ellipses unless you’re writing deliberate dialogue.
- Avoid parenthetical asides when the idea can fit naturally into the sentence.
- Use colons sparingly. Don’t label every paragraph or list.
- Remove chatbot filler like “Great question,” “I hope this helps,” “Let me know if,” “Here is a,” and “Let’s dive in.”
- Do not use emojis unless the user clearly wants that style. (This is specific to me, you can leave it if you like to use emojis tho)
- Do not use bold text for emphasis in normal prose.
- Challenge weak reasoning. Flag unsupported claims. Do not agree just to be polite.

## RESPONSES

- Keep responses concise and to the point unless the user asks otherwise.

## AGENT STATE

- Long-running project state lives in `agent-state/`:
  - `project-state.md` tracks what's been built, the architecture, and important decisions.
  - `memory.md` tracks durable facts, conventions, and gotchas.
  - `left-off.md` tracks the current task, what's done, what's next, and known issues.
- At the start of every session, read all three files before doing anything else.
- Update them at every meaningful checkpoint: feature finished, decision made, bug found, direction changed.
- Keep them short. Bullets, not essays. `left-off.md` must always answer: what are we doing, what's done, what's next.
- When the session gets compacted or messy, a new session resumes from these files.

## PLANNING MODE

- Always ask clarifying questions.
- Never assume the design, tech stack, or features.
- Use deep-dive sub-agents to assist with research.
- For research work or research assist sub-agents, use SWE-2 model with a high reasoning/thinking effort
- Use deep-dive sub-agents to review the different aspects of your plan before presenting it to the user.

## CHANGE / EDIT MODE

- Never implement features yourself when possible; use sub-agents.
- Identify changes from the plan that can be implemented in parallel, and use sub-agents to implement the features efficiently.
- When using sub-agents to implement features, act as a coordinator only.
- After completing features, whether large or small, always run commands such as lint, type check, and next build to check code quality.

## BACKEND

- The market-context slice sources data only from two allowlisted public MCP servers: `https://agent.bitget.com/mcp` for US-stock quotes/history via `do_query` catalog entries, `https://datahub.noxiaohao.com/mcp` for crypto sentiment via direct tools. User input must never select arbitrary tool endpoints or URLs. Future slices may add their own integrations deliberately.
- Use `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`. No manual SSE parsing. One bounded session per operation, closed in `finally`.
- Server-only code lives in `src/server/`. Domain logic in `src/server/market/`, MCP adapters in `src/server/integrations/bitget/`. Never import `src/server/` from client components.
- No mock data and no synthetic market values. If a provider fails, return an honest unavailable status with a fixed safe message. Never pass `fetchedAt` off as `observedAt`, never invent currency or timestamps.
- Never run the `bitget-signal` host installer (`scripts/install.js`). It writes to `~/.claude`, `~/.codex`, `~/.openclaw`. Plain `npm install` is safe because the package ships no lifecycle scripts.
- Validate all external input with zod at the boundary. Reject unknown keys.

## DATABASE SCHEMA CHANGES

- Persistence runs on Neon Postgres via Drizzle ORM. Pooled `DATABASE_URL` serves the app, direct `DATABASE_URL_UNPOOLED` serves migrations, never fall back between them.
- Whenever you make changes to the database schema, ALWAYS run `db:generate` then `db:migrate`.
- NEVER run drizzle push.
- Owned rows are scoped by `user_id` with composite `(user_id, id)` references. Repositories always filter on the authenticated context user; user-supplied ids never carry ownership.
- Append-only tables (revisions, origins, sources, market snapshots, trade events, playbook rules, evidence, links) are protected by database triggers. Do not add update or delete paths for them.
- Reasoning provider is Groq; the model comes from `GROQ_MODEL` (currently `openai/gpt-oss-120b`), never Qwen, and is never hardcoded in business logic. Embeddings are locked to `jina-embeddings-v5-text-small` at 1024 dimensions. Runtime config must reject mismatched values rather than coerce.
- Never store API keys or secrets in `provider_connections.config` or `ai_runs`.

## TESTING

- Use any testing tools and libraries available to the project to test your changes.
- Never assume your changes work; always test.
- If the project does not have any testing tools, scripts, MCP tools, or similar resources available for testing, ask the user whether testing should be skipped.

## UI DESIGN

- Always follow or reference the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
