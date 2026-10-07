# Reflex — Messaging, Language & Copy

## Scope

This document turns the strategic, messaging, language, UX-copy, feature-naming, claims-discipline, and validation recommendations for **Reflex** into a build-ready reference.

Included:

1. Executive diagnosis
2. Strategic foundation
3. Positioning
4. Brand core
5. Messaging architecture
6. Message hierarchy
7. How users move through the product
8. Product copy library
9. Verbal identity
10. Feature and product naming architecture
13. Claims discipline
14. Highest-priority messaging and product decisions
15. Tests before locking the system
16. Final recommendation

Intentionally excluded from this file:

- Visual identity direction
- Competition strategy

Those should live in separate documents so this file remains focused on what Reflex says, how it speaks, and how the user experiences that language.

## Source of truth

The supplied `PRD.md` is the product source of truth. It defines the intended Reflex MVP, user problem, product flow, functional requirements, AI boundaries, data-integrity rules, demo scenarios, and release acceptance criteria.

This document defines the strategic and verbal expression of that product. It must not be used to imply that a target capability is already shipped. Product copy should be updated as implementation status changes.

---

# 1. Executive diagnosis

## 1.1 What Reflex truly is

Reflex is not primarily a trading bot, signal generator, market-prediction engine, or generic analytics dashboard.

Reflex is a **decision-memory and accountability system for active traders**.

It helps a trader preserve the reasoning behind a trade before hindsight alters the story, compare that reasoning with the evidence and outcome, identify what keeps repeating, and carry the useful lesson into a future decision.

The product is built around a distinction most trading tools fail to make:

> A profitable outcome is not automatically a good decision. A losing outcome is not automatically a bad decision.

That distinction is the centre of the brand.

## 1.2 The strongest product idea

Reflex turns a messy trading thought into a time-stamped, reviewable decision and later returns the relevant lesson before a similar decision is made.

The core loop is:

> **Messy thought → Confirmed decision → Evidence → Fair review → Personal rule → Timely recall**

This loop should guide:

- the landing page;
- the product onboarding;
- the screen hierarchy;
- the product terminology;
- the demo narrative;
- the tagline system;
- the explanation of the AI;
- the product roadmap.

If a proposed feature does not strengthen this loop, it should not be treated as core Reflex functionality.

## 1.3 The audience’s real question

The audience is not primarily asking:

- “Can AI find me a trade?”
- “Can AI predict the market?”
- “Can AI make me rich?”

The deeper question is:

> **“Was I actually right, or did I just get lucky?”**

A second question follows:

> **“Will I remember the useful part before I make this mistake again?”**

Reflex should speak directly to those questions.

## 1.4 What the current category language gets wrong

The phrase **self-evolving trading decision intelligence** is technically interesting, but it is not the language of the user.

It foregrounds:

- architecture;
- autonomy;
- model capability;
- technical novelty;
- agentic systems.

The user cares about:

- whether the trade made sense;
- whether the result was luck;
- whether the risk was intentional;
- whether social influence distorted the decision;
- whether a repeated pattern is visible;
- what to remember next time.

Use the technical category internally or in technical documentation. Lead publicly with:

> **AI trading decision journal**

Use this strategic category when greater differentiation is needed:

> **Personal trading decision intelligence**

## 1.5 What should be rejected

### Reject “AI trader” positioning

It would move Reflex into a crowded and riskier category. It would also contradict the product’s strongest principle: the human trader remains the final decision-maker.

### Reject “signal” positioning

Reflex should not imply that its primary value is telling the user what to buy or sell. It helps the user understand and improve their process.

### Reject “psychological diagnosis” language

Reflex may identify behaviour patterns in recorded decisions. It must not imply that it can diagnose a person’s mental state, personality, or clinical condition.

### Reject public use of “ape”

“The active retail ape becoming serious” is useful as an internal persona shorthand. It should not appear in public product copy. The product should respect the user’s current behaviour while speaking to the person they are trying to become:

> **An independent trader who can explain, review, and improve their own decisions.**

### Reject feature sprawl

The MVP should not present ten separate features as ten equal reasons to care. It should show one complete decision loop and let the supporting capabilities make that loop credible.

## 1.6 Strategic language consequence

Every major message should move the user from:

- reaction to reflection;
- borrowed conviction to owned conviction;
- result-watching to process-learning;
- memory to evidence;
- repeated mistakes to reusable rules;
- uncertainty to clearer agency.

Reflex should sound like the calm, honest moment after the impulse and before the repeat.

---

# 2. Strategic foundation

## 2.1 Public category

> **AI trading decision journal**

This is the clearest first description. It tells people what Reflex is without forcing them to decode an abstract category.

## 2.2 Strategic category

> **Personal trading decision intelligence**

This describes the longer-term territory Reflex can own: a system that makes an individual trader’s decision history useful, searchable, reviewable, and actionable.

## 2.3 Product descriptor

> **The decision journal for active traders.**

Use this beneath the logo, in the product header, in the opening sentence of the website, and in short directory listings.

## 2.4 Priority audience

Reflex is for active retail traders who:

- trade crypto and/or tokenized US equities;
- make several trades per week;
- consume information from Telegram, X, Discord, influencers, news, and charts;
- have approximately $500–$25,000 in trading capital;
- are beginner-to-intermediate rather than professional institutional traders;
- currently use a fragmented, reactive, inconsistent workflow;
- want to become more independent and disciplined;
- know that their decisions are influenced by social information, but do not have a reliable way to review that influence later.

The audience is not “all traders.” It is a specific person who is actively participating in the market, is beginning to take their process seriously, and feels that their memory and P&L are not teaching them enough.

## 2.5 Audience insight

The user often remembers the result more vividly than the reasoning.

They remember:

- the green candle;
- the loss;
- the person who called the move;
- the feeling of urgency;
- the moment they entered.

They often do not preserve:

- what they believed before entering;
- what evidence actually supported the thesis;
- what would have proved them wrong;
- how much risk they intended to take;
- whether they were independently convinced or socially pulled in.

Reflex gives the original decision a memory before the outcome rewrites it.

## 2.6 Jobs to be done

### Functional job

> When I take a trade, I want to remember why I took it so I can judge the process later.

### Learning job

> When I win or lose, I want to know what the result actually teaches me.

### Behavioural job

> When I repeat a pattern, I want the system to surface it before I repeat it again.

### Emotional job

> I want to feel clear and honest about my decisions without being shamed for losing.

### Identity job

> I want to become the kind of trader who owns an edge instead of renting conviction from other people.

## 2.7 Core problem

> **Most trading tools preserve the execution but lose the decision.**

A standard trade history can tell the user:

- entry;
- exit;
- size;
- fees;
- P&L;
- timestamp.

It usually cannot tell the user:

- what they believed;
- why they believed it;
- whether the conviction was original or borrowed;
- what evidence was available at the time;
- what the market environment was;
- whether the risk matched the intention;
- whether the outcome was earned or lucky;
- what should change next time.

## 2.8 Primary promise

> **Reflex helps you understand whether a trade was good, lucky, weak, or simply unlucky—and carries that lesson into the next decision.**

This promise must remain qualified by available evidence. Reflex should not pretend to know more than the captured decision, market context, execution data, and supporting history can show.

## 2.9 Difference

Reflex connects four things that are usually separated:

