# Reflex — Project Plan

## 1. Project Summary

**Reflex** is a self-evolving decision intelligence desk for crypto and 24/7 tokenized US equities.

It helps active retail traders understand **how they actually make trading decisions**, not just whether a trade ended green or red.

Reflex captures what the trader believed before a trade, where the conviction came from, what evidence influenced them, what they actually did, what the market environment was, and what happened afterward. It then turns those outcomes into evidence-backed lessons that update a personal trading playbook and resurface before similar future decisions.

### Core product loop

**Decide → Trade → Understand → Learn → Evolve → Recall → Decide better**

### Core thesis

P&L is a poor teacher.

A profitable trade can come from a bad decision.  
A losing trade can come from a good decision.

Reflex separates **decision quality** from **financial outcome** and helps the trader improve the process that produced the trade.

---

## 2. Hackathon Positioning

### Event

Bitget AI Base Camp Hackathon S2

### Main Track

**AI Trading Desk**

### Primary Sub-theme

**Review & Self-Evolution**

### Supporting capabilities from adjacent sub-themes

Reflex may use capabilities associated with:

- **Information Extraction & Signal Generation** to reconstruct market context and source evidence.
- **Decision Stress Testing** to compare a proposed trade with similar historical and personal scenarios.

These are supporting capabilities. The product remains clearly positioned around **Review & Self-Evolution**.

### Why Reflex fits the track

The track asks:

> After trading, how does AI help the trader review and iterate their research framework?

Reflex answers:

> By reconstructing what the trader knew, believed, and did at decision time; separating decision quality from outcome; detecting recurring research and behavioral failure patterns; and turning repeated evidence into versioned personal trading rules that are recalled before future decisions.

---

## 3. Target User

### Primary user

Active retail traders who:

- trade crypto and/or tokenized US equities several times per week;
- typically manage roughly **$500–$25,000** in trading capital;
- consume trade ideas from X, Telegram, Discord, communities, influencers, or friends;
- do not yet have an institutional-grade research and review process;
- sometimes act on borrowed conviction, social confirmation, or impulse;
- want to improve, but find traditional journaling too manual or too shallow.

### User reality Reflex explicitly accepts

The user does **not** need to arrive with a perfect thesis.

Valid inputs include:

- “I researched this myself.”
- “Someone in Telegram called it.”
- “Everyone was bullish and I followed.”
- “I honestly just thought it would run.”

Reflex treats these as **decision-origin data**, not as reasons to shame the user.

---

## 4. Problem Statement

Retail traders receive abundant market information but very little useful learning from their own behavior.

Existing tools commonly show:

- trade history;
- P&L;
- win rate;
- generic journal notes;
- broad AI commentary;
- generic FOMO/revenge-trading labels.

They often fail to answer:

- Where did my conviction actually come from?
- Was the underlying thesis good?
- Did I use strong evidence or social confirmation?
- Did my behavior corrupt an otherwise sound thesis?
- Was I lucky even though I made money?
- Was I right to take a trade even though I lost?
- Which sources consistently help or hurt me?
- Which market regimes expose my weaknesses?
- What should concretely change in my research process?
- Will the system remember this when a similar situation happens again?

The problem becomes more acute in 24/7 markets because there is less natural downtime and more opportunity to act on incomplete information, social pressure, stale reference prices, or already-priced moves.

---

## 5. Product Principles

1. **Decision quality is not the same as outcome quality.**
2. **Messy human inputs are valid data.**
3. **Behavior is one layer, not the whole product.**
4. **Every score must have receipts.**
5. **AI should propose learning, not silently rewrite the user’s rules.**
6. **One trade creates a hypothesis; repeated evidence creates a rule.**
7. **The value of Reflex should compound over time.**
8. **The next decision is where review proves its value.**
9. **No fake precision or unsupported “money saved” claims.**
10. **The hackathon demo must prove one closed loop before adding breadth.**

---

## 6. Product Pillars

### 6.1 Decision Capture

Capture:

