# Reflex — evidence-backed trading decision intelligence

Reflex is a self-evolving trading decision desk for crypto and 24/7 tokenized
US equities. Its thesis: separate decision quality from financial outcome,
because P&L alone is a poor teacher.

Core loop: Capture → Confirm → Review → Find the pattern → Carry the lesson.
Decide, trade, understand, learn, evolve, recall, decide better.

## What it does

- Decision Desk: capture a thesis, inspect the parser's exact-quote
  extraction, then confirm an immutable snapshot.
- Trade evidence: attach manual trades or import Bitget Classic spot history
  from CSV with per-order purpose declarations. Unknowns stay unknown.
- Autopsy: a grounded reviewer scores five process dimensions against
  owned evidence only. Ungrounded claims fail closed, nothing is invented.
- Decision DNA: deterministic observation/emerging/established findings
  recomputed from accepted reviews. One review can only ever be an
  observation, never a habit.
- Playbook: deterministic rule proposals from DNA findings. Rules start
  Experimental, stay unproven, and never auto-activate or trade.
- Pre-Trade Recall: semantic retrieval over owned history with
  server-authored watchpoints. Proposals are never saved.

Market context comes only from two allowlisted public MCP servers
(Bitget equities quotes/history, crypto sentiment). If a provider fails,
the API reports unavailable instead of inventing data.

## Stack

Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind CSS 4,
Drizzle ORM on Neon Postgres, Groq structured reasoning, Jina embeddings,
Neon Auth sessions. Package manager: npm.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in values (names only listed
here; values stay out of the repo):

- `DATABASE_URL` (pooled Neon endpoint), `DATABASE_URL_UNPOOLED` (direct)
- `GROQ_API_KEY`, `GROQ_MODEL`
- `JINA_API_KEY`, `JINA_EMBEDDING_MODEL`, `JINA_EMBEDDING_DIMENSIONS`
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32+ characters)
- `BITGET_ACCOUNT_AUTH_SUBJECT` (binds server-held credentials, optional)
- `AGENTKEY_API_KEY`, `BITGET_API_KEY`, `BITGET_SECRET_KEY`,
  `BITGET_PASSPHRASE`, `MCP_TIMEOUT_MS` (optional integrations/diagnostics)

Database migrations (generate then migrate; never push):

```bash
npm run db:generate
npm run db:migrate
npm run db:verify
```

Run locally:

```bash
npm run dev
npx next start -p 3002   # production server; restart it after every build
```

## Verification

```bash
npm run test:all
npm run type-check
npm run lint
npm run build
```

Live provider checks (require real credentials, roll back all rows):

```bash
npm run verify:ai
npm run verify:authenticated-decisions
npm run verify:bitget-trades
npm run verify:autopsy
```

## Demo path

Landing (`/`) → sign in → Overview (`/app`) → Decision Desk
(`/app/decisions`) → Trade Activity (`/app/activity`) → Autopsies
(`/app/autopsies`) → DNA (`/app/dna`) → Playbook (`/app/playbook`) →
Pre-Trade Recall (`/app/recall`).

## Privacy and evidence integrity

- Rows are owner-scoped; cross-owner reads return 404.
- Append-only evidence tables are trigger-protected.
- Prompts, credentials, raw provider bodies and hidden reasoning are never
  persisted. AI bookkeeping stores safe failure categories only.
- No mock market data: unavailable providers produce honest errors.

## Known limitations

- Autopsy generation can reject ungrounded output and ask for a retry.
- Playbook accept/reject memory flows and two-account live isolation are
  covered by automated tests but not yet live-verified end to end.
- No autonomous order execution exists anywhere in the product.
