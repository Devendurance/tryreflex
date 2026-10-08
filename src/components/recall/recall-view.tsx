"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { ApiError, api, ASSET_CLASSES, ORIGINS, type AssetClass, type OriginLabel } from "@/components/decisions/decision-api";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";

type Item = { id: string; text: string; sourceIds: string[] };
type Pattern = { id: string; category: string; status: string; evidenceCount: number; description: string; supportingReviewIds: string[] };
type Rule = { id: string; title: string; trigger: string; ruleText: string; maturity: "experimental" | "pattern_backed" | null };
type Memory = {
  decisionId: string;
  reviewId: string | null;
  symbol: string | null;
  lifecycle: { meaning: string };
  rawInput: string;
  origins: { label: OriginLabel; basis: "inference" | "user_confirmed" }[];
  outcome: "positive" | "negative" | "break_even" | "unknown";
};
type RecallResult = {
  proposedTrade: { rawText: string; symbol: string | null; context: Record<string, string> | null; durableProposalCreated: false };
  summary: { historyStatus: "empty" | "sparse" | "multiple_retrieved_sources"; retrievedIndependentDecisionCount: number; recurrence: string; retrievalMeaning: string };
  historicalMemories: Memory[];
  dnaObservations: Pattern[];
  emergingPatterns: Pattern[];
  establishedPatterns: Pattern[];
  acceptedPlaybookRules: Rule[];
  watchpoints: Item[];
  questions: Item[];
  missingInformation: { exitCondition: boolean; invalidationCondition: boolean; verifiedProposedDecisionTimeContext: boolean; historicalFinancialOutcomeUnknown: boolean };
  sourceReferences: { entityType: string; entityId: string }[];
  explanation: { mode: "model_selected" | "deterministic_fallback" | "deterministic_empty_or_no_relevant_history" };
};

const SYMBOL = /^[A-Za-z0-9._-]{1,40}$/;
const inputClass =
  "mt-1.5 w-full rounded-[10px] border border-hairline bg-white px-3 text-[15px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none aria-[invalid=true]:border-loss disabled:opacity-60";

const MODE = {
  model_selected: { tag: "Ordered with AI help", text: "Reflex used AI only to put these cards in order of relevance. Every fact and question was written by Reflex from your records. The AI added nothing." },
  deterministic_fallback: { tag: "Standard order", text: "The relevance step didn't finish, so the cards are in their standard order. Nothing is missing: every watchpoint and question below is complete." },
  deterministic_empty_or_no_relevant_history: { tag: "No personal history yet", text: "Reflex hasn't learned anything from your reviewed decisions that matches this idea yet. The questions below are general prompts, not personal insight." },
};

function errorMessage(error: unknown): string {
  const { status } = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 400) return "Reflex couldn't accept that input. Check the fields and try again.";
  if (status === 413) return "That's longer than Reflex can read at once. Shorten it and try again.";
  if (status === 429) return "Reflex is busy right now. Wait a moment, then try again.";
  if (status === 503) return "Reflex couldn't search your memory right now, so it can't say whether anything relevant exists. Nothing was saved. Try again.";
  return "Something went wrong. Nothing was saved. Try again.";
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[14px] font-medium text-ink">
        {label} <span className="font-normal text-muted">(optional)</span>
      </label>
      {children}
      {(error ?? hint) && <p className={`mt-1 text-[13px] ${error ? "text-loss" : "t-caption"}`}>{error ?? hint}</p>}
    </div>
  );
}

function List({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <Panel id={id} title={title}>
      {note && <p className="mb-4 text-[14px] leading-[22px]">{note}</p>}
      {children}
    </Panel>
  );
}

