# Reflex — Architecture

## 1. Architecture Goal

Reflex needs an architecture that can prove one powerful loop quickly:

**raw decision → structured decision → market context → trade outcome → decision autopsy → personal pattern → playbook evolution → future recall**

The MVP should be a **modular monolith**, not a distributed system.

This keeps deployment, debugging, and iteration fast while preserving clean boundaries for later scale.

---

## 2. High-Level System

```text
┌────────────────────────────────────────────────────────────────────┐
│                           REFLEX WEB APP                           │
│                      Next.js / React / TypeScript                  │
│                                                                    │
│  Decision Desk  Review Timeline  Decision DNA  Playbook  Recall   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER                            │
│                                                                    │
│  Decision Service     Review Service       Memory Service          │
│  Context Service      Pattern Service      Playbook Service        │
│  Stress-Test Service  Evidence Service     Demo Service            │
└──────────────┬─────────────────────┬─────────────────────┬──────────┘
               │                     │                     │
               ▼                     ▼                     ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│   AI ORCHESTRATION  │  │     DATA LAYER      │  │ PROVIDER ADAPTERS│
│                     │  │                     │  │                  │
│ parse decision      │  │ PostgreSQL          │  │ Bitget MCP       │
│ review              │  │ pgvector            │  │ bitget-signal    │
│ synthesize patterns │  │ versioned records   │  │ Agent Hub        │
│ propose rules       │  │ evidence graph      │  │ optional partners│
│ stress test         │  │                     │  │                  │
└─────────────────────┘  └─────────────────────┘  └──────────────────┘
```

---

## 3. Logical Layers

## 3.1 Presentation Layer

Responsibilities:

- user input;
- charts/timelines;
- interactive rule decisions;
- evidence inspection;
- demo navigation.

Suggested route map:

```text
/
  landing / demo entry

/app
  overview

/app/decisions/new
  natural-language capture

/app/decisions/[id]
  confirmed snapshot + evidence

/app/trades/[id]/review
  timeline + autopsy + classification

/app/dna
  strengths, leaks, influence patterns

/app/playbook
  active/proposed/version history

/app/stress-test
  new-trade recall flow

/app/settings
  provider/data connections
```

---

## 3.2 Application / Domain Layer

### Decision Service

Owns:

- decision draft;
- confirmation;
- revisions;
- decision-origin labels;
- source attachment.

### Context Service

Owns:

- market-data requests;
- native-market state;
- external research;
- context normalization;
- evidence references.

### Review Service

Owns:

- post-trade review orchestration;
- scoring;
- process/outcome classification;
- review versioning.

### Pattern Service

Owns:

- deterministic features;
- aggregates;
- recurring-pattern lifecycle.

### Playbook Service

Owns:

- proposals;
- evidence;
- acceptance/rejection/defer;
- version history.

### Memory Service

Owns:

- embedding creation;
- retrieval;
- hybrid ranking;
- relation between decisions, patterns and rules.

### Stress-Test Service

Owns:

- current decision context;
- retrieved personal history;
- applicable rules;
- scenario synthesis.

---

## 4. Data Model Relationships

```text
User
 │
 ├── Decision
 │    ├── DecisionRevision
 │    ├── DecisionOrigin
 │    ├── DecisionSource
 │    ├── MarketContextSnapshot
 │    └── Trade
 │         └── Review
 │              └── ReviewDimension
 │
 ├── Pattern
 │    └── PatternEvidence ───────► Decision / Review
 │
 ├── PlaybookRule
 │    └── PlaybookRuleEvidence ─► Pattern / Decision / Review
 │
 └── MemoryEmbedding
      └── references one Decision / Review / Pattern / Rule
```

---

## 5. The Decision Snapshot Boundary

The most important integrity boundary in Reflex is the **confirmed Decision Snapshot**.

Before confirmation:

- AI may parse;
- user may edit;
- fields may change.

After confirmation:

- original snapshot is preserved;
- later edits create revisions;
- post-trade information cannot overwrite what the user originally believed.

This protects Reflex from hindsight contamination.

### Conceptual structure

```json
{
  "rawInput": "...",
  "thesis": "...",
  "convictionOrigin": ["borrowed_conviction", "social_confirmation"],
  "evidence": ["..."],
  "confidence": 0.72,
  "invalidation": "...",
  "riskPlan": "...",
  "confirmedAt": "..."
}
```

---

## 6. Evidence Architecture

Reflex should not generate opaque judgments.

Every meaningful conclusion references evidence.

### Evidence types

