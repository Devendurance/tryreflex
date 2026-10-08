"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { buttonClass } from "@/components/landing/primitives";
import { api, apiErrorMessage, formatDate, type DecisionSummary } from "./decision-api";
import { StatusBadge } from "./decision-parts";

const MAX_CHARS = 32768;
const PROMPTS = [
  "What are you trading, and which direction?",
  "Why now? What do you expect to happen?",
  "Where did the idea come from: your own work, a person, a group, or a feeling?",
  "What would prove you wrong?",
  "How much are you willing to risk?",
];

function Composer() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const empty = text.trim().length === 0;

  const submit = async () => {
    if (inFlight.current) return;
    if (empty) return setError("Write a few sentences about the decision first.");
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api<{ decision: { id: string } }>("/api/decisions/parse", { method: "POST", body: JSON.stringify({ text }) });
      router.push(`/app/decisions/${result.decision.id}`);
    } catch (thrown) {
      setError(apiErrorMessage(thrown, "parse"));
      inFlight.current = false;
      setPending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6" aria-busy={pending}>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="flex min-w-0 flex-col gap-3">
          <label htmlFor="rationale" className="text-[20px] leading-7 font-medium text-ink">
            Describe the decision in your own words
          </label>
          <p id="rationale-help" className="text-[14px] leading-[22px]">
            Write it the way you&rsquo;d explain it to a friend. Reflex keeps your exact words and reads the structure out of them. Nothing is decided for you.
          </p>
          <textarea
            id="rationale"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_CHARS}
            disabled={pending}
            aria-describedby="rationale-help rationale-count"
            aria-invalid={error !== null && empty}
            placeholder="I'm buying… because…"
            className="min-h-[240px] w-full resize-y rounded-[12px] border border-hairline bg-cream/40 p-5 text-[17px] leading-[28px] text-ink outline-none placeholder:text-[rgba(36,27,21,.45)] focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id="rationale-count" className="t-caption">
              <span className="t-data">{text.length.toLocaleString()}</span> characters
              <span className="hidden sm:inline"> · Ctrl or ⌘ + Enter to read</span>
            </p>
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              {pending && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {pending ? "Reading your decision" : "Read my decision"}
            </button>
          </div>
          {pending && (
            <p role="status" className="text-[14px]">
              Reflex is reading your text. This usually takes a few seconds.
            </p>
          )}
          {error && <FormNotice tone="error">{error}</FormNotice>}
        </div>
        <aside aria-labelledby="prompts-title" className="border-t border-hairline pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <h2 id="prompts-title" className="t-eyebrow">
            If you&rsquo;re stuck, answer these
          </h2>
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-[22px]">
            {PROMPTS.map((prompt) => (
              <li key={prompt} className="border-l-2 border-hairline pl-3">
                {prompt}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </form>
  );
}

type ListState = { kind: "loading" } | { kind: "ready"; decisions: DecisionSummary[]; hasMore: boolean } | { kind: "error"; message: string };

function RecentDecisions() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const result = await api<{ decisions: DecisionSummary[]; hasMore: boolean }>("/api/decisions?limit=20");
      setState({ kind: "ready", ...result });
    } catch (thrown) {
      setState({ kind: "error", message: apiErrorMessage(thrown, "list") });
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of owner-scoped decisions
  useEffect(() => void load(), [load]);

  return (
    <section aria-labelledby="recent-title">
      <h2 id="recent-title" className="text-[20px] leading-7 font-medium text-ink">
        Recent decisions
      </h2>
      <div className="mt-4" aria-live="polite">
        {state.kind === "loading" && (
          <p className="inline-flex items-center gap-2 text-[14px]">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading your decisions
          </p>
        )}
        {state.kind === "error" && (
          <FormNotice tone="error">
            {state.message}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-4">
              Try again
            </button>
          </FormNotice>
        )}
        {state.kind === "ready" && state.decisions.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-hairline p-6 text-[15px]">
            <p className="font-medium text-ink">Your decision history starts here.</p>
            <p className="mt-1">Write your first decision above. Each one you confirm is kept exactly as you believed it.</p>
          </div>
        )}
        {state.kind === "ready" && state.decisions.length > 0 && (
          <>
            <ul className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-white">
              {state.decisions.map((decision) => (
                <li key={decision.id}>
                  <Link href={`/app/decisions/${decision.id}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-cream sm:p-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[16px] font-medium text-ink">{decision.assetSymbol ?? "Asset not set"}</span>
                        <StatusBadge status={decision.status} />
                        <span className="t-caption">{formatDate(decision.confirmedAt ?? decision.createdAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[14px] leading-[22px] break-words">{decision.excerpt}</p>
                    </div>
                    <ArrowRight size={18} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {state.hasMore && <p className="t-caption mt-3">Showing your 20 most recent decisions.</p>}
          </>
        )}
      </div>
    </section>
  );
}

export function DecisionDesk() {
  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="t-eyebrow">Decision Desk</p>
        <h1 className="t-h2 mt-3">Record the belief before the result exists.</h1>
        <p className="t-lead mt-3 max-w-[62ch]">
          What you write here becomes the record every later review is measured against. Confirming saves it. It never places a trade.
        </p>
      </header>
      <Composer />
      <RecentDecisions />
    </div>
  );
}