1. **What the trader believed**
2. **What influenced that belief**
3. **What actually happened**
4. **What should change next time**

The product is not merely a log of executions and not merely a chatbot that comments on trades. It is a feedback loop between intention, evidence, outcome, pattern, and future action.

## 2.10 Reason to believe

The PRD supports the promise through these intended capabilities:

- natural-language decision capture;
- user-confirmed Decision Snapshots;
- conviction-origin classification;
- source capture and source diversity review;
- Bitget market-context attachment;
- observed-versus-inferred distinction;
- immutable original decision records;
- chronological Decision Timelines;
- evidence-backed Decision Autopsies;
- process-versus-outcome classifications;
- Decision DNA with supporting decisions;
- sample-size-aware pattern detection;
- user-approved Playbook rules;
- version history;
- pre-trade recall;
- Decision Stress Tests;
- no automatic order placement.

These are reasons to believe only when the corresponding capabilities are implemented and exercised.

## 2.11 Emotional payoff

> **I can learn from the trade without lying to myself about why it worked or failed.**

Additional emotional outcomes:

- relief from relying on memory;
- confidence that is grounded rather than inflated;
- less shame after a loss;
- less false confidence after a lucky win;
- clearer separation between what is known and what is inferred;
- a sense that personal history is finally working for the trader.

## 2.12 Social payoff

> **I am building my own edge instead of blindly following someone else’s.**

Reflex should make the user feel more independent, not more dependent on an AI system.

## 2.13 Strategic enemy

### Primary enemy

> **P&L-only learning**

### Supporting enemies

- borrowed conviction;
- hindsight theatre;
- unexamined social confirmation;
- inconsistent manual journaling;
- dashboards that show data but return no lesson;
- black-box AI claims without evidence;
- the assumption that a winning trade validates every part of the process.

## 2.14 Strategic tensions

Reflex is strongest when it expresses these tensions:

### Fast markets versus slow learning

The market moves quickly. Useful reflection often arrives too late or never happens.

### Social noise versus personal judgment

A trader can hear a thesis from someone else without knowing whether they actually believe it themselves.

### Positive results versus weak process

The market can reward a bad decision.

### Negative results versus sound process

The market can punish a good decision.

### Automation versus agency

AI can structure, compare, and remind. The trader remains responsible for the final decision.

## 2.15 Brand principles

### Evidence before certainty

Reflex should show what supports a conclusion and where evidence is missing.

### Directness without humiliation

The product should tell the truth without turning review into punishment.

### Memory before hindsight

Preserve the decision before the result changes the narrative.

### Human authority

The AI can assist interpretation and recall. It must not silently take ownership of the decision.

### Useful evolution

Patterns become rules only through visible evidence and user approval.

### No invented confidence

A missing field is better than a fabricated answer.

## 2.16 Internal onlyness hypothesis

Use this internally as a strategic test, not as an unverified public superlative:

> **Reflex is built around the decision before the trade and the rule after the review.**

If a new feature does not strengthen one of those two moments, question whether it belongs in the core product.

---

# 3. Positioning

## 3.1 Recommended positioning statement

> **For active retail crypto and tokenized-equity traders who want to stop confusing P&L with skill, Reflex is an AI trading decision journal that captures the thinking behind each trade, separates process from outcome, and brings evidence-backed lessons back before similar decisions recur. Unlike signal feeds, trading bots, and traditional journals, Reflex tracks conviction source, decision quality, and personal rules while keeping the trader in control.**

## 3.2 Short positioning version

> **Reflex helps active traders learn from the decision behind every trade—not just the result.**

## 3.3 One-line product description

> **An AI trading decision journal that shows whether you were good, lucky, or simply unlucky.**

This line is intentionally direct. It speaks to the emotional question behind the product rather than listing technical features.

## 3.4 Category explanation

When someone asks, “What is Reflex?”, answer in this order:

1. **Category:** It is an AI trading decision journal.
2. **Audience:** It is for active retail traders.
3. **Primary job:** It helps them understand the process behind their trades.
4. **Distinctive mechanism:** It tracks conviction, evidence, outcome, recurring patterns, and approved rules.
5. **Boundary:** It does not place trades or promise returns.

## 3.5 Alternative descriptions by context

### Homepage

> The decision journal for active traders.

### App store or directory

> Review the thinking behind every trade, find repeating patterns, and carry better lessons into the next decision.

### Product tour

> Reflex turns your trade history into a personal feedback loop.

### Technical documentation

> A human-in-the-loop decision-intelligence layer for structured trade review, pattern detection, and user-approved playbook evolution.

### Investor or founder conversation

> Reflex is building the memory and accountability layer for AI-assisted retail trading.

### User conversation

> It helps you tell whether a trade was actually good—or whether you just got paid for a bad process.

## 3.6 What Reflex should not claim to be

Reflex is not:

- a buy/sell signal service;
- an autonomous trading agent;
- a financial adviser;
- a replacement for trader judgment;
- a psychological diagnostic system;
- a guaranteed improvement engine;
- a generic AI chat window;
- a P&L dashboard with a chatbot attached.

## 3.7 Positioning test

A stranger should be able to understand all of the following quickly:

- Reflex is related to trading;
- it helps review decisions;
- it focuses on process, not only P&L;
- it remembers patterns for future decisions;
- the trader remains in control.

If the audience instead thinks “AI bot that predicts trades,” the positioning is failing.

---

# 4. Brand core

## 4.1 Brand essence

> **Make the next decision more yours.**

This is the emotional territory Reflex should own.

It expresses:

- independence;
- learning;
- personal agency;
- relief from social noise;
- movement from reaction to intention;
- the right to make a final decision with better memory.

## 4.2 Internal brand truth

> **Every trade should leave a usable lesson.**

This is more operational than the brand essence. It can guide product decisions and content.

## 4.3 Existing PRD line

> **Every trade trains the next decision.**

Keep this line. It is a strong product truth.

Use it as:

- a supporting statement;
- a section heading;
- an onboarding principle;
- a product-tour closing line;
- a line in the brand narrative.

It is slightly less emotionally direct than “Make the next decision more yours,” so it should not carry the entire brand on its own.

## 4.4 Recommended tagline system

### Brand line

> **Make the next decision more yours.**

Job: emotional ownership and liberation.

### Product line

> **Every trade trains the next decision.**

Job: describe the feedback loop.

### Campaign line

> **Don’t let a green trade teach you the wrong lesson.**

Job: create tension and attention around the core problem.

Use one line at a time according to context. Do not stack all three beneath the logo.

## 4.5 Recommended landing-page hero

### Eyebrow

> **PERSONAL DECISION INTELLIGENCE FOR ACTIVE TRADERS**

### Headline

> **Don’t let a green trade teach you the wrong lesson.**

### Supporting copy

> **Your P&L tells you what happened. Reflex shows you what the trade actually taught you—what you believed, what influenced you, what the evidence supported, and what to remember before the next decision.**

### Primary CTA

> **Review a trade**

### Secondary CTA

> **See how Reflex works**

### Trust line

> **No signals. No automatic execution. No hindsight theatre. You stay in control.**

## 4.6 Tagline selection logic

“Make the next decision more yours” is recommended because it:

