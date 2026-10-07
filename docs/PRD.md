# Reflex — Product Requirements Document (PRD)

## 1. Document Purpose

This PRD defines the product behavior, user experience, scope, acceptance criteria, and success conditions for the Reflex hackathon MVP.

Reflex is designed first for the Bitget AI Base Camp S2 **AI Trading Desk → Review & Self-Evolution** track, while remaining credible as a long-term product.

---

## 2. Product Definition

### Product name

**Reflex**

### Category

Self-evolving trading decision intelligence

### Product statement

Reflex helps active retail traders understand **how they make trading decisions**, learn from both wins and losses without hindsight distorting the lesson, and carry those lessons into future trades.

### One-line value proposition

**Every trade trains the next decision.**

### Core user promise

Reflex will not only tell the trader what happened. It will explain:

- what they believed;
- where that belief came from;
- what evidence they used;
- what they actually did;
- what the market environment was;
- whether their process was sound;
- what pattern is repeating;
- what should change next time.

---

## 3. User Problem

### Primary problem

Retail traders often receive financial feedback only through P&L.

This creates bad learning:

- green trades can reinforce bad process;
- red trades can punish good process;
- social influence is not tracked;
- research quality and behavior are mixed together;
- journals require manual discipline;
- lessons are rarely resurfaced before the next similar trade.

### Specific pain point

A trader may enter because:

- they independently researched a thesis;
- a trusted trader called it;
- Telegram/X consensus influenced them;
- they acted impulsively.

Traditional trade history treats these as equivalent executions.

Reflex does not.

---

## 4. Persona

### Primary Persona — “The Active Retail Ape Becoming Serious”

**Capital:** $500–$25,000  
**Markets:** crypto + tokenized US equities  
**Frequency:** several trades per week  
**Information sources:** Telegram, X, Discord, influencers, news, charts  
**Skill level:** beginner-to-intermediate  
**Current workflow:** fragmented, reactive, inconsistent  
**Goal:** become a more disciplined and independent decision-maker

### Jobs to be done

When I take a trade, I want to remember **why** I took it so I can judge the process later.

When I win, I want to know whether I was actually right or merely lucky.

When I lose, I want to know whether the thesis, timing, execution, risk, or behavior failed.

When I repeat the same mistake, I want the system to catch the pattern.

When I consider a similar trade later, I want my previous lessons to appear before I repeat the mistake.

---

## 5. Product Experience

### 5.1 User flow

1. User opens Reflex.
2. User selects or creates a trade decision.
3. User describes the idea naturally.
4. Reflex converts the raw explanation into a structured Decision Snapshot.
5. Reflex retrieves relevant market context.
6. User confirms/edits the snapshot.
7. Trade outcome is attached from Bitget or demo data.
8. Reflex reconstructs the decision and market timeline.
9. Reflex creates a Decision Autopsy.
10. Reflex grades decision dimensions with evidence.
11. Reflex classifies outcome/process.
12. Reflex updates Decision DNA.
13. Reflex checks whether a recurring pattern exists.
14. Reflex proposes a Playbook rule if evidence is sufficient.
15. User accepts/rejects/defers the proposal.
16. On a later decision, Reflex retrieves relevant past decisions and active rules.
17. Reflex presents a pre-trade stress test.
18. User makes the final decision.

---

## 6. Functional Requirements

## FR-1 — Natural-Language Decision Capture

The user must be able to describe a trade in ordinary language.

Example:

> “I bought rNVDA because someone in my Telegram group called it and everyone looked bullish.”

Reflex must extract, when available:

- symbol;
- asset class;
- direction;
- thesis;
- catalyst;
- conviction source;
- evidence;
- confidence;
- entry intent;
- invalidation;
- timeframe;
- risk intention.

### Acceptance criteria

- User can submit an unstructured explanation.
- System returns structured fields.
- User can edit any inferred field.
- Inferred and user-confirmed values are distinguishable.

---

## FR-2 — Decision-Origin Classification

Reflex must classify the origin of conviction using one or more labels:

- Original Research
- Borrowed Conviction
- Social Confirmation
- Pure Impulse

### Acceptance criteria

- Classification contains a confidence score.
- User can override it.
- Raw source text is preserved.
- Classification is used later in Decision DNA and pattern analysis.

---

## FR-3 — Source Capture

The user may attach:

- URL;
- note;
- X post reference;
- Telegram description/manual note;
- news item;
- analyst opinion;
- screenshot metadata/manual summary;
- other source label.

For MVP, Reflex does not need to scrape every closed/private platform.

### Acceptance criteria

- Multiple sources can be attached to one decision.
- Each source stores type, label, timestamp, and user-provided context.
- AI can grade source diversity and independence without claiming certainty it cannot support.