- ticker/asset;
- direction;
- intended entry;
- thesis;
- source of idea;
- evidence;
- confidence;
- catalyst;
- invalidation;
- risk plan;
- timeframe;
- optional behavioral context.

Classify conviction source:

- original research;
- borrowed conviction;
- social confirmation;
- pure impulse.

### 6.2 Market Context Reconstruction

Attach decision-time context such as:

- native US market open/closed;
- latest underlying reference;
- tokenized-stock movement since native close;
- relevant macro/news events;
- crypto/risk proxy movement;
- sentiment/technical context where relevant.

### 6.3 Decision Autopsy

After a trade, grade the process independently of the financial result.

Example dimensions:

- research quality;
- context awareness;
- risk discipline;
- execution quality;
- behavioral control.

Outcome classification:

| Process | Outcome | Classification |
|---|---|---|
| Good | Good | Earned Win |
| Good | Bad | Good Decision, Bad Outcome |
| Bad | Good | Lucky Escape |
| Bad | Bad | Deserved Loss |

### 6.4 Decision DNA

Build an evolving map of:

- strengths;
- recurring leaks;
- decision origins;
- trusted/misleading sources;
- market-regime performance;
- timing tendencies;
- behavioral patterns;
- rule adherence;
- process improvement.

### 6.5 Self-Evolving Playbook

Turn repeated evidence into proposed rules.

Each proposal includes:

- detected pattern;
- supporting trade count;
- historical evidence;
- current rule;
- proposed rule;
- reason;
- confidence;
- user action: Accept / Reject / Need more evidence.

Rules are versioned.

### 6.6 Pre-Trade Recall & Stress Test

When the user considers a new trade, Reflex retrieves:

- similar personal decisions;
- similar market conditions;
- relevant playbook rules;
- prior source/timing patterns.

It then warns about repeated failure modes without making the final trading decision for the user.

---

## 7. Hackathon MVP Scope

### Must ship

1. **Trade/decision capture**
2. **Decision-origin classification**
3. **One real Bitget market-data integration**
4. **One real Bitget research/context integration**
5. **Trade reconstruction**
6. **Decision-quality scoring with explanations**
7. **Lucky Escape / Good Decision Bad Outcome classification**
8. **Decision DNA summary**
9. **At least one evidence-backed playbook rule proposal**
10. **Pre-trade recall using previous decisions**
11. **Complete question → actionable insight flow**
12. **Accessible deployed demo**

### Strongly preferred

- import/sync trade history from Bitget Agent Hub in read-only mode;
- semantic retrieval using embeddings;
- timeline visualization;
- one 24/7 rToken scenario;
- one beginner/social-call scenario.

### Stretch

- cryptographic Decision Receipt;
- Hedera timestamp anchoring;
- Walrus-backed portable memory;
- broader on-chain context;
- shareable Trading Wrapped;
- crowd-level aggregate intelligence.

---

## 8. Explicit Non-Goals for the Hackathon

Do **not** spend MVP time on:

- autonomous trading;
- order execution;
- live capital management;
- full quant backtesting infrastructure;
- crowd sentiment index;
- social network;
- broad exchange support;
- all rToken markets;
- perfect psychological diagnosis;
- medical/clinical claims;
- guaranteed P&L improvement;
- complicated decentralized storage before the core loop works.

---

## 9. Required / Recommended Toolchain

### Core

- **Bitget MCP Server** — US stock/ETF quote, history, fundamentals, earnings, analyst, institutional and related market context.
- **bitget-signal** — macro, news, sentiment, technical and market-intelligence context where relevant.
- **Bitget Agent Hub (read-only)** — account/trade-history access if practical for MVP.
- **LLM** — Qwen 3.8 Max as primary hackathon model where available, behind a model adapter.
- **Postgres** — canonical application data.
- **pgvector** — semantic recall across decisions, lessons, sources and rules.
- **Next.js + TypeScript** — product UI and API layer.

### Optional, only if relevant and time permits

- **Hedera Consensus Service** — immutable timestamp for decision snapshots.
- **Walrus Memory / encrypted storage** — future portable user-owned memory.
- **The Graph** — only if a specific on-chain query materially improves a chosen scenario.
- **Chainbase AgentKey** — if multi-source market/on-chain/news/social retrieval materially improves the demo.