- speaks directly to the user;
- expresses a benefit rather than a feature;
- avoids financial guarantees;
- supports the independence story;
- works beyond crypto;
- can support campaigns and onboarding;
- gives the product a human reason to exist.

“Every trade trains the next decision” is recommended as the functional companion because it:

- expresses the product mechanism;
- connects outcome to future action;
- supports the self-evolution story without implying autonomy;
- is already grounded in the PRD.

“Don’t let a green trade teach you the wrong lesson” is recommended as a campaign line because it is memorable, specific, and rooted in the product’s strongest insight.

---

# 5. Messaging architecture

## 5.1 Messaging house

### Roof: core message

> **Reflex helps active traders learn from the process behind every trade, not just the outcome.**

### Pillar 1 — Capture the decision before the outcome edits it

#### Message

> Start with the trade as you actually remember it. Reflex turns ordinary language into a Decision Snapshot before the result changes the story.

#### User benefit

The user does not have to fill in a complex journal before receiving value.

#### Proof points

- Natural-language capture;
- editable structured fields;
- original text preserved;
- user-confirmed and AI-inferred fields separated;
- timestamped decision record;
- visible revision history.

#### Supporting copy

> **Write it as you remember it. Reflex will help structure the decision without pretending to know what you did not say.**

### Pillar 2 — Separate process from outcome

#### Message

> A profitable trade is not automatically a good decision. A losing trade is not automatically a bad one.

#### User benefit

The user receives a fairer explanation of what happened and what should be learned.

#### Proof points

- Decision Timeline;
- market context;
- Research Quality;
- Context Awareness;
- Risk Discipline;
- Execution Quality;
- Behavioral Control;
- Earned Win;
- Lucky Escape;
- Good Decision, Bad Outcome;
- Deserved Loss.

#### Supporting copy

> **The result is one fact. The decision is a chain of facts, assumptions, influences, and actions. Reflex reviews the chain.**

### Pillar 3 — See what keeps repeating

#### Message

> Reflex makes recurring edges, leaks, and influences visible across decisions.

#### User benefit

The user stops treating every mistake as an isolated event.

#### Proof points

- Decision DNA;
- supporting decisions;
- sample size;
- source-quality patterns;
- influence patterns;
- market-regime comparison;
- timing patterns;
- behavioural markers.

#### Supporting copy

> **One bad trade is an observation. Several similar decisions may be a pattern. Reflex shows the difference.**

### Pillar 4 — Carry the lesson forward

#### Message

> When a similar decision appears, Reflex brings the relevant lesson back before you repeat the pattern.

#### User benefit

The user does not have to remember every prior trade at the exact moment it matters.

#### Proof points

- Playbook proposals;
- user approval;
- version history;
- pre-trade recall;
- Decision Stress Test;
- relevance rationale;
- no automatic order placement.

#### Supporting copy

> **Your history is most useful before the next decision, not three weeks after it.**

### Foundation

> **Human agency, evidence before certainty, and no silent rewriting of the past.**

## 5.2 Messaging pillars in short form

- **Capture the thinking.**
- **Review the process.**
- **Find the pattern.**
- **Carry the lesson.**

This four-part structure can appear in navigation, product tours, landing-page sections, and pitch materials.

## 5.3 Message-to-proof rule

Every important public message should answer:

1. What user outcome does this describe?
2. What product behaviour supports it?
3. What evidence can the user inspect?
4. Is the capability shipped, targeted, or hypothetical?

If a message cannot answer those questions, simplify or remove it.

---

# 6. Message hierarchy

## 6.1 Five-second message

> **Reflex is an AI trading decision journal for active traders.**

## 6.2 Ten-second message

> **It captures why you took a trade, separates process from P&L, and brings your own lessons back before a similar decision.**

## 6.3 Fifteen-second pitch

> **Most trading tools tell you whether you made money. Reflex helps you understand whether the decision itself was sound, lucky, or flawed—and turns repeated patterns into rules you can use next time.**

## 6.4 Thirty-second pitch

> **Reflex is a human-in-the-loop AI decision journal for active retail traders. You describe a trade in your own words, Reflex captures the thesis, conviction source, evidence, risk, and market context, then reviews the result without letting P&L define the lesson. Over time it finds recurring edges and leaks, proposes personal rules, and recalls those rules before similar trades. It never places the trade for you.**

## 6.5 Sixty-second product narrative

> Traders are usually taught by their P&L. Green feels like confirmation. Red feels like failure. But a profitable trade can come from poor research, weak risk control, or social momentum—and a losing trade can still be an excellent decision.
>
> Reflex preserves the decision before hindsight takes over. It captures what the trader believed, where the conviction came from, what evidence was available, what the market was doing, and what the trader actually did. After the trade, it reconstructs the timeline, separates process from outcome, and explains the evidence behind the review.
>
> When the same pattern appears again, Reflex brings the lesson back. The trader remains the final decision-maker, but they no longer have to rely on memory alone.

## 6.6 Full product description

> Reflex is an AI trading decision journal for active retail traders. It lets traders describe a decision naturally, preserves the reasoning and influences behind it, attaches market and execution context, and reviews the trade without treating P&L as proof of skill. Reflex identifies recurring edges, leaks, and influence patterns, proposes user-approved Playbook rules, and recalls relevant history before a similar decision. It supports trader judgment; it does not replace it.

## 6.7 User-centric pain language

Use lines that make the user feel recognised:

- **You remember the win. Reflex remembers the decision.**
- **A green trade can still teach you the wrong lesson.**
- **You may have made money without making a good decision.**
- **You may have made a good decision and still lost.**
- **You do not need another opinion. You need a better memory of your own.**
- **Borrowed conviction feels like confidence until the trade moves against you.**
- **The timeline can tell you who called the trade. It cannot tell you whether you believed it.**
- **Your history already contains patterns. They are just difficult to see at the moment you need them.**
- **The lesson is most valuable before the next click.**

## 6.8 User-centric liberation language

Use lines that describe the emotional freedom Reflex creates:

- **Know what to keep, what to question, and what not to repeat.**
- **Build a process that belongs to you.**
- **Turn hindsight into a usable rule.**
- **Stop borrowing conviction. Start building evidence.**
- **Trade with your own history beside you.**
- **Make decisions you can explain before and after the outcome.**
- **Let the market give you feedback without letting it rewrite the story.**
- **Become less dependent on luck, memory, and the crowd.**

## 6.9 Audience-specific messages

### Social-led active trader

> **Stop letting the timeline become your trading plan. Reflex shows which decisions were independently supported and which were mainly social confirmation.**

### Developing disciplined trader

> **You do not need more motivation. You need a reliable way to see whether your process held.**

### Trader recovering from repeated mistakes

> **The pattern is easier to change when you can see it before the next decision.**

### Trader who overvalues winning trades

> **A win proves what happened. It does not prove why it happened.**

### Trader who overreacts to losses

> **A loss can be painful without being evidence that the decision was wrong.**

### Bitget-oriented user

> **Reflex adds memory and review to the trading workflow: capture the decision, attach Bitget context, review the process, and recall the lesson later.**

## 6.10 Objection responses

### “I already have a trading journal.”

> Traditional journals record what happened. Reflex helps preserve why it happened, what influenced it, and what should return before the next similar decision.

### “I can just use a spreadsheet.”

> A spreadsheet can store trades. Reflex is designed to structure messy reasoning, compare decisions, explain patterns, and return relevant history at the moment it matters.

