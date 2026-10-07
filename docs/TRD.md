# Reflex — Technical Requirements Document (TRD)

## 1. Purpose

This TRD defines the technical requirements for the Reflex hackathon MVP.

The system must support an end-to-end **decision → trade → review → memory → playbook → future recall** loop while remaining small enough for a solo builder to ship quickly.

---

## 2. Proposed Stack

### Frontend

- Next.js 16+
- React 19+
- TypeScript strict mode
- Tailwind CSS v4
- App Router
- Server Components where useful
- Client Components only for interactive flows/charts

### Backend

- Next.js Route Handlers / Server Actions for MVP
- Domain services separated from HTTP handlers
- Zod schemas for all boundary validation

### Database

- PostgreSQL
- pgvector extension
- Recommended managed provider: Neon or Supabase Postgres

### AI

Primary:
- Qwen 3.8 Max when hackathon credits/configuration are available

Architecture requirement:
- model-provider abstraction so the product is not hardcoded to one LLM

### External integrations

- Bitget MCP Server
- bitget-signal
- Bitget Agent Hub read-only, if account connection is completed

Optional:
- Chainbase AgentKey
- Hedera Consensus Service
- Walrus Memory
- The Graph

---

## 3. Architectural Principles

1. **Domain logic must not depend directly on UI components.**
2. **External market providers must sit behind adapters.**
3. **AI outputs are untrusted input until schema-validated.**
4. **User-confirmed decision data is canonical.**
5. **Observed facts and inferred conclusions are stored separately.**
6. **Historical records are append/version oriented.**
7. **All high-impact review claims require evidence references.**
8. **Demo mode must work when an external integration fails.**
9. **No real-money trading writes are required.**
10. **Keep the MVP monolithic but modular.**

---

## 4. Core Domain Entities

### User

```ts
type User = {
  id: string
  createdAt: string
  displayName?: string
  baseCurrency: string
}
```

### Decision

```ts
type Decision = {
  id: string
  userId: string
  assetSymbol: string
  assetClass: "crypto" | "rtoken" | "stock" | "other"
  side: "long" | "short" | "watch"
  rawInput: string
  thesis?: string
  catalyst?: string
  confidence?: number
  intendedEntry?: number
  invalidation?: string
  intendedRiskPct?: number
  timeframe?: string
  status: "draft" | "confirmed" | "closed"
  confirmedAt?: string
  createdAt: string
}
```

### DecisionOrigin

```ts
type DecisionOrigin = {
  id: string
  decisionId: string
  labels: Array<
    "original_research" |
    "borrowed_conviction" |
    "social_confirmation" |
    "pure_impulse"
  >
  explanation: string
  confidence: number
  userConfirmed: boolean
}
```

### DecisionSource

```ts
type DecisionSource = {
  id: string
  decisionId: string
  sourceType:
    | "news"
    | "x"
    | "telegram"
    | "discord"
    | "analyst"
    | "friend"
    | "research"
    | "other"
  label: string
  url?: string
  capturedAt?: string
  note?: string
}
```

### MarketContextSnapshot

```ts
type MarketContextSnapshot = {
  id: string
  decisionId: string
  capturedAt: string
  quote?: number
  nativeMarketState?: "open" | "closed" | "unknown"
  nativeReferencePrice?: number
  moveSinceNativeClosePct?: number
  volatilityContext?: string
  macroSummary?: string
  sentimentSummary?: string
  technicalSummary?: string
  sourceRefs: EvidenceRef[]
}
```

### Trade

```ts
type Trade = {
  id: string
  userId: string
  decisionId?: string
  provider: "bitget" | "manual" | "demo"
  externalId?: string
  symbol: string
  side: "long" | "short"
  quantity?: number
  entryPrice: number
  exitPrice?: number
  openedAt: string
  closedAt?: string
  realizedPnl?: number
  fees?: number
  metadata?: Record<string, unknown>
}
```

### Review

```ts
type Review = {
  id: string
  tradeId: string
  decisionId: string
  overallDecisionQuality: number
  classification:
    | "earned_win"
    | "good_decision_bad_outcome"
    | "lucky_escape"
    | "deserved_loss"
  summary: string
  model: string
  promptVersion: string
  createdAt: string
}
```

### ReviewDimension

```ts
type ReviewDimension = {
  id: string
  reviewId: string
  dimension:
    | "research"
    | "context"
    | "risk"
    | "execution"
    | "behavior"
  score: number
  explanation: string
  confidence: number
  evidenceRefs: EvidenceRef[]
}
```

### Pattern

```ts
type Pattern = {
  id: string
  userId: string
  name: string
  category:
    | "edge"
    | "leak"
    | "source"
    | "timing"
    | "behavior"
    | "regime"
  description: string
  evidenceCount: number
  confidence: number
  status: "observation" | "emerging" | "established"
  createdAt: string
  updatedAt: string
}
```

### PlaybookRule