function PatternList({ patterns, label }: { patterns: Pattern[]; label: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {patterns.map((pattern) => (
        <li key={pattern.id} className="rounded-[12px] border border-hairline p-4">
          <div className="flex flex-wrap gap-2">
            <Tag>{label}</Tag>
            <span className="t-caption">
              <span className="t-data">{pattern.evidenceCount}</span> reviewed decision{pattern.evidenceCount === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-[24px] text-ink">{pattern.description}</p>
        </li>
      ))}
    </ul>
  );
}

function Result({ result }: { result: RecallResult }) {
  const mode = MODE[result.explanation.mode];
  const missing = [
    result.missingInformation.exitCondition && "An exit condition or take-profit",
    result.missingInformation.invalidationCondition && "What would prove the idea wrong",
    result.missingInformation.verifiedProposedDecisionTimeContext && "Verified market context for right now",
    result.missingInformation.historicalFinancialOutcomeUnknown && "The financial result of a recalled past decision",
  ].filter(Boolean) as string[];
  const context = result.proposedTrade.context ?? {};

  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <FormNotice tone="success">
        <span className="font-medium">{mode.tag}.</span> {mode.text}
      </FormNotice>

      <Panel id="recall-proposal" title="Your idea" aside={<Tag>Not saved</Tag>}>
        <blockquote className="border-l-2 border-ink/70 pl-4 text-[16px] leading-[27px] whitespace-pre-wrap text-ink break-words">{result.proposedTrade.rawText}</blockquote>
        {(result.proposedTrade.symbol || Object.keys(context).length > 0) && (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
            {result.proposedTrade.symbol && (
              <div>
                <dt className="t-eyebrow text-[11px]">Symbol</dt>
                <dd className="t-data mt-1 text-ink">{result.proposedTrade.symbol}</dd>
              </div>
            )}
            {(
              [
                ["assetClass", "Asset class"],
                ["takeProfit", "Take-profit"],
                ["invalidation", "Invalidation"],
                ["marketContext", "Market context"],
              ] as const
            ).map(([key, label]) =>
              context[key] ? (
                <div key={key} className="min-w-0">
                  <dt className="t-eyebrow text-[11px]">{label}</dt>
                  <dd className="mt-1 break-words text-ink">{key === "assetClass" ? ASSET_CLASSES[context[key] as AssetClass] : context[key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
        <p className="t-caption mt-4">Reflex didn&rsquo;t keep this idea or create a trade. What you typed here is taken as your own unverified description.</p>
      </Panel>

      <List id="recall-questions" title="Questions to answer before you act">
        <ol className="flex flex-col gap-3">
          {result.questions.map((question, index) => (
            <li key={question.id} className="flex gap-3 text-[16px] leading-[25px] text-ink">
              <span className="t-data mt-0.5 text-[14px] text-muted">{index + 1}</span>
              {question.text}
            </li>
          ))}
        </ol>
      </List>

      {result.watchpoints.length > 0 && (
        <List id="recall-watchpoints" title="Watchpoints from your history" note={result.summary.recurrence}>
          <ul className="flex flex-col gap-3">
            {result.watchpoints.map((item) => (
              <li key={item.id} className="border-l-2 border-orange pl-3 text-[15px] leading-[24px] text-ink">
                {item.text}
              </li>
            ))}
          </ul>
        </List>
      )}

      {result.historicalMemories.length > 0 && (
        <List id="recall-memories" title="Past decisions that came to mind" note={result.summary.retrievalMeaning}>
          <ul className="flex flex-col gap-3">
            {result.historicalMemories.map((memory) => (
              <li key={memory.decisionId} className="rounded-[12px] border border-hairline p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-medium text-ink">{memory.symbol ?? "Asset not set"}</span>
                  <Tag>{memory.outcome === "unknown" ? "Outcome unknown" : memory.outcome === "positive" ? "Gain" : memory.outcome === "negative" ? "Loss" : "Break-even"}</Tag>
                  {memory.origins.map((origin) => (
                    <Tag key={`${origin.label}-${origin.basis}`} tone={origin.basis === "user_confirmed" ? "confirmed" : "inferred"}>
                      {ORIGINS[origin.label]?.name ?? origin.label}
                      {origin.basis === "inference" ? " (inferred)" : ""}
                    </Tag>
                  ))}
                </div>
                <p className="mt-2 line-clamp-3 text-[14px] leading-[22px] break-words">{memory.rawInput}</p>
                <p className="t-caption mt-1">{memory.lifecycle.meaning}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 text-[14px]">
                  <Link href={`/app/decisions/${memory.decisionId}`} className="underline underline-offset-4">Decision</Link>
                  {memory.reviewId && <Link href={`/app/autopsies/${memory.reviewId}`} className="underline underline-offset-4">Autopsy</Link>}
                </p>
              </li>
            ))}
          </ul>
        </List>
      )}

      {result.dnaObservations.length > 0 && (
        <List id="recall-observations" title="Observations" note="Each seen in a single reviewed decision. Not a habit.">
          <PatternList patterns={result.dnaObservations} label="Observation" />
        </List>
      )}
      {result.emergingPatterns.length > 0 && (
        <List id="recall-emerging" title="Emerging patterns" note="Seen in 2 to 3 reviewed decisions. Not established.">
          <PatternList patterns={result.emergingPatterns} label="Emerging" />
        </List>
      )}
      {result.establishedPatterns.length > 0 && (
        <List id="recall-established" title="Established patterns" note="Recurring in your records. Whether they apply to this idea is for you to judge.">
          <PatternList patterns={result.establishedPatterns} label="Established" />
        </List>
      )}
      {result.acceptedPlaybookRules.length > 0 && (
        <List id="recall-rules" title="Your Playbook rules that may apply" note="Check whether each trigger really fits this idea.">
          <ul className="flex flex-col gap-3">
            {result.acceptedPlaybookRules.map((rule) => (
              <li key={rule.id} className="rounded-[12px] border border-hairline p-4">
                <p className="text-[16px] font-medium text-ink">{rule.title}</p>
                <p className="mt-1 text-[14px] leading-[22px]">When: {rule.trigger}</p>
                <p className="mt-1 text-[15px] leading-[24px] text-ink">{rule.ruleText}</p>
              </li>
            ))}
          </ul>
        </List>
      )}

      <List id="recall-missing" title="What Reflex doesn't know">
        {missing.length === 0 ? (
          <p className="text-[15px]">Nothing flagged as missing.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[15px] text-ink">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p className="t-caption mt-3">
          Based on <span className="t-data">{result.summary.retrievedIndependentDecisionCount}</span> recalled decision{result.summary.retrievedIndependentDecisionCount === 1 ? "" : "s"} and{" "}
          <span className="t-data">{result.sourceReferences.length}</span> source record{result.sourceReferences.length === 1 ? "" : "s"}. This isn&rsquo;t advice to trade.
        </p>
      </List>
    </div>
  );
}

export function RecallView() {
  const [text, setText] = useState("");
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<"" | AssetClass>("");
  const [takeProfit, setTakeProfit] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [marketContext, setMarketContext] = useState("");
  const [errors, setErrors] = useState<{ text?: string; symbol?: string }>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecallResult | null>(null);
  const inFlight = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const found: typeof errors = {};
    if (!text.trim()) found.text = "Describe the trade you're considering first.";
    if (symbol && !SYMBOL.test(symbol.trim())) found.symbol = "Letters, numbers, dots, dashes or underscores only.";
    setErrors(found);
    if (Object.keys(found).length) return;
    const context = Object.fromEntries(
      (
        [
          ["assetClass", assetClass],
          ["takeProfit", takeProfit.trim()],
          ["invalidation", invalidation.trim()],
          ["marketContext", marketContext.trim()],
        ] as const
      ).filter(([, value]) => value),
    );
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      setResult(
        await api<RecallResult>("/api/recall", {
          method: "POST",
          body: JSON.stringify({ text, ...(symbol.trim() ? { symbol: symbol.trim() } : {}), ...(Object.keys(context).length ? { context } : {}) }),
        }),
      );
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="t-eyebrow">Pre-Trade Recall</p>
        <h1 className="t-h2 mt-3">Check an idea against what you&rsquo;ve learned.</h1>
        <p className="t-lead mt-3 max-w-[62ch]">
          Describe a trade you&rsquo;re considering. Reflex brings back relevant reviewed decisions, patterns and your accepted rules, then asks what you still need to answer. Nothing is saved and no trade is placed.
        </p>
      </header>
      <form onSubmit={submit} noValidate className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6" aria-busy={pending}>
        <label htmlFor="recall-text" className="text-[20px] leading-7 font-medium text-ink">
          What are you thinking of doing, and why?
        </label>
        <textarea
          id="recall-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={8000}
          disabled={pending}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={errors.text ? "recall-text-error" : undefined}
          placeholder="I'm thinking of buying… because…"
          className="mt-3 min-h-[180px] w-full resize-y rounded-[12px] border border-hairline bg-cream/40 p-5 text-[17px] leading-[28px] text-ink outline-none placeholder:text-[rgba(36,27,21,.45)] focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none aria-[invalid=true]:border-loss disabled:opacity-60"
        />
        {errors.text && (
          <p id="recall-text-error" className="mt-1 text-[13px] text-loss">
            {errors.text}
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="recall-symbol" label="Symbol" error={errors.symbol}>
            <input id="recall-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} maxLength={40} disabled={pending} aria-invalid={errors.symbol ? true : undefined} autoCapitalize="characters" spellCheck={false} className={`${inputClass} t-data h-11`} />
          </Field>
          <Field id="recall-asset" label="Asset class">
            <select id="recall-asset" value={assetClass} onChange={(event) => setAssetClass(event.target.value as "" | AssetClass)} disabled={pending} className={`${inputClass} h-11`}>
              <option value="">Not specified</option>
              {Object.entries(ASSET_CLASSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="recall-tp" label="Take-profit or exit plan">
            <input id="recall-tp" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} maxLength={1000} disabled={pending} className={`${inputClass} h-11`} />
          </Field>
          <Field id="recall-inv" label="What would prove you wrong">
            <input id="recall-inv" value={invalidation} onChange={(event) => setInvalidation(event.target.value)} maxLength={1000} disabled={pending} className={`${inputClass} h-11`} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="recall-ctx" label="Market context you're seeing" hint="Taken as your description, not verified data.">
              <textarea id="recall-ctx" value={marketContext} onChange={(event) => setMarketContext(event.target.value)} maxLength={2000} rows={2} disabled={pending} className={`${inputClass} resize-y py-2.5 leading-[23px]`} />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {pending ? "Recalling" : "Recall my history"}
          </button>
          {pending && (
            <p role="status" className="text-[14px]">
              Searching your reviewed decisions, patterns and rules.
            </p>
          )}
        </div>
        {error && (
          <div className="mt-4">
            <FormNotice tone="error">{error}</FormNotice>
          </div>
        )}
      </form>
      {result && <Result result={result} />}
    </div>
  );
}
