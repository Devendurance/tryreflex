"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { api, formatDate, type DecisionRecord } from "@/components/decisions/decision-api";
import { ConfirmedSnapshot } from "@/components/decisions/decision-detail";
import { Panel, RawInput, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";
import {
  autopsyErrorMessage,
  DIMENSION_ORDER,
  DIMENSIONS,
  formatScore,
  QUADRANTS,
  QUALITY_STATUS,
  type DecisionQuality,
  type ReviewSummary,
  type ReviewView,
} from "./autopsy-api";

const unknown = <span className="text-muted">Unknown</span>;

function Fact({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-eyebrow text-[11px]">{label}</dt>
      <dd className="mt-1 text-[15px] leading-[22px] break-words text-ink">{children}</dd>
      {hint && <p className="t-caption mt-0.5">{hint}</p>}
    </div>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="border-l-2 border-ink/70 pl-3 text-[15px] leading-[24px] text-ink break-words">&ldquo;{children}&rdquo;</blockquote>;
}

function StatusTag({ status }: { status: DecisionQuality["status"] | null | undefined }) {
  if (!status) return <Tag>No score</Tag>;
  return <Tag tone={status === "final" ? "confirmed" : "neutral"}>{QUALITY_STATUS[status].name}</Tag>;
}

function BackLink() {
  return (
    <Link href="/app/autopsies" className="inline-flex items-center gap-2 text-[14px] font-medium text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
      <ArrowLeft size={16} aria-hidden /> Autopsies
    </Link>
  );
}

function QualityPanel({ quality, classification, outcome }: { quality: DecisionQuality | null; classification: string | null; outcome: string | undefined }) {
  if (!quality) return <Panel id="quality-title" title="Decision quality"><p className="text-[15px]">No decision-quality record was saved with this review.</p></Panel>;
  return (
    <Panel id="quality-title" title="Decision quality" aside={<StatusTag status={quality.status} />}>
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
        <p className="t-data text-[56px] leading-none text-ink">
          {quality.score === null ? <span className="text-[28px] text-muted">Not scored</span> : formatScore(quality.score)}
          {quality.score !== null && <span className="text-[18px] text-muted"> / 100</span>}
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Fact label="Status" hint={QUALITY_STATUS[quality.status].meaning}>{QUALITY_STATUS[quality.status].name}</Fact>
          <Fact label="Evidence coverage" hint={`A score needs at least ${quality.minimumCoveragePct}%`}>
            <span className="t-data">{quality.evidenceCoveragePct}%</span> of weighted dimensions
          </Fact>
          <Fact label="Process × outcome" hint={classification ? undefined : "Needs a final score and a known gain or loss"}>
            {classification ? QUADRANTS[classification] ?? classification : "Not available"}
          </Fact>
        </dl>
      </div>
      <p className="t-caption mt-5">
        The score measures process, never profit. Weights and the {quality.threshold}-point line for a sound process are Reflex product assumptions, not trading truths.
        {outcome && outcome !== "unknown" ? "" : " The financial outcome is unknown, so it plays no part here."}
      </p>
    </Panel>
  );
}

function Dimensions({ review }: { review: ReviewView }) {
  const label = (id: string) => review.evidence.find((entry) => entry.evidenceId === id)?.label;
  const byName = new Map(review.dimensions.map((dimension) => [dimension.dimension, dimension]));
  return (
    <section aria-labelledby="dimensions-title" className="flex flex-col gap-4">
      <h2 id="dimensions-title" className="text-[20px] leading-7 font-medium text-ink">
        Five dimensions
      </h2>
      {DIMENSION_ORDER.map((name) => {
        const dimension = byName.get(name);
        const weight = review.decisionQuality?.weights[name];
        return (
          <article key={name} aria-labelledby={`dim-${name}`} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`dim-${name}`} className="text-[18px] font-medium text-ink">
                  {DIMENSIONS[name].name}
                </h3>
                <p className="text-[13px] leading-5">
                  {DIMENSIONS[name].meaning}
                  {weight !== undefined && <span className="t-data"> · weight {weight}</span>}
                </p>
              </div>
              <p className="t-data text-[22px] text-ink">
                {dimension && dimension.score !== null ? formatScore(dimension.score) : <span className="text-[15px] text-muted">Not assessed</span>}
              </p>
            </div>
            {dimension ? (
              <>
                <p className="mt-3 text-[15px] leading-[24px] text-ink">{dimension.explanation}</p>
                {dimension.score !== null && (
                  <p className="t-caption mt-1">Evidence support {formatScore(dimension.confidence * 100)}%. This is how well the evidence backs the score, not a chance of profit.</p>
                )}
                {dimension.observedFacts.length > 0 && (
                  <div className="mt-4">
                    <h4 className="t-eyebrow">Observed in your records</h4>
                    <ul className="mt-2 flex flex-col gap-2">
                      {dimension.observedFacts.map((fact, index) => (
                        <li key={`${fact.evidenceId}-${index}`}>
                          <Quote>{fact.quote}</Quote>
                          {label(fact.evidenceId) && <p className="t-caption mt-1 pl-3">{label(fact.evidenceId)}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {dimension.inferredFindings.length > 0 && (
                  <div className="mt-4">
                    <h4 className="t-eyebrow">Reflex&rsquo;s interpretation</h4>
                    <ul className="mt-2 flex flex-col gap-2">
                      {dimension.inferredFindings.map((finding, index) => (
                        <li key={index} className="flex gap-2 text-[15px] leading-[24px] text-ink">
                          <Tag tone="inferred">Inference</Tag>
                          <span className="min-w-0">{finding.finding}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-[15px]">No record for this dimension was saved.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function PlanDrift({ review }: { review: ReviewView }) {
  if (review.planDrift.length === 0)
    return (
      <Panel id="drift-title" title="Plan drift">
        <p className="text-[15px]">No change from your original plan was found in the evidence. That isn&rsquo;t proof the plan held, only that nothing recorded shows it moving.</p>
      </Panel>
    );
  return (
    <Panel id="drift-title" title="Plan drift" aside={<Tag>One observation</Tag>}>
      <div className="flex flex-col gap-6">
        {review.planDrift.map((finding, index) => (
          <div key={index} className="flex flex-col gap-4">
            <p className="text-[15px] leading-[24px] text-ink">{finding.explanation}</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Fact label="Original target">
                <span className="t-data">{finding.originalPlan.value}</span> {finding.originalPlan.currency} market cap
              </Fact>
              <Fact label="Revised target">
                <span className="t-data">{finding.revisedPlan.value}</span> {finding.revisedPlan.currency} market cap
              </Fact>
              <Fact label="Highest seen">{finding.observations.peakMarketCap ? <span className="t-data">{finding.observations.peakMarketCap}</span> : unknown}</Fact>
              <Fact label="At exit">{finding.observations.exitMarketCap ? <span className="t-data">{finding.observations.exitMarketCap}</span> : unknown}</Fact>
            </dl>
            <div>
              <h3 className="t-eyebrow">What you said about the change</h3>
              <div className="mt-2">
                <Quote>{finding.ordering.quote}</Quote>
              </div>
            </div>
            {finding.userSelfAssessment.length > 0 && (
              <div>
                <h3 className="t-eyebrow">Your own assessment</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {finding.userSelfAssessment.map((entry, i) => (
                    <li key={i}>
                      <Quote>{entry.text}</Quote>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="t-caption">
              Based on your retrospective account of one trade. It&rsquo;s an observation to watch, not a proven habit. Market-cap values describe valuation, not your return.
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TradePanel({ review }: { review: ReviewView }) {
  const trade = review.trade;
  const metrics = review.metrics.tradeMetrics ?? {};
  const value = (v: string | null | undefined, unit?: string | null) => (v ? <span className="t-data">{v}{unit ? ` ${unit}` : ""}</span> : unknown);
  const outcomeKnown = metrics.outcome && metrics.outcome !== "unknown";
  return (
    <Panel id="trade-title" title="Trade evidence" aside={<Tag>{trade?.provider === "bitget" ? "Bitget" : "Entered by you"}</Tag>}>
      {trade ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Symbol">{trade.symbol}</Fact>
          <Fact label="Quantity">{value(trade.quantity)}</Fact>
          <Fact label="Entry price">{value(trade.entryPrice)}</Fact>
          <Fact label="Exit price">{value(trade.exitPrice)}</Fact>
          <Fact label="Entry time">{trade.openedAt ? formatDate(trade.openedAt) : unknown}</Fact>
          <Fact label="Exit time">{trade.closedAt ? formatDate(trade.closedAt) : unknown}</Fact>
          <Fact label="Recorded">
            {trade.evidenceQuality?.captureBasis === "retrospective" ? "Later, from memory" : trade.evidenceQuality?.captureBasis === "contemporaneous" ? "At the time" : unknown}
          </Fact>
          <Fact label="Fees known">{trade.evidenceQuality?.feesKnown === true ? "Yes" : trade.evidenceQuality?.feesKnown === false ? "No" : unknown}</Fact>
          <Fact label="Financial outcome" hint={outcomeKnown ? `Basis: ${metrics.netPnlBasis?.replaceAll("_", " ")}` : "Not enough cash-flow evidence"}>
            {outcomeKnown ? (
              <>
                {metrics.outcome === "positive" ? "Gain" : metrics.outcome === "negative" ? "Loss" : "Break-even"} {value(metrics.netRealizedPnl, metrics.settlementCurrency)}
              </>
            ) : (
              "Unknown"
            )}
          </Fact>
          {metrics.marketCapMovementMultiple && (
            <Fact label="Market-cap move, entry to exit" hint="Valuation change, not your return">
              <span className="t-data">×{metrics.marketCapMovementMultiple}</span>
            </Fact>
          )}
        </dl>
      ) : (
        <p className="text-[15px]">The linked trade couldn&rsquo;t be loaded.</p>
      )}
    </Panel>
  );
}

export function AutopsyDetail({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; review: ReviewView; decision: DecisionRecord | null } | { kind: "error"; message: string }>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { review } = await api<{ review: ReviewView }>(`/api/reviews/${id}`);
      const decision = review.decision ? await api<DecisionRecord>(`/api/decisions/${review.decision.id}`).catch(() => null) : null;
      setState({ kind: "ready", review, decision });
    } catch (thrown) {
      setState({ kind: "error", message: autopsyErrorMessage(thrown, "load") });
    }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- owner-scoped fetch of this review
  useEffect(() => void load(), [load]);

  if (state.kind !== "ready")
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {state.kind === "loading" ? (
          <p className="inline-flex items-center gap-2 text-[14px]" aria-live="polite">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading the autopsy
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
  const { review, decision } = state;
  const evidenceLabel = (ref: string) => review.evidence.find((entry) => entry.evidenceId === ref)?.label;

  return (
    <div className="flex flex-col gap-8">
      <BackLink />
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="t-eyebrow">Decision autopsy</p>
          <Tag>Version {review.version}</Tag>
          {!review.isCurrent && <Tag>Superseded</Tag>}
        </div>
        <h1 className="t-h2 mt-3">{review.trade?.symbol ?? review.decision?.snapshot?.assetSymbol ?? "Trade"}: how the decision held up.</h1>
        <p className="t-lead mt-3 max-w-[62ch]">
          Saved {formatDate(review.createdAt)}. Every claim below is tied to your own records. Unknowns stay unknown.
        </p>
        {review.decision && (
          <Link href={`/app/decisions/${review.decision.id}`} className="mt-3 inline-flex items-center gap-2 text-[14px] font-medium text-ink underline underline-offset-4">
            Open the original decision <ArrowRight size={16} aria-hidden />
          </Link>
        )}
      </header>

      <QualityPanel quality={review.decisionQuality} classification={review.classification} outcome={review.metrics.tradeMetrics?.outcome} />

      {review.summary && (
        <Panel id="summary-title" title="Summary">
          <p className="text-[16px] leading-[27px] text-ink">{review.summary}</p>
        </Panel>
      )}

      <Dimensions review={review} />
      <PlanDrift review={review} />

      <Panel id="lessons-title" title="Lessons">
        {review.lessons.length === 0 ? (
          <p className="text-[15px]">No lesson was supported by the evidence.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {review.lessons.map((lesson, index) => (
              <li key={index} className="border-l-2 border-orange pl-3 text-[15px] leading-[24px] text-ink">
                {lesson.text}
                {lesson.evidenceRefs.length > 0 && (
                  <span className="t-caption block">From: {lesson.evidenceRefs.map((ref) => evidenceLabel(ref) ?? "your records").join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <TradePanel review={review} />
      {review.decision?.snapshot && <ConfirmedSnapshot snapshot={review.decision.snapshot} />}
      {decision && <RawInput text={decision.decision.rawInput} />}
    </div>
  );
}

export function AutopsyList() {
  const [items, setItems] = useState<ReviewSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "more" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (from: string | null) => {
    setStatus(from ? "more" : "loading");
    try {
      const body = await api<{ reviews: ReviewSummary[]; nextCursor: string | null }>(`/api/reviews?limit=20${from ? `&cursor=${from}` : ""}`);
      setItems((current) => (from ? [...current, ...body.reviews] : body.reviews));
      setCursor(body.nextCursor);
      setStatus("ready");
    } catch (thrown) {
      setError(autopsyErrorMessage(thrown, "list"));
      setStatus("error");
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- owner-scoped review list
  useEffect(() => void load(null), [load]);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="t-eyebrow">Autopsies</p>
        <h1 className="t-h2 mt-3">How your decisions held up.</h1>
        <p className="t-lead mt-3 max-w-[62ch]">
          An autopsy compares what you believed with what you did, separately from whether it made money. To start one, open a confirmed decision and add its trade evidence.
        </p>
      </header>
      <section aria-labelledby="autopsy-list-title" aria-live="polite">
        <h2 id="autopsy-list-title" className="text-[20px] leading-7 font-medium text-ink">
          Saved autopsies
        </h2>
        <div className="mt-4">
          {status === "loading" && (
            <p className="inline-flex items-center gap-2 text-[14px]">
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading
            </p>
          )}
          {status !== "loading" && status !== "error" && items.length === 0 && (
            <div className="rounded-[12px] border border-dashed border-hairline p-6 text-[15px]">
              <p className="font-medium text-ink">No autopsies yet.</p>
              <p className="mt-1">
                Open a confirmed decision in the{" "}
                <Link href="/app/decisions" className="underline underline-offset-4">
                  Decision Desk
                </Link>
                , add what actually happened, then request an autopsy.
              </p>
            </div>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-white">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={`/app/autopsies/${item.id}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-cream sm:p-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="text-[16px] font-medium text-ink">{item.symbol}</span>
                        <StatusTag status={item.decisionQuality?.status} />
                        {!item.isCurrent && <Tag>Superseded</Tag>}
                        <span className="t-caption">{formatDate(item.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-[14px]">
                        {item.decisionQuality?.score != null ? (
                          <>
                            Decision quality <span className="t-data text-ink">{formatScore(item.decisionQuality.score)}</span> · coverage{" "}
                            <span className="t-data">{item.decisionQuality.evidenceCoveragePct}%</span>
                          </>
                        ) : (
                          "Not scored: not enough evidence"
                        )}
                      </p>
                    </div>
                    <ArrowRight size={18} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {status === "error" && (
            <div className="mt-3">
              <FormNotice tone="error">
                {error}{" "}
                <button type="button" onClick={() => void load(items.length ? cursor : null)} className="font-medium underline underline-offset-4">
                  Try again
                </button>
              </FormNotice>
            </div>
          )}
          {cursor && status !== "error" && (
            <button type="button" onClick={() => void load(cursor)} disabled={status === "more"} className={`${buttonClass("quiet", "sm")} mt-3`}>
              {status === "more" && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
              Show more
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