```text
USER INPUT
“I entered because someone in Telegram called it.”

MARKET DATA
rNVDA move since native close: +4.1%

TRADE DATA
actual size: 2.4× planned size

SOURCE
Telegram call timestamp: 18:22

PRIOR DECISION
similar late-social entry on 2026-09-14

PLAYBOOK RULE
v1.4 closed-market late-entry rule
```

### Evidence flow

```text
raw provider/user data
        ↓
normalized evidence records
        ↓
AI prompt receives evidence IDs
        ↓
AI returns findings + evidence IDs
        ↓
server validates references
        ↓
UI renders conclusion + “why?”
```

The model cannot create arbitrary evidence IDs.

---

## 7. AI Architecture

The AI should operate as multiple bounded pipelines instead of one omnipotent agent.

### Pipeline A — Decision Interpreter

```text
raw explanation
→ structured fields
→ decision-origin labels
→ missing-information prompts
```

### Pipeline B — Review Analyst

```text
confirmed snapshot
+ trade
+ market context
+ prior relevant memories
→ scores
→ classification
→ lessons
→ candidate patterns
```

### Pipeline C — Pattern Narrator

```text
deterministic aggregates
+ supporting decisions
→ plain-language pattern explanation
```

### Pipeline D — Playbook Editor

```text
established pattern
+ evidence
+ existing playbook
→ proposed versioned rule
```

### Pipeline E — Pre-Trade Reviewer

```text
new proposed decision
+ live/current market context
+ similar personal history
+ active rules
→ stress test
```

No pipeline is allowed to execute trades.

---

## 8. Deterministic vs AI Responsibilities

### Deterministic code should handle

- P&L;
- percentages;
- timestamps;
- planned vs actual risk;
- move before entry;
- sample counts;
- market open/closed schedule where available;
- pattern frequency;
- simple performance aggregates;
- vector ranking score;
- process/outcome quadrant after process threshold is defined.

### LLM should handle

- messy-language extraction;
- thesis summarization;
- evidence interpretation;
- contradiction detection;
- source-quality commentary;
- explanation;
- behavioral hypothesis;
- lesson synthesis;
- proposed rule wording.

This split keeps the system credible.

---

## 9. Memory Architecture

Reflex has three memory layers.

### 9.1 Episodic Memory

Specific things that happened:

- a decision;
- a trade;
- a review;
- an event.

### 9.2 Semantic Memory

What Reflex has learned across episodes:

- “late social entries underperform for this user”;
- “macro semiconductor setups are an edge.”

Stored as Patterns.

### 9.3 Procedural Memory

Rules the user has chosen to operate by:

- PlaybookRule v1.4;
- risk limits;
- research requirements.

### Retrieval flow

```text
New trade idea
     │
     ├── structured filters
     │      symbol / class / origin / market state / behavior
     │
     ├── semantic vector search
     │
     └── active playbook lookup
             ↓
        candidate memories
             ↓
           rerank
             ↓
    top relevant evidence set
             ↓
       stress-test pipeline
```

---

## 10. Provider Architecture

External systems must be replaceable.

```text
                  ┌──────────────────────┐
                  │   Context Service    │
                  └──────────┬───────────┘
                             │
                  normalized interfaces
                             │
       ┌─────────────────────┼──────────────────────┐
       ▼                     ▼                      ▼
┌─────────────┐     ┌────────────────┐     ┌────────────────┐
│ Bitget MCP  │     │ bitget-signal  │     │ Agent Hub      │
│ stocks/ETF  │     │ research       │     │ read-only trade│
└─────────────┘     └────────────────┘     └────────────────┘
```

Optional providers should enter through the same application layer.

No UI component should know the provider-specific protocol.

---

## 11. Core End-to-End Sequence

## 11.1 First Trade

```text
User
 │
 │ “I bought because Telegram called it”
 ▼
Decision Interpreter
 │
 ▼
Decision Draft
 │
 │ user confirms
 ▼
Immutable Snapshot
 │
 ├────► Context Service ───► Bitget providers
 │
 └────► Database
```

## 11.2 Trade Review

```text
Trade closes/imports
      │
      ▼
Review Service
      │
      ├─ confirmed Decision Snapshot
      ├─ execution facts
      ├─ market context
      ├─ prior memories
      └─ active rules
      │
      ▼
Review Analyst
      │
      ▼
Structured Review
      │
      ├─ scores
      ├─ evidence
      ├─ outcome/process classification
      └─ candidate patterns
```

## 11.3 Self-Evolution

```text
new review
   │
   ▼
Pattern Service
   │
   ├─ deterministic aggregation
   └─ evidence threshold
   │
   ▼
emerging / established pattern
   │
   ▼
Playbook Editor
   │
   ▼
proposed rule
   │
User: Accept / Reject / Defer
   │
   ▼
new Playbook version
```

## 11.4 Future Recall