```ts
type PlaybookRule = {
  id: string
  userId: string
  version: number
  title: string
  trigger: string
  ruleText: string
  rationale: string
  status: "proposed" | "active" | "rejected" | "deferred"
  sourcePatternId?: string
  createdAt: string
  decidedAt?: string
}
```

### MemoryEmbedding

```ts
type MemoryEmbedding = {
  id: string
  userId: string
  entityType: "decision" | "review" | "pattern" | "rule"
  entityId: string
  content: string
  embedding: number[]
  metadata: Record<string, unknown>
}
```

### EvidenceRef

```ts
type EvidenceRef = {
  type:
    | "user_input"
    | "market_data"
    | "trade_data"
    | "source"
    | "prior_decision"
    | "prior_review"
    | "playbook_rule"
  id: string
  label: string
  observedAt?: string
}
```

---

## 5. Database Requirements

### Tables

Recommended MVP tables:

- users
- decisions
- decision_revisions
- decision_origins
- decision_sources
- market_context_snapshots
- trades
- trade_events
- reviews
- review_dimensions
- patterns
- pattern_evidence
- playbook_rules
- playbook_rule_evidence
- memory_embeddings
- provider_connections
- ai_runs

### Required constraints

- foreign-key integrity;
- immutable `created_at`;
- unique external trade IDs per provider where available;
- one active review version per trade;
- playbook version monotonic per user;
- vector index on memory embeddings;
- JSON fields only where relational columns do not provide clear value.

---

## 6. API / Server Capabilities

### `POST /api/decisions/parse`

Input:

```json
{
  "rawInput": "I bought rNVDA because..."
}
```

Output:

- structured decision draft;
- decision-origin classification;
- missing fields;
- confidence values.

### `POST /api/decisions/:id/confirm`

Confirms canonical decision snapshot.

### `POST /api/decisions/:id/context`

Fetches and stores decision-time/current context.

### `POST /api/trades/import`

Imports read-only trade data from Bitget where connection exists.

### `POST /api/trades/manual`

Creates manual/demo trade.

### `POST /api/reviews/generate`

Generates structured Decision Autopsy.

### `GET /api/dna`

Returns edges, leaks and source/regime patterns.

### `POST /api/patterns/recompute`

Recomputes or incrementally updates patterns.

### `POST /api/playbook/propose`

Creates rule proposal from established pattern.

### `POST /api/playbook/:id/decision`

Accept / reject / defer.

### `POST /api/stress-test`

Input:

- new decision draft;
- current context.

Output:

- retrieved memories;
- active relevant rules;
- detected repeated patterns;
- structured stress-test summary.

---

## 7. AI Pipelines

## 7.1 Decision Parsing Pipeline

Input:
- raw user text.

Steps:
1. normalize;
2. extract structured fields;
3. classify decision origin;
4. identify missing critical fields;
5. return editable draft.

Output schema must be validated with Zod.

---

## 7.2 Context Enrichment Pipeline

Input:
- symbol;
- timestamp;
- asset class.

Steps:
1. query Bitget market data;
2. determine US native-market state if applicable;
3. query relevant macro/news/sentiment context;
4. normalize provider results;
5. store EvidenceRefs.

No LLM required for raw numeric data.

LLM may summarize normalized context.

---

## 7.3 Review Pipeline

Inputs:

- confirmed Decision Snapshot;
- decision sources;
- market context;
- trade/execution data;
- prior relevant memories;
- active playbook rules.

Output:

```ts
type ReviewOutput = {
  overallDecisionQuality: number
  classification: Review["classification"]
  dimensions: Array<{
    name: ReviewDimension["dimension"]
    score: number
    explanation: string
    confidence: number
    evidenceRefs: EvidenceRef[]
  }>
  keyLessons: string[]
  observedFacts: string[]
  inferredFindings: string[]
  candidatePatterns: Array<{
    name: string
    category: Pattern["category"]
    rationale: string
  }>
}
```

### Rule

The model may not cite evidence IDs that were not supplied in its input.

Server validates all returned references.

---

## 7.4 Pattern Pipeline

Patterns should not rely solely on unconstrained LLM generation.

Recommended split:

### Deterministic feature extraction

Examples:

- minutes after source timestamp;
- move before entry;
- planned vs actual risk;
- re-entry time after loss;
- native-market state;
- conviction-origin labels;
- outcome;
- Decision Quality.

### Statistical aggregation

Examples:

- count;
- average outcome;
- median Decision Quality;
- frequency;
- hit rate;
- sample size.

### LLM synthesis

Use the LLM to turn computed pattern data into human-readable explanations.

This reduces hallucination risk.

---

## 7.5 Playbook Proposal Pipeline

Eligibility rule:

- default: at least 3 supporting decisions;
- fewer only if user manually asks and proposal is labeled low evidence.

Output:

- trigger condition;
- proposed rule;
- evidence summary;
- uncertainty;
- expected behavior change.