---

## FR-4 — Market Context Snapshot

At decision time, Reflex must attach available market context.

Priority fields:

- current/decision-time quote;
- recent price movement;
- native US market state if applicable;
- rToken movement relative to native close;
- macro/news context;
- technical/sentiment context where relevant.

### Acceptance criteria

- At least one Bitget-provided market-data source is live.
- Context fields include source and timestamp.
- Missing context is explicitly shown as unavailable, not fabricated.

---

## FR-5 — Trade Import / Outcome Attachment

Reflex must support at least one of:

1. Bitget read-only trade import;
2. manual trade outcome entry;
3. seeded demo trades.

Fields:

- entry price;
- exit price;
- side;
- size;
- entry/exit timestamps;
- realized P&L;
- fees if available;
- execution events.

### Acceptance criteria

- Demo always works even if external account authorization fails.
- Imported and manually entered trades are labeled.

---

## FR-6 — Decision Timeline

Reflex must show a chronological timeline including:

- decision captured;
- sources/evidence;
- market state;
- relevant events;
- entry;
- invalidation;
- user actions;
- exit;
- post-trade events where relevant.

### Acceptance criteria

- Every timeline event has timestamp and origin.
- AI-inferred events are visually distinct from observed events.

---

## FR-7 — Decision Autopsy

Reflex must generate an after-trade review that separately evaluates:

- Research Quality
- Context Awareness
- Risk Discipline
- Execution Quality
- Behavioral Control

### Acceptance criteria

Each dimension must provide:

- score;
- evidence;
- explanation;
- confidence;
- observed vs inferred distinction.

No score may exist without an explanation.

---

## FR-8 — Process vs Outcome Classification

Reflex must classify each reviewed trade as one of:

- **Earned Win**
- **Good Decision, Bad Outcome**
- **Lucky Escape**
- **Deserved Loss**

### Acceptance criteria

- Classification is derived from process quality + realized outcome.
- Explanation identifies why.
- Positive P&L cannot automatically imply good process.
- Negative P&L cannot automatically imply bad process.

---

## FR-9 — Decision DNA

Reflex must maintain a personal profile containing recurring:

### Edges

Examples:

- early macro-event interpretation;
- disciplined defined-risk trades;
- specific asset/regime strengths.

### Leaks

Examples:

- late social-confirmation entries;
- revenge re-entry;
- position-size drift;
- ignoring invalidation;
- weak-source dependence.

### Influence patterns

Examples:

- Source A;
- Telegram groups;
- social consensus;
- independent research.

### Acceptance criteria

- Every DNA item links back to supporting decisions.
- Patterns require more than one event unless explicitly marked “single-trade observation.”
- User can inspect the supporting evidence.

---

## FR-10 — Pattern Detection

The system must compare decisions across dimensions such as:

- conviction source;
- source quality;
- timing;
- asset;
- market regime;
- market open/closed state;
- trade result;
- Decision Quality;
- behavioral markers.

### Acceptance criteria

- Patterns include sample size.
- System avoids language implying statistical certainty for tiny samples.
- Pattern strength increases with evidence.

---

## FR-11 — Self-Evolving Playbook

Reflex must propose new or changed personal rules based on recurring evidence.

A rule proposal must include:

- trigger;
- detected pattern;
- supporting decisions;
- historical result;
- proposed rule;
- expected purpose;
- confidence/evidence strength.

User options:

- Accept
- Reject
- Need more evidence

### Acceptance criteria

- AI cannot silently activate a new rule.
- Accepted rules create a new version.
- Version history is visible.
- Rejected rules remain in audit history.

---

## FR-12 — Pre-Trade Recall

When the user describes a new proposed trade, Reflex must retrieve relevant:

- previous decisions;
- active playbook rules;
- similar source patterns;
- similar market conditions.

### Acceptance criteria

- At least 3 relevant memories can be retrieved where data exists.
- Relevance rationale is shown.
- User can open the source decision.

---

## FR-13 — Decision Stress Test

Reflex must present a pre-trade assessment.

Possible outputs:

- repeated personal failure mode;
- similar historical scenario;
- contradiction in thesis;
- source concentration;
- extended move / late-entry warning;
- relevant playbook rule;
- opposing evidence.

### Acceptance criteria

- Reflex does not place the trade.
- Reflex does not present certainty.
- User remains the final decision-maker.

---

## FR-14 — Evidence & Explainability

Every high-impact AI conclusion must be traceable.

Examples:

- “Late social-confirmation entry” → supporting timestamps and prior trades.
- “Weak evidence diversity” → source list.
- “Risk rule violated” → planned risk vs actual size.
- “Native market closed” → market-state data.

### Acceptance criteria