### “I only care about P&L.”

> P&L tells you the result. Reflex helps you decide whether the result taught you something useful or rewarded a process you should not repeat.

### “I do not want an AI making trades for me.”

> It does not. Reflex can interpret, compare, and remind. You remain the final decision-maker.

### “I do not have enough trades for AI to learn from.”

> Reflex can show single-trade observations while clearly distinguishing them from established patterns. It should not turn one event into a permanent judgement.

### “This sounds judgmental.”

> Reflex is direct about the evidence, but it does not shame losses. The goal is to make the next decision clearer, not to punish the previous one.

### “Can it tell me what to buy?”

> Reflex is not primarily a signal product. It helps you examine and improve the process behind your own decisions.

## 6.11 Feature-to-value translations

### Natural-language capture

- Feature: describe a trade in ordinary language.
- Functional result: the system structures the reasoning.
- Practical outcome: less friction than a manual journal.
- Emotional meaning: the user can start honestly instead of performing expertise.

### Decision Snapshot

- Feature: structured, editable interpretation.
- Functional result: thesis, source, risk, and invalidation become visible.
- Practical outcome: the decision can be reviewed later without relying on memory.
- Emotional meaning: the user knows what they actually believed.

### Conviction-origin classification

- Feature: Original Research, Borrowed Conviction, Social Confirmation, or Pure Impulse.
- Functional result: influence becomes part of the record.
- Practical outcome: social dependence can be compared with outcomes.
- Emotional meaning: the user can distinguish confidence from borrowed certainty.

### Market Context Snapshot

- Feature: price, market state, context, source, and timestamp.
- Functional result: the decision is reviewed in its original environment.
- Practical outcome: less hindsight distortion.
- Emotional meaning: the review feels fairer.

### Decision Autopsy

- Feature: evidence-backed post-trade review.
- Functional result: process dimensions are scored and explained.
- Practical outcome: the user knows what to improve.
- Emotional meaning: the result becomes useful feedback rather than a verdict.

### Process/outcome classification

- Feature: Earned Win, Good Decision/Bad Outcome, Lucky Escape, Deserved Loss.
- Functional result: result and decision quality are separated.
- Practical outcome: fewer false lessons.
- Emotional meaning: honest confidence after wins and resilience after losses.

### Decision DNA

- Feature: recurring edges, leaks, and influence patterns.
- Functional result: repeated behaviour becomes visible.
- Practical outcome: the user can target specific changes.
- Emotional meaning: the trader feels known by their own evidence, not by a generic profile.

### Playbook

- Feature: proposed and versioned personal rules.
- Functional result: patterns become actionable constraints or reminders.
- Practical outcome: experience compounds into a reusable process.
- Emotional meaning: the trader is building an edge that belongs to them.

### Decision Stress Test

- Feature: pre-trade recall of relevant history and rules.
- Functional result: the past is surfaced before the decision.
- Practical outcome: repeated patterns can be interrupted.
- Emotional meaning: the trader feels less alone with the next decision.

---

# 7. How users move through the product

## 7.1 The emotional journey

The user should move through this sequence:

> **Noise → Clarity → Evidence → Truth → Pattern → Agency**

### Noise

The user arrives with an incomplete, emotional, or socially influenced thought.

### Clarity

Reflex turns the thought into a Decision Snapshot without forcing the user through a large form.

### Evidence

Sources, market context, timestamps, and execution data become visible.

### Truth

The review separates the outcome from the quality of the decision.

### Pattern

Repeated edges, leaks, and influences become visible across decisions.

### Agency

The user chooses whether to adopt a rule and receives a relevant reminder before a future decision.

## 7.2 Stage 1 — Start with a thought, not a form

The first experience should not be a blank dashboard or a 20-field research form.

### Opening copy

> **Start with what you were thinking.**

> You do not need the perfect trading plan. Tell Reflex what made you consider the trade.

### Primary paths

- **Capture a new decision**
- **Review a past trade**
- **Explore the demo**

### Empty-dashboard copy

> **Your decision history starts here.**
>
> Start with one trade. Reflex will help you preserve the thinking behind it and show you what becomes useful later.

## 7.3 Stage 2 — Decision Capture

The user writes naturally.

### Input label

> **What were you thinking?**

### Input placeholder

> “I bought rNVDA because…”

### Optional source prompt

> **What influenced you? Add a link, note, post, or source description if you have one.**

### AI response

> **Here’s what I heard. Change anything that’s wrong.**

### Incomplete-state copy

> **You do not need to fill everything in now. Reflex will only structure what it can support.**

### Missing-invalidation prompt

> **What would make this idea wrong?**

Supporting line:

> A clear invalidation point makes the later review more useful.

## 7.4 Stage 3 — Decision Snapshot

Recommended sections:

- **What I believed**
- **What influenced me**
- **Evidence I had**
- **What would prove me wrong**
- **How long I expected this to take**
- **How much I intended to risk**

### Snapshot introduction

> **This is the decision before the outcome.**

### Field status labels

- **You said**
- **Reflex inferred**
- **Confirmed by you**
- **Unavailable**

### Confirmation copy

> Once confirmed, this becomes the reference point for your future review. Reflex will not silently rewrite it.

### Confirmation CTA

> **Confirm this decision**

### Edit CTA

> **Correct the snapshot**

### Uncertainty copy

> Reflex is not sure how this field should be classified. Review it before continuing.

## 7.5 Stage 4 — Market Context

Show context as context, not prophecy.

### Context heading

> **Context, not a prediction.**

### Context explanation

> Reflex attaches the market information available at the time of the decision so the review does not rely only on hindsight.

### Missing-data copy

> **No reliable source found for this field. Reflex left it blank instead of filling the gap.**

### Timestamp copy

> **Observed at [time] from [source].**

### Market-state copy

> **Native market state: [open/closed/unavailable]**

Avoid language such as “the market clearly wanted higher prices” unless the user’s data explicitly supports that conclusion.

## 7.6 Stage 5 — Decision Receipt

Create a simple trust moment.

### Confirmation message

> **Decision saved before the outcome.**

### Supporting copy

> Your original reasoning is now preserved for review.

### Receipt metadata

- Captured at
- Confirmed at
- Source count
- Market context status
- Revision number

## 7.7 Stage 6 — Attach the outcome

### Heading

> **What happened next?**

### Supporting copy

> Add the result without changing what you originally believed. Your decision record stays intact.

### Data-source options

- **Import from Bitget**
- **Enter manually**
- **Use demo data**

### Source labels

- **Bitget-imported**
- **Manually entered**
- **Seeded demo data**

The source label must always be visible.

## 7.8 Stage 7 — Decision Timeline

Use the PRD’s strongest narrative structure:

> **What I believed → What I did → What changed → What happened → What I learned**

### Timeline introduction

> **Here is the decision in order.**

### Event labels

- **Decision captured**
- **Source added**
- **Market context observed**
- **Entry recorded**
- **Invalidation noted**
- **Execution event**
- **Exit recorded**
- **Post-trade context**

### Event-origin labels

- **Observed**
- **User-confirmed**
- **AI-inferred**
- **Unavailable**

## 7.9 Stage 8 — Decision Autopsy