No automatic activation.

---

## 7.6 Retrieval / Stress-Test Pipeline

### Candidate retrieval

Hybrid ranking:

- vector similarity;
- structured filters;
- recency;
- same asset;
- same decision-origin label;
- same native-market state;
- same pattern;
- same source identity/type.

### Rerank

Recommended weighted score:

```text
0.40 semantic similarity
0.20 same decision-origin/context
0.15 same asset/market type
0.10 recency
0.10 pattern overlap
0.05 evidence strength
```

Weights are tunable and should not be presented as financial truth.

---

## 8. External Integration Adapters

Use provider interfaces.

```ts
interface MarketDataProvider {
  getQuote(symbol: string): Promise<Quote>
  getHistory(input: HistoryRequest): Promise<Candle[]>
  getFundamentals?(symbol: string): Promise<Fundamentals>
}

interface ResearchProvider {
  getMacroContext(input: ContextRequest): Promise<ResearchItem[]>
  getNewsContext(input: ContextRequest): Promise<ResearchItem[]>
  getSentimentContext?(input: ContextRequest): Promise<ResearchItem[]>
}

interface TradeProvider {
  listTrades(input: TradeQuery): Promise<TradeRecord[]>
}
```

### Bitget MCP adapter

Responsibilities:

- quotes;
- historical data;
- stock/ETF context;
- fundamentals where used.

### bitget-signal adapter

Responsibilities:

- macro;
- news;
- sentiment;
- technical context.

### Agent Hub adapter

Responsibilities:

- read-only account/trade access;
- normalized trade import.

---

## 9. Authentication

Hackathon MVP options:

### Preferred

Simple email/magic-link auth through chosen database/auth provider.

### Demo requirement

A **Try Demo** path must exist with seeded data and no account connection required.

External Bitget account authorization must not block judging.

---

## 10. Security

### Required

- no private API keys in client bundle;
- provider secrets stored server-side;
- env vars only;
- redact credentials from logs;
- rate limit expensive AI endpoints;
- validate all external provider responses;
- sanitize source URLs;
- enforce user ownership on all records.

### Trading safety

- default all Bitget access to read-only;
- do not request withdrawal permissions;
- do not implement real-money order execution for MVP.

---

## 11. Observability

Store an `ai_runs` record containing:

- run ID;
- user ID;
- pipeline;
- model;
- prompt version;
- input entity IDs;
- latency;
- token usage if available;
- success/failure;
- validation errors.

Do not store secrets.

### Minimum logs

- external provider errors;
- AI schema validation failures;
- retrieval misses;
- database failures.

---

## 12. Demo Reliability

### Requirement

The deployed demo must work if:

- Bitget account connection is unavailable;
- a market endpoint rate-limits;
- an LLM call fails once.

### Approach

- seeded canonical demo scenario;
- cached market snapshots;
- retry once for transient failures;
- graceful “live data unavailable — showing saved decision-time snapshot” state.

Never silently present cached data as live.

---

## 13. Testing Requirements

### Unit

- decision-origin classifier output parsing;
- process/outcome classifier;
- pattern aggregation;
- playbook eligibility;
- retrieval ranking;
- evidence-reference validator.

### Integration

- database repositories;
- Bitget adapter;
- LLM structured-output validation;
- review generation with fixture data.

### E2E

At least:

1. create/parse decision;
2. confirm;
3. attach context;
4. attach trade;
5. generate review;
6. accept playbook rule;
7. create similar future decision;
8. receive recall/stress test.

---

## 14. Performance Targets

Hackathon targets:

- normal page load: < 3s on warm deployment;
- decision parsing: < 10s typical;
- review generation: < 20s typical;
- memory retrieval: < 2s;
- no page should block indefinitely on external provider response.

---

## 15. Accessibility

Minimum:

- keyboard navigation for primary flows;
- readable contrast;
- text labels alongside color;
- score meaning not encoded by color alone;
- reduced-motion compatibility where animations are used.

---

## 16. Future Technical Extensions

### Decision Receipts

Canonicalize confirmed Decision Snapshot:

```text
canonical_json(decision_snapshot)
→ SHA-256
→ optional Hedera timestamp anchor
```

Store transaction/reference alongside decision.

### Portable Memory

Potential:

- encrypted user memory payloads;
- Walrus storage;
- local/DB vector index;
- explicit export/import.

### Cross-platform data

Additional exchanges/brokers can implement `TradeProvider`.

### Crowd intelligence

Only after sufficient opted-in user volume and privacy safeguards.

---

## 17. Technical Definition of Done

The MVP is technically done when:

- production build passes;
- database migrations are reproducible;
- seed script creates judge-ready demo data;
- external integrations are isolated behind adapters;
- structured AI outputs validate;
- evidence refs cannot point to nonexistent records;
- one full E2E test covers the core loop;
- live app is accessible;
- demo mode is resilient;
- secrets remain server-side;
- no execution permission is required.
