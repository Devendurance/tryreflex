"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { api, formatDate } from "@/components/decisions/decision-api";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";
import { autopsyErrorMessage, formatScore } from "@/components/autopsy/autopsy-api";

type Pattern = {
  id: string;
  category: string;
  status: "observation" | "emerging" | "established";
  count: number;
  evidenceStrength: string | null;
  supportingDecisionIds: string[];
  supportingReviewIds: string[];
  firstObserved: string | null;
  lastObserved: string | null;
  description: string;
  supportingFacts: { decisionId: string; reviewId: string; basis: string; observedFacts: { quote: string }[] }[];
};

type DNA = {
  summary: {
    status: "empty" | "sparse" | "longitudinal";
    independentDecisionCount: number;
    observationCount: number;
    emergingCount: number;
    establishedCount: number;
    retiredCount: number;
    recomputationRequired: boolean;
  };
  edges: Pattern[];
  leaks: Pattern[];
  influences: Pattern[];
  executionPatterns: Pattern[];
  regimes: Pattern[];
  observations: Pattern[];
  evidenceStats: {
    aggregationStatus?: string;
    eligibleReviewCount?: number;
    averageDecisionQuality?: string | number | null;
    averageEvidenceCoveragePct?: string | number | null;
    qualityAssessedCount?: number | null;
    qualityUnassessedCount?: number | null;
    knownOutcomes?: { positive: number; negative: number; breakEven: number; unknown: number } | null;
  };
};

const CATEGORY: Record<string, string> = {
  edge: "Edge",
  leak: "Leak",
  influence: "Influence",
  execution: "Execution",
  regime: "Market regime",
  origin: "Decision origin",
};
const STATUS: Record<Pattern["status"], string> = { observation: "Observation", emerging: "Emerging", established: "Established" };
const STRENGTH: Record<string, string> = {
  limited: "Limited: seen once",
  emerging: "Emerging: seen in 2 to 3 decisions",
  quality_supported_recurrence: "Established: 4 or more well-evidenced decisions",
};

function PatternCard({ pattern }: { pattern: Pattern }) {
  const quotes = pattern.supportingFacts.flatMap((fact) => fact.observedFacts.map((observed) => ({ quote: observed.quote, reviewId: fact.reviewId })));
  return (
    <li className="rounded-[12px] border border-hairline bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={pattern.status === "established" ? "confirmed" : "neutral"}>{STATUS[pattern.status] ?? pattern.status}</Tag>
        <Tag>{CATEGORY[pattern.category] ?? pattern.category}</Tag>
      </div>
      <p className="mt-3 text-[16px] leading-[25px] text-ink">{pattern.description}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3">
        <div>
          <dt className="t-eyebrow text-[11px]">Supporting decisions</dt>
          <dd className="t-data mt-1 text-ink">{pattern.count}</dd>
        </div>
        <div>
          <dt className="t-eyebrow text-[11px]">Evidence strength</dt>
          <dd className="mt-1 text-ink">{pattern.evidenceStrength ? STRENGTH[pattern.evidenceStrength] ?? pattern.evidenceStrength : "Not recorded"}</dd>
        </div>
        <div>
          <dt className="t-eyebrow text-[11px]">Last seen</dt>
          <dd className="mt-1 text-ink">{pattern.lastObserved ? formatDate(pattern.lastObserved) : "Unknown"}</dd>
        </div>
      </dl>
      {quotes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {quotes.slice(0, 3).map((entry, index) => (
            <li key={index} className="border-l-2 border-ink/70 pl-3 text-[14px] leading-[22px] text-ink break-words">
              &ldquo;{entry.quote}&rdquo;
            </li>
          ))}
        </ul>
      )}
      {pattern.supportingReviewIds.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px]">
          From:
          {pattern.supportingReviewIds.map((reviewId, index) => (
            <Link key={reviewId} href={`/app/autopsies/${reviewId}`} className="underline underline-offset-4">
              Autopsy {index + 1}
            </Link>
          ))}
        </p>
      )}
    </li>
  );
}

function Group({ id, title, note, patterns }: { id: string; title: string; note: string; patterns: Pattern[] }) {
  if (patterns.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-[20px] leading-7 font-medium text-ink">
        {title}
      </h2>
      <p className="mt-1 text-[14px] leading-[22px]">{note}</p>
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {patterns.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} />
        ))}
      </ul>
    </section>
  );
}