The word “Autopsy” is memorable and can remain a distinctive product concept, but it must be supported by a calm, non-punitive explanation.

### Page heading

> **Decision Autopsy**

### Supporting line

> **No blame. Just evidence.**

### Result structure

> **+$428 P&L**
>
> **Decision Quality: 41/100**
>
> **LUCKY ESCAPE**

Use the numerical example only if the seeded demo data actually contains it.

### Explanation pattern

> The trade finished profitably, but the available evidence suggests the result depended more on favourable movement and social confirmation than on a fully defined process.

### Dimension labels

- **Research Quality** — Did the thesis have independent support?
- **Context Awareness** — Did the decision account for the market environment?
- **Risk Discipline** — Did the actual exposure match the intended risk?
- **Execution Quality** — Did the trade follow the plan?
- **Behavioral Control** — Did urgency, revenge, FOMO, or confirmation pressure affect the decision?

### Evidence CTA

> **Show the evidence behind this review**

### Explanation CTA

> **Why this rating?**

### Score limitation copy

> This score reflects the recorded evidence. It is not a permanent judgement about you or your trading ability.

## 7.10 Stage 9 — Decision DNA

Decision DNA should feel like a personal map, not a diagnosis.

### Introductory copy

> **Your edge is what repeats in your favour. Your leak is what repeats against you.**

### Supporting copy

> Reflex looks across your recorded decisions to find patterns in research, timing, risk, influence, and behaviour.

### Categories

- **Edges**
- **Leaks**
- **Influences**
- **Single-trade observations**

### Sample-size language

> **Emerging pattern — 3 supporting decisions**

> This is enough to review, not enough to call a certainty.

### One-trade language

> **Single-trade observation**

> This may become a pattern later. Reflex is keeping it visible without overclaiming.

### Evidence CTA

> **Show supporting decisions**

## 7.11 Stage 10 — Playbook evolution

### Introductory copy

> **A pattern is becoming a possible rule.**

### Proposed-rule copy

> **Before entering after a social-led move, record one independent reason, one invalidation point, and a maximum risk.**

This is an example rule. The final rule must be grounded in the user’s recorded evidence.

### Supporting sections

- **Trigger**
- **Pattern detected**
- **Supporting decisions**
- **Historical result**
- **Expected purpose**
- **Evidence strength**

### Actions

- **Add to my Playbook**
- **Need more evidence**
- **Dismiss for now**

Avoid “Activate rule” as the primary action. It sounds autonomous and makes the user feel that control is moving away from them.

### Version copy

> **Playbook rule v1 — added with your approval**

### Rejection copy

> **Kept in review history. Nothing was changed.**

### Deferred copy

> **Reflex will keep watching this pattern. No rule was added yet.**

## 7.12 Stage 11 — Pre-trade Stress Test

### Heading

> **Before you decide, here’s what your history recognizes.**

### Example warning

> This idea resembles three previous decisions where social confirmation arrived after the main move. In two of those decisions, the entry occurred without a recorded invalidation point.

### Agency statement

> **This is a reminder, not a prediction. You decide what happens next.**

### Actions

- **Review similar decisions**
- **Edit my decision**
- **Save this decision**
- **Continue to confirmation**

Avoid:

- Trade blocked
- Strong buy
- Strong sell
- Guaranteed warning
- High-probability failure
- Reflex says no

## 7.13 The complete user movement in one sentence

> **Reflex lets the trader say what they were thinking, see what the decision really contained, review what the outcome actually taught, turn repeated patterns into personal rules, and meet the next decision with better memory.**

---

# 8. Product copy library

## 8.1 Landing-page copy

### Hero

**Eyebrow**

> PERSONAL DECISION INTELLIGENCE FOR ACTIVE TRADERS

**Headline**

> Don’t let a green trade teach you the wrong lesson.

**Supporting paragraph**

> Your P&L tells you what happened. Reflex shows you what the trade actually taught you—what you believed, what influenced you, what the evidence supported, and what to remember before the next decision.

**Primary CTA**

> Review a trade

**Secondary CTA**

> See how Reflex works

**Trust line**

> No signals. No automatic execution. No hindsight theatre. You stay in control.

### Section: The problem

**Heading**

> A profitable trade can still teach you the wrong lesson.

**Body**

> Green does not always mean good. Red does not always mean wrong. Reflex helps you separate the quality of the decision from the luck of the outcome.

### Section: Capture

**Heading**

> Tell Reflex what you were thinking.

**Body**

> Start with a sentence, not a spreadsheet. Reflex turns your explanation into a Decision Snapshot you can review and correct.

### Section: Review

**Heading**

> See what actually happened.

**Body**

> Reconstruct the decision with market context, sources, execution events, and timestamps. Every conclusion points back to evidence.

### Section: Patterns

**Heading**

> Find the mistakes you keep renaming as bad luck.

**Body**

> Reflex compares decisions across conviction source, timing, market conditions, risk, and behaviour to reveal what repeats.

### Section: Playbook

**Heading**

> Turn experience into a rule you can use.

**Body**

> When the evidence is strong enough, Reflex proposes a Playbook rule. You approve it, reject it, or wait for more evidence.

### Section: Recall

**Heading**

> Get the lesson before the next click.

**Body**

> When a new decision looks familiar, Reflex brings the relevant history back before you repeat the pattern.

### Closing section

**Heading**

> Make the next decision more yours.

**Body**

> Your trading history already contains lessons. Reflex helps you find them, test them, and carry them forward.

**CTA**

> Review a trade

## 8.2 Onboarding copy

### Welcome

> **Trading gets noisy quickly. Reflex gives your decisions a memory.**

> Start with one trade. Tell us what you believed, what influenced you, and what you intended to risk.

### Path selection

> **Where should we start?**

- Capture a new decision
- Review a past trade
- Explore the demo

### First-capture prompt

> **What made this trade feel worth taking?**

### First-review prompt

> **What do you remember believing before the result?**

### Connection prompt

> **Connect data when you are ready. You can start without it.**

## 8.3 Navigation copy

- Decision Desk
- New Decision
- Reviews
- Decision DNA
- Playbook
- Connections

Avoid navigation labels such as:

- AI Insights
- Intelligence Hub
- Neural Review
- Smart Signals
- Autonomous Desk

They are less clear and more generic.

## 8.4 Button copy

### Primary actions

- Capture a decision
- Review a trade
- Confirm this decision
- Add to my Playbook
- Show the evidence
- Review similar decisions
- Continue to confirmation

### Secondary actions

- Correct the snapshot
- Add a source
- Add context
- View timeline
- See supporting decisions
- Need more evidence
- Dismiss for now
- Save for later

### Avoid

- Unlock insights
- Activate intelligence
- Optimise my trading
- Generate alpha
- Let AI decide
- Execute now
- Fix me

## 8.5 Empty states

### No decisions yet

> **Your decision history starts here.**
>
> Start with one trade. Reflex will help you preserve the thinking behind it and show you what becomes useful later.

### No completed reviews

> **Your first useful lesson is waiting for a result.**
>
> Capture a decision now, then attach the outcome when the trade is complete.

### No pattern yet

> **Nothing reliable is repeating yet.**
>
> Keep recording decisions. Reflex will not turn one trade into a personality.

### No Playbook rules

> **Your Playbook is still being earned.**
>
> Rules appear only when your recorded decisions provide enough evidence.

