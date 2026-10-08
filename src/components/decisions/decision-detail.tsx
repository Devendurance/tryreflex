"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { api, apiErrorMessage, ASSET_CLASSES, formatDate, KNOWLEDGE_BASIS, ORIGINS, SIDES, SOURCE_TYPES, type DecisionRecord, type Snapshot } from "./decision-api";
import { DecisionEditor } from "./decision-editor";
import { InferencePanel, Panel, RawInput, StatusBadge, Tag } from "./decision-parts";

type State = { kind: "loading" } | { kind: "ready"; record: DecisionRecord; justConfirmed: boolean } | { kind: "error"; message: string; notFound: boolean };

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-hairline py-3">
      <dt className="t-eyebrow">{label}</dt>
      <dd className="text-[15px] leading-6 break-words text-ink">{children}</dd>
    </div>
  );
}

const notRecorded = <span className="text-muted">Not recorded</span>;

function ConfirmedSnapshot({ snapshot }: { snapshot: Snapshot }) {
  const value = (v: string | undefined) => (v ? v : notRecorded);
  return (
    <Panel id="snapshot-title" title="Your confirmed decision" aside={<Tag tone="confirmed">Confirmed by you</Tag>}>
      <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Asset">{snapshot.assetSymbol}</Fact>
        <Fact label="Asset class">{ASSET_CLASSES[snapshot.assetClass]}</Fact>
        <Fact label="Direction">{SIDES[snapshot.side]}</Fact>
        <Fact label="Intended entry price">{snapshot.intendedEntry === undefined ? notRecorded : <span className="t-data">{snapshot.intendedEntry}</span>}</Fact>
        <Fact label="Risk (% of account)">{snapshot.intendedRiskPct === undefined ? notRecorded : <span className="t-data">{snapshot.intendedRiskPct}%</span>}</Fact>
        <Fact label="Take-profit market cap">
          {snapshot.intendedTakeProfitMarketCap ? (
            <span className="t-data">
              {snapshot.intendedTakeProfitMarketCap} {snapshot.marketCapCurrency ?? ""}
            </span>
          ) : (
            notRecorded
          )}
        </Fact>
        <Fact label="Timeframe">{value(snapshot.timeframe)}</Fact>
        <Fact label="Your conviction">{snapshot.confidence === undefined ? notRecorded : <span className="t-data">{Math.round(snapshot.confidence * 100)} / 100</span>}</Fact>
        <Fact label="Written">{snapshot.knowledgeBasis ? KNOWLEDGE_BASIS[snapshot.knowledgeBasis] : notRecorded}</Fact>
      </dl>
      <dl className="mt-2 grid gap-x-8 sm:grid-cols-2">
        <Fact label="Thesis">{value(snapshot.thesis)}</Fact>
        <Fact label="Catalyst">{value(snapshot.catalyst)}</Fact>
        <Fact label="Invalidation">{value(snapshot.invalidation)}</Fact>
        <Fact label="Origin">{snapshot.origins.map((origin) => ORIGINS[origin].name).join(", ")}</Fact>
      </dl>
      <div className="mt-4 border-t border-hairline pt-4">
        <h3 className="t-eyebrow">Sources</h3>
        {snapshot.sources.length === 0 ? (
          <p className="mt-2 text-[14px]">No sources recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-[14px] leading-[22px]">
            {snapshot.sources.map((source, index) => (
              <li key={`${source.label}-${index}`} className="break-words">
                <span className="font-medium text-ink">{source.label}</span> <span className="text-muted">({SOURCE_TYPES[source.sourceType]})</span>
                {source.url && (
                  <>
                    {" "}
                    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">
                      link
                    </a>
                  </>
                )}
                {source.note && <span className="block text-muted">{source.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function History({ record }: { record: DecisionRecord }) {
  const { decision, revisions } = record;
  return (
    <Panel id="history-title" title="Record history">
      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Fact label="Decision ID">
          <span className="t-data text-[13px] break-all">{decision.id}</span>
        </Fact>
        <Fact label="Written">{formatDate(decision.createdAt)}</Fact>
        <Fact label="Confirmed">{formatDate(decision.confirmedAt)}</Fact>
        <Fact label="Current version">{decision.currentRevision ? <span className="t-data">v{decision.currentRevision.version}</span> : notRecorded}</Fact>
      </dl>
      {revisions.length > 0 && (
        <ol className="mt-4 flex flex-col gap-1 border-t border-hairline pt-4 text-[14px]">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <span className="t-data text-ink">v{revision.version}</span> saved {formatDate(revision.createdAt)}
              {revision.version === 1 ? " (original confirmation)" : " (correction)"}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function DecisionDetail({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(
    async (justConfirmed = false) => {
      try {
        const record = await api<DecisionRecord>(`/api/decisions/${id}`);
        setState({ kind: "ready", record, justConfirmed });
        if (justConfirmed) window.scrollTo({ top: 0 });
      } catch (thrown) {
        const status = (thrown as { status?: number }).status;
        setState({ kind: "error", message: apiErrorMessage(thrown, "load"), notFound: status === 404 || status === 400 });
      }
    },
    [id],
  );
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the owner-scoped decision
  useEffect(() => void load(), [load]);

  const back = (
    <Link href="/app/decisions" className="inline-flex h-11 items-center gap-2 rounded-full text-[14px] font-medium text-ink hover:text-muted">
      <ArrowLeft size={16} aria-hidden /> Decision Desk
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p role="status" className="inline-flex items-center gap-2">
          <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading decision
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <h1 className="t-h2">{state.notFound ? "Decision not found." : "This decision couldn't load."}</h1>
        <FormNotice tone="error">
          {state.notFound ? "This decision doesn't exist, or it belongs to another account." : state.message}{" "}
          {!state.notFound && (
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-4">
              Try again
            </button>
          )}
        </FormNotice>
      </div>
    );
  }

  const { record, justConfirmed } = state;
  const { decision } = record;
  const confirmed = decision.status !== "draft" && decision.confirmedSnapshot !== null;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="t-eyebrow">{confirmed ? "Saved decision" : "Review and confirm"}</p>
          <StatusBadge status={decision.status} />
        </div>
        <h1 className="t-h2 mt-3">{confirmed ? `${decision.confirmedSnapshot!.assetSymbol}: what you believed.` : "Check what Reflex read."}</h1>
        {!confirmed && (
          <p className="t-lead mt-3 max-w-[62ch]">Correct anything that&rsquo;s wrong, leave unknowns empty, and choose where the decision came from. Nothing is saved as your belief until you confirm.</p>
        )}
      </header>
      {justConfirmed && (
        <FormNotice tone="success">
          Saved. This decision is now part of your record, exactly as confirmed. You can come back to it from the Decision Desk at any time.
        </FormNotice>
      )}
      {confirmed ? (
        <>
          <ConfirmedSnapshot snapshot={decision.confirmedSnapshot!} />
          <RawInput text={decision.rawInput} />
          <InferencePanel record={record} />
          <History record={record} />
        </>
      ) : (
        <>
          <RawInput text={decision.rawInput} />
          <InferencePanel record={record} />
          <DecisionEditor record={record} onConfirmed={() => void load(true)} />
        </>
      )}
    </div>
  );
}
