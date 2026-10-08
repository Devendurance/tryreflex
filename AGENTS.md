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

## CONTEXT MANAGEMENT

- When the active agent session approaches roughly 250,000 consumed context tokens, proactively compact or summarize the working context before continuing. Do this before context degradation becomes noticeable.
- Preserve the current objective, repository truth, completed checkpoints and commit hashes, architectural and product decisions, unresolved blockers, relevant environment variable names but never secret values, important implementation invariants, tests and verification state, and the exact next action.
- Do not over-compress implementation-critical details.
- After compaction, continue from the preserved state rather than re-auditing the entire repository.

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
- LLM generation and embeddings have separate provider-neutral interfaces in `src/server/ai/`. Groq structured results use strict JSON Schema plus Zod and must not be coerced, transformed, or silently stripped. Evidence IDs are default-denied unless supplied by an owned evidence source.
- Decision origin prompt text and version live in `src/server/decision-origin-prompt.ts`. Observed input facts must be exact input quotes. Never infer impulse merely from absent research information.
- Jina document embeddings use `retrieval.passage`, queries use `retrieval.query`. Preserve source text/hash and provider metadata, check owned entity references, and dedupe before paid embedding calls.
- Groq requires an authenticated-user-scoped `ai_runs` recorder. Provider/timestamps/attempts live in `token_usage.run`, normalized counts in `token_usage.usage`. Store safe failure categories only, never prompts, credentials, raw provider bodies, or hidden reasoning.
- AI checks: `npm run test:ai` for focused tests, `npm run verify:ai` for real Groq/Jina/Neon verification. The live verifier uses temporary transaction-scoped identities/entities and always rolls back. These identities must never be used by application routes.
- Neon Auth uses the official `@neondatabase/auth` Managed Better Auth server SDK, with both `NEON_AUTH_BASE_URL` and a 32+ character `NEON_AUTH_COOKIE_SECRET`. Keep the catch-all auth proxy server-only and map the external subject to an idempotent generated Reflex user. Never accept a caller-supplied Reflex user id.
- Authenticated API handlers return 401 for an absent session and 503 for missing/unavailable auth configuration. No fake session or application user is allowed in runtime routes.
- Server-global Bitget credentials may be used only for the trusted Neon subject configured in `BITGET_ACCOUNT_AUTH_SUBJECT`. Never auto-bind a verification account or expose the private account to every authenticated user. SDK reads use readOnly true, paperTrading false, a fixed production URL and a bounded position-history page.
- Trade attachment requires the owned original confirmed snapshot. Symbol mismatches require an explicit recorded override. Imported aggregate position timestamps are not fill timestamps. Unknown fees must remain unknown even though the SQL column defaults to zero.
- Autopsy policy lives in `src/server/review-policy.ts`: exact decimal metrics, versioned weights 25/20/25/15/15 and the user-approved 70-point threshold. Policy v2 normalizes the decimal weighted score by assessed weight once coverage reaches 70%; statuses are final/provisional/unassessed and missing dimensions stay null rather than zero. Quadrant classification only for final scores with positive/negative outcomes; open/unknown/break-even stay null. Scores and weights are product assumptions.
- Process evidence excludes realized PnL and exit-price outcomes, never promotes unconfirmed AI origin explanations into observed facts, and excludes post-entry market context. Read APIs keep observed quotes separate from inferred findings. Evidence-reference validation does not guarantee all semantic conclusions.
- Groq autopsy requests use a bounded 8192-token completion budget; decision parsing retains its 2048-token default. Keep strict JSON and evidence validation fail-closed. A live review or client OAuth proof does not establish financial outcome, historical context, or production credential validity.
- Verification: `test:autopsy`, `verify:authenticated-decisions`, `verify:bitget-trades`, and `verify:autopsy`. The latter requires genuine user-provided trade input plus real managed session cookies supplied via a private external file, always rolls back application rows, and never fabricates a trade when inputs are missing.
- Manual trades may preserve unknown execution fields as SQL NULL after migration 0001. The `trades_bitget_execution_required` check retains non-null quantity, entry price, and opening time for Bitget records. Manual observations live in immutable trade-event facts, not fabricated execution columns.
- Market-cap movement is context, never realized return. Cash-flow PnL requires explicit accounting basis and currency. Gross amounts need known fees, net-including-fees totals must not subtract fees again, and unknown proceeds/basis remain unknown. Do not infer a currency from the original plan or compare target caps across different currencies.
- Parser prompt decision-parse.v2 explicitly distinguishes token unit price from capitalization, position size, invested amount and proceeds. An untimed peak does not prove an executable take-profit opportunity.
- Sparse autopsy decision-autopsy.v22 uses a canonical owned evidence ledger with timing/knowledge/source metadata. Target drift requires a USD market-cap original target plus an explicit user-reported later revision and ordering evidence, never an exit-versus-target difference alone. Market-cap metrics are valuations, not PnL. User retrospective self-assessment is preserved separately and excluded from narrative quote selectors. Snapshot origin labels are not observed process evidence; explicitly user-confirmed origin records retain their separate catalog path. The server supplies the sparse summary and factual target/valuation lesson prefix. Groq supplies a bounded, source-selected process takeaway, not deterministic numbers or peak chronology. Drift-present sparse reviews reject generic extra lessons. Role quote selectors resolve exact owned evidence for scored execution/behavior; unassessed dimensions stay empty. Grounding failures record only reason/path/UUID metadata in AI runs. Schema-defined rejected responses may be printed only by the private local verifier, never stored as provider bodies or sent in runtime errors.
- Decision DNA decision-dna.v1 groups an owner's latest eligible completed review per independent decision; older same-decision reviews are excluded, not double-counted. Origin features keep their recorded basis and model-inferred origins alone can never establish. Scored dimensions become weak (<40, leak) or strong (>=70, edge) features only from owned grounded quotes; null/unknown values are never group keys and regimes need verified decision-time context plus observed-facts regime agreement. Source influence uses only actual recorded URL identity, never a guessed person or outlet. Status is observation at 1 support, emerging at 2-3, established only at >=4 comparable supports that are also quality-qualified (coverage >=80 and relevant dimension confidence >=0.7). Pattern fingerprints are deterministic and owner-unique; pattern_evidence links are append-only and retired patterns stay inactive, excluded from the current read and search. Narratives are deterministic server policy with no Groq path; confidence is always null, never a fabricated probability. Recompute is capped at 500 eligible reviews and fails honestly above that. POST /api/patterns/recompute takes a strict empty JSON body; GET /api/dna is read-only (no LLM, no provider calls, no marker inserts) and exposes last-recompute stats or an honest not_computed state with recomputationRequired instead of invented aggregates. Known outcomes stay descriptive aggregates, never a process driver. Migration 0002 adds pattern_kind 'execution' and the owner-scoped fingerprint unique index; the original 19 tables are unchanged.
- Pre-Trade Recall pre-trade-recall.v1 POST /api/recall is owner-scoped and preserves raw proposal text only in the response, never as a durable proposal. Eligible current personal memory is filtered before top-K search; retired/stale patterns, superseded review embeddings and unaccepted/superseded rules are excluded. Sources retain similarity, lifecycle and evidence basis; cards deduplicate by underlying decision. Recall validates existing DNA statuses using the same lifecycle gate, never recomputes DNA. All historical facts, watchpoints and questions are server-authored. Groq may only prioritize supplied enum IDs with singleAttempt:true, cannot add prose or facts, and failed/invalid selection returns a labeled deterministic fallback. Empty-history calls skip paid providers; Jina retrieval failure remains honest unavailable, not empty history. Accepted rules are semantic candidates whose trigger still needs user confirmation. No proposal, pattern, rule or memory mutation occurs; only authenticated selector ai_runs may be recorded. Verification uses VERIFY_DECISION_DNA=1, VERIFY_ACCEPTED_REVIEW_FILE pointing to the frozen accepted report, and VERIFY_PRE_TRADE_RECALL=1 inside rollback; historical replay is not a new Groq autopsy.
- Bitget Classic CSV import bitget_classic_spot_order_history.v1: POST /api/imports/bitget-classic/{preview,commit}, GET list/[id], GET /api/activities/[id] + POST /api/activities/[id]/purpose, GET /api/activities. Four append-only tables (spot_csv_imports/spot_activities/spot_executions/spot_activity_events, migration 0003) preserve raw reported rows, never trade/decision/PnL linkage. Commit needs confirmed=true, exact previewHash, all orders classified exactly once (speculative_trade/payment_conversion/other_nontrading/unknown), parser must be importEligible. Same-hash reimport returns existing rows with 0 inserts and ignores new purposes; purpose changes only via the versioned purpose endpoint (same-purpose retry is a no-op before version check, stale different-purpose is 409). Overlaps require occurrence-aware nested signature multisets; non-nested evidence or changed order identity is CONFLICT. Reads re-validate stored snapshots via validateClassicOrderSnapshot, pick the complete snapshot matching the full stored execution-key union, compare stored exec columns by decimalUnits and raw records by parseClassicExecutionRecord (formatting differences preserved, not normalized away). Metrics come only from summarizeClassicOrders; no cost basis/PnL is ever inferred. Missing snapshots/purpose audit fail closed with INVALID_INPUT.
- Self-Evolving Playbook playbook.v1 is deterministic-only, no LLM path. GET /api/playbook, POST /api/playbook/propose (strict {}), POST /api/playbook/[id]/decision ({action: accept|reject|defer}). Proposals come only from recomputed authoritative DNA candidates matching the two templates (execution/target_drift -> target_revision, leak/research_quality -> research_check); stored pattern fields are validated, never copied. Frozen provenance lives in a kind='playbook_rule' evidence marker; validateFrozenRule is the shared seam for GET/propose/decide/Recall and requires explicit kind, exact template content, deterministic rationale, equal linked refs, and the lifecycle/scope/strength/metrics invariants. equivalentKey = sha256(policyVersion|templateId|fingerprint) excludes count/maturity so grown evidence never silently re-proposes. Versions are append-only chains with strictly increasing version numbers; v1 chains forbid legacy mixing, require identical provenance/content across versions, and active/rejected are terminal. Only accept embeds via lazy Jina under the provider limiter with canonical provenance source_text; reject/defer never touch providers. effectiveness stays unproven, financialBenefit unknown, confidence null; rules never auto-activate or trade. Verified live by replay (VERIFY_PLAYBOOK=1, frozen log-playbook-runner-historical-replay.txt), not a fresh autopsy.
- AgentKey uses the fixed official MCP URL with a server-side master key, actual tool discovery, and describe_tool before execute_tool. Business calls require a server-authored verified public-context read plan. No plan is configured until a real capability is discovered and verified. Never guess canonical provider operations or claim a live integration from tests.
- Decision context retains primary Bitget failures and separate AgentKey fallback/enrichment provenance. Non-equivalent secondary context can only make a failed primary partial. Only real owned evidence rows are EvidenceRefs; stateless service correlation IDs and original vendor IDs remain provenance. Missing/unauthorized providers must not create a snapshot.
- Safe Bitget diagnostics check the minimal read-only account operation before history and retain HTTP status separately from the provider code. Code 40099 reports an exchange-environment mismatch, not proof of classic-account or UTA incompatibility. Never switch to demo mode, rebind the application owner, or create an Agent sub-account just to clear verification.
- Bitget Agentic onboarding uses the official agentic skill in `.devin/skills/bitget-agentic` with the stdio `@bitget-ai/bitget-agent-mcp` server. The SDK reads `BITGET_API_KEY`/`BITGET_SECRET_KEY`/`BITGET_PASSPHRASE` env vars before OAuth disk credentials, so the configured launch clears those names inside the spawned child process only; never edit saved user variables or Reflex env to work around it. OAuth credentials stay client-local on disk and are never auto-bound into the Reflex app. First-time registration must stop before OAuth and resume in a new session. The agent never performs transfers or orders outside an explicit confirmed user request.

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
- Landing components live in `src/components/landing/`. Shared tokens are Tailwind 4 `@theme` colors plus `.t-display/.t-h2/.t-lead/.t-eyebrow/.t-caption/.t-data` in `globals.css`. Fonts: Newsreader + Georama via `next/font/google`, Satoshi self-hosted from `src/app/fonts/` via `next/font/local`.
- The hero Reflex Engine is hand-built isometric SVG (`reflex-engine.tsx`, projection helper `p(x,y,z)`). Animate only via CSS classes with compositor-friendly transforms/opacity; never put a CSS-animated class on an element that also has an SVG `transform` attribute. Keep `.eng-flow` hidden and all `.eng-anim` stopped under reduced motion, and keep the visible pause control.
- Conceptual illustrations and example cards must be labeled as not user data. No fake stats, testimonials, user counts or performance claims on marketing pages.
- Primary CTAs route to `/access`, an honest transition page, until the real Neon Auth sign-in UI and workspace exist. Never fake a session or a signed-in state.
- Visual QA uses the `mcp-playwright` server. It can only write inside the repo, so save screenshots under `.playwright-mcp/` (gitignored) and move them to `C:/Users/USER/bitget-mcp-discovery/landing-screens/` afterwards.
- The mobile menu is a full-screen overlay portaled to `<body>`, because the header's `backdrop-filter` becomes the containing block for any fixed child. Keep it out of normal flow, keep the scroll lock, inert siblings, focus trap and focus return, and clean them all up on close and unmount.
- `.playwright-mcp/` is gitignored, so agent file tools can't read screenshots there. Move them to the external folder before viewing.
- Auth UI uses the `@neondatabase/auth/next` client in `src/components/auth/auth-client.ts` with custom on-brand forms, not the prebuilt auth-ui CSS. The client throws `AuthApiError` ({status, code}) instead of returning `{ error }`, so map both through `authErrorMessage`. `/app/*` is protected by `src/proxy.ts` (Next 16 proxy, Neon middleware) and the client shell also redirects when the session is null. Never create Neon Auth test accounts without the user's approval.
- Decision Desk UI (`src/components/decisions/`) sends the exact `decisionSnapshotSchema` contract: omit empty optionals, never prefill snapshot `confidence` from the parser's extraction confidence, never pre-tick inferred origins, keep market-cap targets in `intendedTakeProfitMarketCap` with an explicit currency, and show raw input verbatim. Dynamic `/app/.../[id]` pages are client components using `useParams` to stay compatible with `cacheComponents`.
- Running `next build` replaces `.next` under the repo-owned `next start -p 3002` server, so restart that server after a build.
- Initial decision confirmation writes each distinct snapshot origin to `decision_origins` with basis `user_confirmed`, NULL confidence and the fixed explanation `USER_CONFIRMED_ORIGIN_EXPLANATION`, inside the confirm transaction. Idempotent repeats, corrections and revisions never add or rewrite origins, and parser `inference` rows are never converted. DNA uses only a decision's user-confirmed origins when any exist; legacy inference-only decisions keep inference basis. Never backfill confirmed origins for decisions confirmed before this rule.
- Review discovery uses owner-scoped reads in the reviews repository: GET /api/reviews (limit 1..50, cursor, summaries only, never observed_metrics) and GET /api/decisions/[id]/trades (foreign decision is 404). Manual trades have no dedupe key, so the UI must block double submits. Autopsy generation is user-triggered only with a capped manual retry, never an automatic loop or a deterministic fallback review. Payment-conversion CSV orders are never attached as trades.