### No connected data

> **No account connection is required for the demo.**
>
> Continue with manual or seeded data, then connect Bitget when you are ready.

## 8.6 Evidence and provenance labels

### Observed

> Recorded from a connected source or user-provided data.

### Confirmed

> Reviewed and confirmed by you.

### Inferred

> Reflex’s interpretation based on the available evidence.

### Unavailable

> No reliable evidence was available. Reflex did not fill the gap.

### Evidence strength

- Emerging
- Moderate
- Strong
- Insufficient evidence

Supporting explanation:

> Evidence strength describes how much recorded information supports this interpretation. It is not a guarantee that the interpretation is correct.

## 8.7 Error and limitation copy

> **Reflex could not verify this market detail. The review can continue, but this part is unavailable.**

> **This conclusion is based on one recorded decision. Treat it as an observation, not a pattern.**

> **The source was captured, but Reflex cannot verify whether it was independent.**

> **The trade was imported, but the original reasoning was not recorded. Future reviews will be stronger if you capture the decision before entering.**

> **Some context is missing. Reflex will not invent it.**

> **This review is based on the current version of your recorded decision. Earlier versions remain available.**

## 8.8 Classification copy

### Earned Win

> The outcome was positive and the recorded process shows meaningful support for the decision.

### Good Decision, Bad Outcome

> The result was negative, but the available evidence suggests the decision followed a reasonable process.

### Lucky Escape

> The outcome was positive, but the available evidence suggests the process had meaningful weaknesses.

### Deserved Loss

> The outcome was negative and the recorded process shows significant weaknesses that likely contributed to the result.

### Important note

Classification is an explanation of the recorded decision and outcome. It is not a judgement of the trader as a person.

## 8.9 Notification copy

Notifications should be useful, not addictive or alarmist.

### Review reminder

> **You have one decision ready to review.**

### Pattern reminder

> **A new decision resembles a pattern in your history. Review it before you continue.**

### Rule proposal

> **Reflex found a possible Playbook rule. You decide whether it is ready.**

### Evidence reminder

> **This conclusion is missing supporting evidence. Add context or leave it unresolved.**

Avoid:

- You are about to lose.
- Reflex caught your bad trade.
- Do not enter.
- Urgent: market warning.
- Your psychology is failing.

## 8.10 Product-tour copy

### Capture

> Say what you were thinking. Reflex will help structure it.

### Snapshot

> Review the decision before the outcome changes your memory.

### Context

> See the market as it was when you decided.

### Autopsy

> Separate the quality of the decision from the result.

### DNA

> Find what keeps repeating.

### Playbook

> Turn evidence into a rule—with your approval.

### Stress Test

> Meet the next decision with better memory.

## 8.11 Copy for the human-in-the-loop boundary

> Reflex can interpret, compare, and remind. It does not make the final decision for you.

> AI can propose a pattern. You decide whether it has earned the status of a rule.

> Reflex does not place trades. It helps you examine the decision before you do.

> Your history informs the review. It does not control your future.

---

# 9. Verbal identity

## 9.1 Personality

Reflex should feel:

- clear-eyed;
- calm under volatility;
- direct without being cruel;
- evidence-led;
- quietly intelligent;
- protective of user agency;
- curious about causes;
- mature enough to handle losses.

Reflex should not feel:

- prophetic;
- macho;
- casino-like;
- smug;
- clinical;
- hollowly motivational;
- like a guru;
- like a compliance officer;
- like a generic AI chatbot.

## 9.2 Voice principles

### Principle 1 — Be precise, not prophetic

**Meaning**

Describe what the evidence shows without predicting the future with false certainty.

**Sounds like**

> This resembles two earlier late entries.

**Does not sound like**

> You are about to make the same mistake.

**Before**

> This trade is going to fail.

**After**

> This decision resembles two earlier entries where the move was already extended. Review the evidence before continuing.

### Principle 2 — Be direct, not humiliating

**Meaning**

Tell the truth about the decision without turning the review into an attack on the user.

**Sounds like**

> The outcome was positive, but the recorded process was weak.

**Does not sound like**

> You got lucky because you had no idea what you were doing.

**Before**

> Bad trade. You chased it.

**After**

> The entry followed social confirmation after the move had already extended. Reflex marked this as a possible late-entry pattern.

### Principle 3 — Separate evidence from interpretation

**Meaning**

Make it obvious which statements are observed facts and which are AI interpretations.

**Sounds like**

> Observed: native market closed at the time of entry. Inferred: the decision may have relied more heavily on social confirmation.

**Does not sound like**

> The market was clearly manipulated and you chased it.

### Principle 4 — Preserve agency

**Meaning**

The system assists the user without pretending to own the user’s decision.

**Sounds like**

> Here is what your history suggests. You remain the final decision-maker.

**Does not sound like**

> Reflex has blocked this trade.

### Principle 5 — Use plain language

**Meaning**

Use familiar words unless technical precision is necessary.

**Sounds like**

> The trade made money, but the risk was larger than planned.

**Does not sound like**

> Your risk-adjusted execution variance exceeded the intended exposure profile.

### Principle 6 — Give the user a next move

**Meaning**

Every important insight should lead to an understandable action.

**Sounds like**

> Add an invalidation point before you confirm this decision.

**Does not sound like**

> Risk discipline: 42.

## 9.3 Tone by context

### First use

- welcoming;
- low-friction;
- non-judgmental;
- encouraging without hype.

Example:

> Start with what you were thinking. You do not need a perfect plan.

### Capture

- curious;
- structured;
- patient.

Example:

> What made this trade feel worth taking?

### Confirmation

- careful;
- transparent;
- user-controlled.

Example:

> Here is what Reflex heard. Confirm or correct anything before continuing.

### Review

- direct;
- fair;
- evidence-led.

Example:

> The outcome was positive. The process was less supported than the result suggests.

### Loss

- respectful;
- useful;
- non-performative.

Example:

> This was a losing trade, but the recorded process included a clear thesis, defined invalidation, and controlled risk.

### Pattern detection

- cautious;
- specific;
- sample-size-aware.

Example:

> Three decisions point to an emerging late-entry pattern. Reflex is not treating it as a certainty yet.

### Rule proposal

- collaborative;
- optional;
- practical.

Example:

> This pattern may be ready for a rule. Add it to your Playbook or keep collecting evidence.

### Stress test

- timely;
- calm;
- interruptive without being authoritarian.

Example:

> Before you continue, here is what your history recognizes.

### Error or missing data

- honest;
- neutral;
- helpful.

Example:

> Reflex could not verify this market detail. It left the field blank instead of filling the gap.

## 9.4 Cadence

- Use short sentences for alerts, labels, and decisions.
- Use calm explanatory paragraphs for reviews.
- Use compact metadata for timestamps, sources, confidence, and versioning.
- Avoid excessive exclamation marks.
- Avoid motivational slogans after losses.
- Avoid overloaded AI jargon.
- Use a pause before the conclusion: evidence first, interpretation second, action third.

## 9.5 Vocabulary to use

- decision;
- thesis;
- source;
- evidence;
- context;
- process;
- outcome;
- pattern;
- rule;
- recall;
- confirmed;
- inferred;
- observed;
- unavailable;
- emerging;
- review;
- independent;
- borrowed;
- social confirmation;
- risk intention;
- invalidation;
- supporting decision.