---

## 10. Workstreams

### Workstream A — Product Core

Deliver:

- decision schema;
- trade schema;
- review schema;
- rule schema;
- memory schema;
- Decision DNA model.

### Workstream B — Data Integrations

Deliver:

- Bitget market-data adapter;
- bitget-signal adapter;
- Agent Hub read-only adapter or demo import fallback;
- normalized context object.

### Workstream C — AI Reasoning

Deliver:

- decision parsing;
- decision-origin classification;
- evidence-quality evaluation;
- post-trade autopsy;
- pattern extraction;
- playbook proposal;
- similar-decision recall;
- stress-test narrative.

### Workstream D — UX

Deliver:

- onboarding/demo mode;
- dashboard;
- decision capture flow;
- trade review timeline;
- Decision Quality screen;
- Decision DNA;
- Playbook;
- next-trade warning/recall.

### Workstream E — Validation & Submission

Deliver:

- 3–5 realistic seed personas/trades;
- at least one end-to-end real-data scenario;
- documented test workflow;
- demo script;
- project description;
- role-of-LLM response;
- deployed demo;
- submission-materials page;
- X promotional post.

---

## 11. Demo Story

### Demo scenario

A trader says:

> “I bought rNVDA because someone in my Telegram group called it and everyone was bullish.”

Reflex:

1. captures the raw explanation;
2. identifies borrowed conviction/social confirmation;
3. reconstructs the market context;
4. shows whether the rToken had already repriced;
5. imports/replays the eventual trade outcome;
6. shows green P&L;
7. reveals low Decision Quality;
8. classifies the trade as **Lucky Escape**;
9. explains exactly why;
10. combines it with prior decisions;
11. proposes a new personal playbook rule;
12. user accepts it;
13. a later proposed trade triggers that rule before entry.

### Judge “aha” moment

> **“You made money. Your process still failed.”**

Then:

> **“Reflex remembers this before you do it again.”**

---

## 12. Success Metrics

### Hackathon product metrics

- complete research task success rate;
- decision capture completion rate;
- review generation success rate;
- evidence links per review;
- successful similar-decision retrieval;
- time from raw user explanation to structured decision;
- percentage of AI claims traceable to data or user input.

### Demo validation

Target:

- 5–10 test users;
- at least 10–30 seeded/realistic decision records;
- qualitative feedback on whether the review changes how the user understands a past trade;
- at least 70% task completion for the primary demo flow.

All metrics must be labeled as observed, simulated, estimated, or targeted.

---

## 13. Risks

### Risk: Product becomes an AI trading journal

Mitigation:

- emphasize decision reconstruction;
- versioned self-evolution;
- pre-trade recall;
- 24/7 market context.

### Risk: Product becomes an AI therapist

Mitigation:

- behavioral analysis is one dimension only;
- avoid clinical framing;
- focus on observable trading behavior.

### Risk: AI invents causal explanations

Mitigation:

- evidence-backed claims;
- citations/receipts;
- confidence levels;
- distinguish observed facts from inferred patterns.

### Risk: Too much scope

Mitigation:

- one closed loop first;
- stretch integrations only after end-to-end flow works.

### Risk: Hackathon integrations become decorative

Mitigation:

- each external integration must answer a real product question.

---

## 14. Long-Term Product Vision

Reflex becomes a personal decision-intelligence layer that travels with the trader.

Over time it learns:

- how they research;
- where conviction originates;
- who influences them;
- which signals work for them;
- which sources mislead them;
- where discipline breaks;
- which regimes hurt or help them;
- which rules improve outcomes;
- how their decision process changes.

Future expansion may include:

- portable encrypted memory;
- broker/exchange portability;
- team/trading-desk mode;
- institutional audit trails;
- verified decision receipts;
- Playbook integration;
- anonymized aggregate behavioral intelligence;
- optional social “Trading Wrapped” distribution.

---

## 15. North Star

**Reflex should help a trader make a better next decision because it understood the previous ones.**