- Review UI exposes evidence.
- AI reasoning text does not reveal private chain-of-thought.
- System presents concise rationale and source facts.

---

## 7. UX Requirements

### UX-1 — No professional-trader gatekeeping

The product must accept messy language.

Avoid forcing users to fill a 20-field research form before receiving value.

### UX-2 — Progressive structure

Start with conversation.

Then show the structured interpretation for confirmation.

### UX-3 — High-impact review moment

The interface should make the process/outcome split unmistakable.

Example:

**+$428 P&L**  
**Decision Quality 41/100**  
**LUCKY ESCAPE**

### UX-4 — Timeline-first explanation

Prefer visual chronology over walls of text.

Suggested frame:

**What I believed → What I did → What changed → What happened → What I learned**

### UX-5 — Evidence on demand

Summary first; details expandable.

### UX-6 — No shame

Reflex may be direct, but never ridicule losses by default.

“Ghost Roast” style experiences, if ever added, must be opt-in.

---

## 8. AI Requirements

### AI responsibilities

The LLM may:

- parse natural language;
- structure decisions;
- classify decision origin;
- summarize sources;
- compare evidence;
- identify contradictions;
- generate post-trade review;
- propose behavior/research patterns;
- draft playbook changes;
- synthesize pre-trade stress tests.

### AI must not

- invent market facts;
- invent user history;
- silently modify historical decision snapshots;
- automatically place orders;
- claim guaranteed improvement;
- make unsupported clinical/psychological diagnoses.

### Prompting principle

Reflex should reason from:

1. immutable/user-confirmed decision data;
2. market context;
3. execution data;
4. retrieved personal history;
5. active playbook rules.

---

## 9. Memory Requirements

### Memory types

**Episodic**
- individual decisions/trades/events.

**Semantic**
- generalized personal patterns.

**Procedural**
- accepted playbook rules.

### Retrieval priorities

Rank by:

- semantic similarity;
- same asset/class;
- same conviction source;
- same regime;
- same market-state condition;
- same behavior pattern;
- recency;
- evidence strength.

---

## 10. Data Integrity Requirements

- Original Decision Snapshot must remain preserved after confirmation.
- Later edits create revisions, not destructive replacement.
- AI analyses are versioned.
- Playbook changes are versioned.
- Sources retain timestamp and origin.
- Observed facts and AI inference must be distinguishable.

---

## 11. Product Metrics

### Primary

- percentage of completed trades with a generated review;
- percentage of reviews with at least one evidence-backed insight;
- percentage of proposed rules accepted/rejected/deferred;
- pre-trade memory recall usage;
- repeat-user return to previous lessons.

### Hackathon demo

- one complete live research/review flow;
- one playbook-evolution event;
- one later pre-trade intervention;
- at least one real Bitget integration visible in the product.

---

## 12. MVP Screens

1. **Home / Decision Desk**
2. **Capture Decision**
3. **Decision Snapshot**
4. **Trade Timeline**
5. **Decision Autopsy**
6. **Decision DNA**
7. **Playbook**
8. **New Trade Stress Test**
9. **Demo/Data Sources**
10. **Settings / Data Connections**

---

## 13. Demo Dataset Requirements

Seed at minimum:

### Scenario A — Lucky Escape

- borrowed conviction;
- social confirmation;
- poor risk discipline;
- profitable outcome.

### Scenario B — Good Decision, Bad Outcome

- independent research;
- strong evidence;
- clear invalidation;
- controlled risk;
- losing outcome.

### Scenario C — Repeated Failure Pattern

- several late social entries;
- enough evidence to propose a new playbook rule.

### Scenario D — Future Intervention

- new proposed trade matching Scenario C;
- Reflex recalls relevant rule and similar decisions.

---

## 14. Out of Scope

- real-money automated execution;
- financial-adviser positioning;
- predictive “buy/sell” signals as the primary product;
- multi-exchange portfolio aggregation;
- community feed;
- social copy trading;
- crowd-bias index;
- complete psychological profiling;
- medical mental-health claims.

---

## 15. Release Acceptance Criteria

MVP is submission-ready when:

- deployed app is publicly accessible;
- demo flow works without special credentials;
- at least one Bitget data integration works;
- the product accepts a natural-language trade explanation;
- a decision snapshot can be confirmed;
- a completed trade produces an evidence-backed autopsy;
- process/outcome classification works;
- Decision DNA updates;
- a playbook rule can be proposed and accepted;
- a subsequent trade can recall that rule;
- relevant source/data provenance is visible;
- no core demo path depends on manual code changes.

---

## 16. North-Star Experience

The user should finish a review thinking:

> “I thought I knew why that trade worked. I didn’t.”

And start a later decision thinking:

> “Reflex remembered the pattern before I repeated it.”