## 9.6 Vocabulary to avoid

- next-generation;
- seamless;
- revolutionary;
- unlock your potential;
- AI-powered future;
- alpha machine;
- guaranteed;
- foolproof;
- predictive edge;
- trade smarter, not harder;
- emotional intelligence;
- psychological profile;
- knows you better than you know yourself;
- prevents bad trades;
- autonomous learning;
- never lose again;
- market-beating;
- institutional-grade, unless precisely substantiated.

## 9.7 Grammar and style rules

- Prefer active voice.
- Address the user as “you” where a direct action is required.
- Use “Reflex” as the subject when describing product behaviour.
- Do not call the AI “he,” “she,” or “they” as a personality unless a future character system is deliberately created.
- Use sentence case for UI labels.
- Use title case only for established product concepts such as Decision Snapshot and Decision DNA.
- Do not overuse the brand name in body copy.
- Avoid “we believe” when the product can state the evidence directly.
- Avoid absolute language.
- Use “may,” “suggests,” and “available evidence” when the conclusion is inferential.

---

# 10. Feature and product naming architecture

## 10.1 Master brand

> **Reflex**

The master brand name is locked.

Use the same casing everywhere:

- Reflex
- not REFLEX;
- not reflex;
- not Reflex AI;
- not Reflex.AI.

The wordmark may use a designed typographic treatment, but running copy should use **Reflex**.

## 10.2 Product descriptor

> **The decision journal for active traders.**

Do not attach “AI” to the master brand as a permanent suffix. AI is a capability inside the product, not the entire identity.

## 10.3 Information architecture

Recommended primary navigation:

- **Decision Desk** — home and current activity
- **New Decision** — capture flow
- **Reviews** — completed Decision Autopsies
- **Decision DNA** — recurring patterns
- **Playbook** — user-approved rules
- **Connections** — Bitget and data sources

## 10.4 Named product concepts

### Decision Snapshot

Definition: the structured, user-confirmed representation of what the trader believed before the outcome.

Use in copy:

> Review the Decision Snapshot before you confirm it.

### Decision Timeline

Definition: the chronological sequence of decision, evidence, market context, execution, outcome, and post-trade events.

Use in copy:

> Follow the Decision Timeline from belief to outcome.

### Decision Autopsy

Definition: the evidence-backed post-trade review.

Use in copy:

> Open the Decision Autopsy to separate process from outcome.

Navigation may use **Reviews** for approachability, with **Decision Autopsy** as the page title.

### Decision DNA

Definition: the recurring edges, leaks, and influence patterns visible across recorded decisions.

Use in copy:

> Decision DNA shows what keeps repeating.

Always explain that Decision DNA is a pattern view, not a psychological diagnosis.

### Playbook

Definition: the collection of personal trading rules accepted by the user.

Use in copy:

> Add a rule to your Playbook with your approval.

### Decision Stress Test

Definition: the pre-trade recall experience that surfaces relevant prior decisions, patterns, and rules.

Use in copy:

> Run a Decision Stress Test before you continue.

### Evidence Drawer

Definition: the expandable source and rationale area behind an AI conclusion.

Use in copy:

> Open the Evidence Drawer to see why Reflex reached this interpretation.

## 10.5 Naming rules

- Use descriptive names for screens.
- Reserve distinctive names for concepts users will encounter repeatedly.
- Do not create a sub-brand for every feature.
- Do not add “AI” to every label.
- Do not use fantasy names that hide the product’s function.
- Do not name an inference as though it were a factual diagnosis.
- Do not turn “pattern” into “truth.”
- Do not use “agent” for a feature that only summarises or retrieves information.

## 10.6 Naming glossary

### Decision

A recorded intention or proposed trade, whether or not it becomes an executed trade.

### Decision Snapshot

The structured and confirmed pre-outcome record.

### Outcome

What happened after the decision, including execution and realised result where available.

### Process quality

The quality of research, context awareness, risk discipline, execution, and behavioural control visible in the evidence.

### Pattern

A repeated relationship across more than one decision, with sample size shown.

### Edge

A recurring condition associated with better process or outcome in the user’s recorded history. Do not imply causal certainty.

### Leak

A recurring condition associated with weaker process or outcome in the user’s recorded history. Do not use it as an insult.

### Playbook rule

A personal rule the user has accepted after reviewing supporting evidence.

### Stress Test

A pre-trade review that challenges a proposed decision with relevant personal history.

---

# 13. Claims discipline

## 13.1 Source-of-truth rule

Every public claim must be classified as one of:

- **Shipped** — implemented and exercised;
- **Target** — specified for the current MVP but not yet verified as shipped;
- **Roadmap** — intentionally deferred;
- **Hypothesis** — an assumption to be tested.

Do not collapse these categories in landing pages, pitch decks, product tours, or demos.

## 13.2 Safe claims

Use these types of claims when the underlying capability is available:

- Reflex surfaces recurring patterns in your recorded decisions.
- Reflex proposes Playbook rules based on available evidence.
- Reflex helps separate process quality from trade outcome.
- Reflex retrieves similar decisions and explains why they were selected.
- Reflex preserves the original Decision Snapshot.
- Reflex distinguishes observed facts from AI inference.
- Reflex keeps the trader in control.
- Reflex does not place trades.

## 13.3 Claims that require evidence

Do not use these without actual supporting data:

- Reflex improves profitability.
- Reflex prevents bad trades.
- Reflex understands your psychology.
- Reflex detects your emotional state.
- Reflex knows your edge automatically.
- Reflex makes you a better trader.
- Reflex catches every mistake.
- Reflex removes bias.
- Reflex produces superior decisions.
- Reflex predicts what the market will do.

## 13.4 Claims to avoid completely

- guaranteed improvement;
- risk-free trading;
- automatic profitability;
- never lose again;
- eliminates emotion;
- replaces a trader;
- financial advice;
- clinically understands the user;
- mathematically proves the decision was correct.

## 13.5 Recommended trust statement

> **Reflex does not promise better outcomes. It helps you build better feedback.**

## 13.6 AI limitation language

Use:

> Reflex’s interpretation is based on the information available in the recorded decision, market context, execution data, and retrieved history.

> If evidence is missing, Reflex will show the gap rather than fill it with an invented answer.

> A confidence score describes support for an interpretation. It does not guarantee that the interpretation is correct.

> A detected pattern is not a permanent trait. It is a relationship in the recorded data that may become clearer or weaker over time.

## 13.7 Financial-boundary language

> Reflex is a decision-review and decision-support product. It is not financial advice and does not place trades.

> Market outcomes are uncertain. A high-quality decision can lose money, and a weak decision can make money.

> Historical patterns are not guarantees of future results.

## 13.8 Evidence display requirements

Every high-impact conclusion should expose:

- the supporting decision or decisions;
- source and timestamp;
- observed versus inferred status;
- sample size;
- confidence or evidence strength;
- the relevant field or event that produced the conclusion.

## 13.9 Safe replacement language

Instead of:

> Reflex knows you are chasing.

Use:

> The recorded entry followed a rapid move and social confirmation. Reflex marked this as a possible late-entry pattern.

Instead of:

> Reflex stopped a bad trade.

Use:

> Reflex surfaced a prior pattern before you continued. You remained the final decision-maker.