```text
new trade idea
    │
    ▼
Decision Interpreter
    │
    ▼
Memory Retrieval ──► similar decisions
    │              ► relevant patterns
    │              ► active rules
    ▼
Context Service ──► current market context
    │
    ▼
Pre-Trade Reviewer
    │
    ▼
“this resembles 6 previous decisions...”
```

---

## 12. Process vs Outcome Engine

The classification should not be decided directly from the LLM.

### Step 1

Review Analyst produces validated dimension scores.

### Step 2

Server computes a weighted process score.

Initial hackathon weighting:

```text
Research Quality     25%
Context Awareness    20%
Risk Discipline      25%
Execution Quality    15%
Behavioral Control   15%
```

These weights are product assumptions, not financial truth.

### Step 3

Determine outcome sign.

### Step 4

Map:

```text
process >= threshold + positive outcome → Earned Win
process >= threshold + negative outcome → Good Decision, Bad Outcome
process < threshold  + positive outcome → Lucky Escape
process < threshold  + negative outcome → Deserved Loss
```

The UI must expose the components rather than pretending the final label is objective fact.

---

## 13. 24/7 Tokenized Equity Context

For rToken decisions, Context Service should attempt to compute:

- native-equity market status;
- last native close;
- time since native close;
- rToken move since native close;
- relevant event timestamps;
- decision time relative to event;
- entry time relative to rToken repricing.

This supports patterns such as:

> “Late social-confirmation entry after closed-market repricing.”

This should be treated as a first-class scenario in demo data.

---

## 14. Demo Architecture

Judge reliability is critical.

### Two operating modes

#### Live mode

- current provider calls;
- user-created decisions;
- connected read-only trades where available.

#### Demo mode

- seeded user;
- seeded trades;
- cached verified market snapshots;
- fixed evidence IDs;
- full deterministic happy path.

### Requirement

Demo mode must demonstrate the exact same product services as live mode where possible.

Avoid building a fake static UI disconnected from actual domain logic.

---

## 15. Optional Provenance Extension

### Decision Receipt

At snapshot confirmation:

```text
Decision Snapshot
      ↓
canonical JSON
      ↓
SHA-256 hash
      ↓
optional Hedera Consensus Service
      ↓
timestamp / transaction reference
```

Purpose:

> prove the thesis existed before the outcome.

This is useful but not required for core MVP.

---

## 16. Optional Portable Memory Extension

Potential later architecture:

```text
Postgres
  ├─ searchable metadata
  ├─ vectors
  └─ encrypted-object references

Encrypted memory payload
      ↓
Walrus
```

Sensitive trading data must not be stored publicly in plaintext.

---

## 17. Deployment

Recommended:

- Vercel — Next.js application
- Neon/Supabase — Postgres + pgvector
- server-side env vars for all credentials

### Environments

- local
- preview
- production

### Required env categories

```text
DATABASE_URL
LLM_*
BITGET_*
OPTIONAL_PROVIDER_*
```

Never expose server credentials using `NEXT_PUBLIC_*`.

---

## 18. Repository Structure

Suggested:

```text
src/
  app/
    api/
    app/
  components/
    decisions/
    reviews/
    dna/
    playbook/
    stress-test/
  domain/
    decisions/
    trades/
    reviews/
    patterns/
    playbook/
    memory/
  services/
    ai/
    context/
    retrieval/
  integrations/
    bitget-mcp/
    bitget-signal/
    agent-hub/
  db/
    schema/
    repositories/
  lib/
    validation/
    evidence/
    math/
    time/

scripts/
  seed-demo.ts
  verify-integrations.ts

tests/
  unit/
  integration/
  e2e/
```

---

## 19. Failure Modes

### Provider failure

Show:
- data unavailable;
- timestamp of last known snapshot;
- never relabel cached data as current.

### AI invalid structured output

- retry once with validation feedback;
- if still invalid, persist failure and show recoverable state.

### No similar memories

Say:
> “Not enough personal history yet.”

Do not invent similarity.

### Tiny sample size

Label:
> “Early observation — 2 supporting trades.”

Do not call it an established edge/leak.

---

## 20. Architecture Decision Summary

### Use

- modular monolith;
- relational canonical data;
- pgvector for recall;
- provider adapters;
- bounded AI pipelines;
- evidence-referenced outputs;
- append/versioned history;
- demo fallback.

### Avoid

- microservices;
- autonomous execution;
- agent swarm;
- decentralized storage as core dependency;
- provider-specific logic throughout UI;
- one giant unstructured “AI agent” prompt;
- hidden mutation of user memory.

---

## 21. Architectural North Star

**Reflex should be able to explain exactly how a lesson traveled from one past decision into a future warning.**