export function DNAView() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; dna: DNA } | { kind: "error"; message: string }>({ kind: "loading" });
  const [recomputing, setRecomputing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", dna: await api<DNA>("/api/dna") });
    } catch (thrown) {
      setState({ kind: "error", message: autopsyErrorMessage(thrown, "load") });
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- owner-scoped DNA read
  useEffect(() => void load(), [load]);

  const recompute = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRecomputing(true);
    setNotice(null);
    try {
      const result = await api<{ eventsLoaded: number; patterns: unknown[]; retiredCount: number }>("/api/patterns/recompute", { method: "POST", body: "{}" });
      await load();
      setNotice({
        tone: "success",
        text: `Updated from ${result.eventsLoaded} reviewed decision${result.eventsLoaded === 1 ? "" : "s"}. ${result.patterns.length} current finding${result.patterns.length === 1 ? "" : "s"}${result.retiredCount ? `, ${result.retiredCount} retired` : ""}.`,
      });
    } catch (thrown) {
      setNotice({ tone: "error", text: autopsyErrorMessage(thrown, "recompute") });
    } finally {
      inFlight.current = false;
      setRecomputing(false);
    }
  };

  const header = (
    <header>
      <p className="t-eyebrow">Decision DNA</p>
      <h1 className="t-h2 mt-3">How you tend to decide.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Built only from your saved autopsies. One review is an observation. A habit needs the same thing in four or more well-evidenced decisions.
      </p>
    </header>
  );

  if (state.kind !== "ready")
    return (
      <div className="flex flex-col gap-8">
        {header}
        {state.kind === "loading" ? (
          <p className="inline-flex items-center gap-2 text-[14px]" aria-live="polite">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading your DNA
          </p>
        ) : (
          <FormNotice tone="error">
            {state.message}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-4">
              Try again
            </button>
          </FormNotice>
        )}
      </div>
    );

  const { dna } = state;
  const { summary, evidenceStats } = dna;
  const lead =
    summary.status === "empty"
      ? "No reviewed decisions yet."
      : summary.status === "sparse"
        ? "Your decision history is beginning to take shape."
        : "Your decision history is deep enough to show recurring patterns.";

  return (
    <div className="flex flex-col gap-8">
      {header}
      <Panel
        id="dna-summary"
        title={lead}
        aside={
          summary.status !== "empty" && (
            <button type="button" onClick={() => void recompute()} disabled={recomputing} className={buttonClass(summary.recomputationRequired ? "primary" : "quiet", "sm")}>
              {recomputing && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {recomputing ? "Updating" : "Update from my reviews"}
            </button>
          )
        }
      >
        {summary.status === "empty" ? (
          <p className="text-[15px]">
            Decision DNA starts after your first autopsy. Open a confirmed decision in the{" "}
            <Link href="/app/decisions" className="underline underline-offset-4">
              Decision Desk
            </Link>
            , add its trade evidence, and request an autopsy.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {(
                [
                  ["Reviewed decisions", summary.independentDecisionCount],
                  ["Observations", summary.observationCount],
                  ["Emerging", summary.emergingCount],
                  ["Established", summary.establishedCount],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="t-eyebrow text-[11px]">{label}</dt>
                  <dd className="t-data mt-1 text-[22px] text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {evidenceStats.aggregationStatus !== "not_computed" && (
              <p className="mt-4 text-[14px] leading-[22px]">
                Average decision quality{" "}
                <span className="t-data text-ink">
                  {evidenceStats.averageDecisionQuality != null ? formatScore(Number(evidenceStats.averageDecisionQuality)) : "not available"}
                </span>
                {evidenceStats.averageEvidenceCoveragePct != null && (
                  <>
                    {" "}· average coverage <span className="t-data text-ink">{formatScore(Number(evidenceStats.averageEvidenceCoveragePct))}%</span>
                  </>
                )}
                . These describe your records, not causes or expected returns.
              </p>
            )}
            {summary.recomputationRequired && (
              <p className="mt-4 text-[14px] leading-[22px] text-ink">You have reviews that aren&rsquo;t reflected yet. Update to include them.</p>
            )}
          </>
        )}
        {notice && (
          <div className="mt-4" aria-live="polite">
            <FormNotice tone={notice.tone}>{notice.text}</FormNotice>
          </div>
        )}
      </Panel>

      <Group id="dna-established-edges" title="Edges" note="Strengths backed by your evidence." patterns={dna.edges} />
      <Group id="dna-leaks" title="Leaks" note="Weaknesses backed by your evidence." patterns={dna.leaks} />
      <Group id="dna-influence" title="Influences" note="Sources that shaped decisions, by recorded link only." patterns={dna.influences} />
      <Group id="dna-execution" title="Execution patterns" note="How plans and actions lined up." patterns={dna.executionPatterns} />
      <Group id="dna-regimes" title="Market regimes" note="Only with verified decision-time context." patterns={dna.regimes} />
      <Group
        id="dna-observations"
        title="Observations"
        note="Each seen in a single decision so far. Not a habit until it repeats in more well-evidenced decisions."
        patterns={dna.observations}
      />

      {summary.status !== "empty" && (
        <p className="t-caption">
          Not yet known: anything that needs more reviewed decisions, and market context that wasn&rsquo;t verified at decision time. Reflex never assigns a probability to these findings.
        </p>
      )}
    </div>
  );
}