Instead of:

> Reflex learns your trading psychology.

Use:

> Reflex compares recurring patterns in your recorded decisions.

Instead of:

> Reflex finds your winning strategy.

Use:

> Reflex helps identify conditions associated with stronger or weaker decisions in your recorded history.

---

# 14. Highest-priority messaging and product decisions

## P0 — Lock the golden language loop

Use this sequence consistently:

1. **Capture the thinking**
2. **Confirm the decision**
3. **Review the process**
4. **Find the pattern**
5. **Carry the lesson**

This should appear across:

- onboarding;
- the landing page;
- the product tour;
- navigation;
- demo narration;
- pitch copy;
- empty states;
- help text.

## P0 — Lock the hero message

Use:

> **Don’t let a green trade teach you the wrong lesson.**

Supporting line:

> **Your P&L tells you what happened. Reflex shows you what the trade actually taught you.**

## P0 — Lock the product boundary

Use:

> **Reflex can interpret, compare, and remind. You remain the final decision-maker.**

This should be visible in the product, not buried in legal copy.

## P0 — Lock the evidence language

Every major AI message must use one of these statuses:

- Observed
- Confirmed
- Inferred
- Unavailable

Do not launch a polished interface that hides these distinctions.

## P0 — Lock the review language

The product must consistently separate:

- outcome;
- decision quality;
- evidence;
- confidence;
- next action.

Do not let a large P&L number dominate the review so strongly that the process/outcome distinction disappears.

## P0 — Lock the rule language

Playbook rules must be:

- proposed, not silently activated;
- versioned;
- tied to supporting decisions;
- optional;
- written in behavioural language;
- visible after acceptance.

## P1 — Build a content system

Create reusable content tokens for:

- page titles;
- section headings;
- explanations;
- button labels;
- evidence states;
- source labels;
- error messages;
- classification descriptions;
- pattern strength;
- confidence language;
- rule status;
- user actions.

Do not let each screen invent its own vocabulary.

## P1 — Replace generic AI copy

Remove or rewrite phrases such as:

- AI-powered insights;
- smart trading intelligence;
- unlock your edge;
- next-generation decision support;
- seamless learning;
- automated intelligence.

Replace them with specific user outcomes:

- Review the process behind a trade.
- See what influenced the decision.
- Compare this decision with similar ones.
- Add a rule to your Playbook.
- Review the evidence behind this conclusion.

## P1 — Keep the first-use path low-friction

The user should receive value from ordinary language before being asked to complete structured fields.

Required copy principle:

> **Start with a thought, then progressively add structure.**

## P2 — Expand only after the loop works

Potential later additions should not displace the core loop:

- more integrations;
- richer source capture;
- additional market context;
- advanced pattern filters;
- mentor or community features;
- extended Playbook logic.

The core message should remain stable as the product expands.

---

# 15. Tests before locking the system

## 15.1 Five-second comprehension test

Show the landing page for five seconds. Ask:

> What does Reflex do?

Expected answer:

> It helps traders review their decisions and learn from them.

Failure answers:

- It is an AI trading bot.
- It predicts the market.
- It is a crypto dashboard.
- It is a social trading app.
- I am not sure.

## 15.2 Ten-second message test

Show only the hero headline and supporting line. Ask:

> Who is this for, and what problem does it solve?

Expected answer:

> It is for traders who want to understand whether their decisions were good or lucky and avoid repeating patterns.

## 15.3 Lucky-versus-good test

Show a profitable trade with low decision quality. Ask:

> Was this trade good, lucky, or bad?

The user should understand that P&L and decision quality are separate.

## 15.4 Evidence test

Show an AI conclusion. Ask:

> Why did Reflex say this?

The user should be able to find:

- source;
- timestamp;
- supporting decision;
- observed/inferred status;
- evidence strength.

## 15.5 Agency test

Ask:

> Who makes the final trade decision?

The expected answer must be:

> I do.

If the user says “Reflex,” the product boundary is unclear.

## 15.6 Recall test

Show a new proposed trade and ask:

> Why did Reflex show me these previous decisions?

The user should understand the relevance rationale without needing technical knowledge of embeddings or retrieval.

## 15.7 Shame test

Show a losing trade and ask:

> Does this feel like the product is judging you?

Reflex should be direct about the evidence but should not humiliate the user.

## 15.8 Repeatability test

Give the same natural-language decision to different reviewers or test users. The product language should lead them to the same general interpretation, while still making uncertainty visible.

## 15.9 Copy specificity test

For every headline or feature statement, ask:

> Could a generic AI trading app say this?

If yes, rewrite it with:

- the user’s pain;
- a concrete product behaviour;
- a clear outcome;
- evidence or a boundary.

## 15.10 Claims test

For every public claim, record:

- claim;
- status: shipped, target, roadmap, or hypothesis;
- supporting evidence;
- owner of verification;
- last reviewed date.

Do not publish claims that have no status or evidence.

## 15.11 Copy acceptance checklist

Before shipping a screen, check:

- Is the user’s job clear?
- Does the first sentence explain what is happening?
- Is the next action obvious?
- Are facts separated from inference?
- Is the copy specific to Reflex?
- Does it avoid financial guarantees?
- Does it preserve the user’s agency?
- Does it avoid shame?
- Does it use the approved vocabulary?
- Does it work without the surrounding design context?
- Could the user repeat the idea accurately to someone else?

---

# 16. Final recommendation

Lock the following messaging system:

- **Master brand:** Reflex
- **Public category:** AI trading decision journal
- **Strategic category:** Personal trading decision intelligence
- **Descriptor:** The decision journal for active traders
- **Priority audience:** Active retail crypto and tokenized-equity traders becoming more independent
- **Core enemy:** P&L-only learning
- **Brand essence:** Make the next decision more yours
- **Product truth:** Every trade trains the next decision
- **Primary hero:** Don’t let a green trade teach you the wrong lesson
- **Supporting hero:** Your P&L tells you what happened. Reflex shows you what the trade actually taught you.
- **Core loop:** Capture the thinking → Confirm the decision → Review the process → Find the pattern → Carry the lesson
- **Distinctive mechanism:** Decision provenance, process/outcome separation, evidence-backed pattern detection, approved rule recall
- **Primary user boundary:** Reflex can interpret, compare, and remind. The trader remains the final decision-maker.

## Da Vinci verdict

**Strong and ready to systemise.**

### Strongest asset

Reflex preserves the decision before hindsight and returns the lesson before repetition.

### Biggest weakness

The technical category language can make the product sound like another AI trading system instead of a personal decision-memory product.

### Highest-leverage change

Make the entire brand communicate one human benefit:

> **Reflex helps you become less dependent on luck, memory, and other people’s conviction.**

### Main risk

Overclaiming what the AI “knows.” The product becomes more credible when it says:

> **Here is what the available evidence suggests.**

rather than:

> **Here is the truth about your psychology.**

### Confidence

High on the strategic direction. Medium on final wording until tested with active traders.

### What must be tested

- five-second comprehension;
- whether users understand the process/outcome distinction;
- whether “Lucky Escape” feels useful rather than humiliating;
- whether users trust observed/inferred labels;
- whether the Playbook proposal feels empowering rather than controlling;
- whether the primary hero makes the product feel like a decision journal rather than a trading bot.
