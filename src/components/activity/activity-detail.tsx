"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { ApiError, api, formatDate } from "@/components/decisions/decision-api";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";
import { activityErrorMessage, PURPOSES, type Activity, type ImportReceipt, type Purpose } from "./activity-api";
import { DirectionTag, Fact, Fills, MissingData, OrderFacts, PurposeChoice, PurposeTag, Totals } from "./activity-parts";

const EXCHANGE_GAPS = ["cost_basis", "realized_pnl", "buy_sell_pairing", "holding_duration", "trading_rationale"];

function BackLink() {
  return (
    <Link href="/app/activity" className="inline-flex items-center gap-2 text-[14px] font-medium text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
      <ArrowLeft size={16} aria-hidden /> Trade Activity
    </Link>
  );
}

function useRecord<T>(path: string) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string }>({ kind: "loading" });
  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", data: await api<T>(path) });
    } catch (thrown) {
      setState({ kind: "error", message: activityErrorMessage(thrown, "load") });
    }
  }, [path]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial owner-scoped fetch
  useEffect(() => void load(), [load]);
  return { state, setState, load };
}

function Status({ state, retry }: { state: { kind: "loading" } | { kind: "error"; message: string }; retry: () => void }) {
  return state.kind === "loading" ? (
    <p className="inline-flex items-center gap-2 text-[14px]" aria-live="polite">
      <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading
    </p>
  ) : (
    <FormNotice tone="error">
      {state.message}{" "}
      <button type="button" onClick={retry} className="font-medium underline underline-offset-4">
        Try again
      </button>
    </FormNotice>
  );
}

type Notice = { tone: "error" | "success"; text: string } | null;

function Reclassify({
  activity,
  onSaved,
  onStale,
  setNotice,
}: {
  activity: Activity;
  onSaved: (next: Activity) => void;
  onStale: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [purpose, setPurpose] = useState<Purpose>(activity.purpose.value);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const unchanged = purpose === activity.purpose.value;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || unchanged) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const next = await api<Activity>(`/api/activities/${activity.id}/purpose`, {
        method: "POST",
        body: JSON.stringify({ purpose, expectedVersion: activity.purpose.version, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      onSaved(next);
      setNotice({ tone: "success", text: `Purpose changed to ${PURPOSES[next.purpose.value].name}. This is version ${next.purpose.version}, and earlier versions stay in the history.` });
    } catch (thrown) {
      setNotice({ tone: "error", text: activityErrorMessage(thrown, "purpose") });
      if (thrown instanceof ApiError && thrown.status === 409) await onStale();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
      <PurposeChoice name="reclassify" legend="Change the purpose" value={purpose} onChange={setPurpose} disabled={pending} />
      <div>
        <label htmlFor="purpose-reason" className="text-[14px] font-medium text-ink">
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="purpose-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={2}
          disabled={pending}
          className="mt-2 w-full resize-y rounded-[12px] border border-hairline bg-white p-3 text-[15px] leading-[23px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none disabled:opacity-60"
        />
      </div>
      <p className="t-caption">Changing the purpose never edits the exchange facts and never creates a decision or a review.</p>
      <div>
        <button type="submit" disabled={pending || unchanged} className={buttonClass("primary", "sm")}>
          {pending && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {pending ? "Saving" : "Save new purpose"}
        </button>
      </div>
    </form>
  );
}

export function ActivityDetail({ id }: { id: string }) {
  const { state, setState, load } = useRecord<Activity>(`/api/activities/${id}`);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  if (state.kind !== "ready")
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <Status state={state} retry={() => void load()} />
      </div>
    );
  const activity = state.data;

  return (
    <div className="flex flex-col gap-8">
      <BackLink />
      <header>
        <p className="t-eyebrow">Imported exchange activity</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="t-h2">{activity.tradingPair}</h1>
          <DirectionTag direction={activity.direction} />
          <PurposeTag purpose={activity.purpose.value} />
        </div>
        <p className="t-lead mt-3 max-w-[62ch]">
          This is what Bitget reported for one order. It isn&rsquo;t a Reflex decision, and it isn&rsquo;t linked to one.
        </p>
      </header>

      <Panel id="order-title" title="Order, as reported" aside={<Tag>Exchange record</Tag>}>
        <OrderFacts order={activity.order} />
        <h3 className="t-eyebrow mt-6 mb-3">Actual fills</h3>
        <Fills order={activity.order} />
      </Panel>

      {activity.metrics.financialGroups.map((group) => (
        <Panel key={`${group.baseAsset}-${group.direction}`} id="totals-title" title="Reported totals">
          <Totals group={group} />
          <div className="mt-5 border-t border-hairline pt-4">
            <MissingData items={EXCHANGE_GAPS} />
          </div>
        </Panel>
      ))}

      <Panel id="purpose-title" title="Purpose" aside={<Tag tone="confirmed">Declared by you</Tag>}>
        <p className="text-[15px] text-ink">
          Currently <span className="font-medium">{PURPOSES[activity.purpose.value].name}</span>, version <span className="t-data">{activity.purpose.version}</span>.
        </p>
        <div className="mt-5">
          <Reclassify
            key={`${formKey}-${activity.purpose.version}`}
            activity={activity}
            setNotice={setNotice}
            onSaved={(next) => setState({ kind: "ready", data: next })}
            onStale={async () => {
              await load();
              setFormKey((key) => key + 1);
            }}
          />
        </div>
        {notice && (
          <div className="mt-4" aria-live="polite">
            <FormNotice tone={notice.tone}>{notice.text}</FormNotice>
          </div>
        )}
        <h3 className="t-eyebrow mt-8">Purpose history</h3>
        <ol className="mt-3 flex flex-col gap-3">
          {[...activity.purposeAudit].reverse().map((entry) => (
            <li key={entry.eventId} className="border-l-2 border-hairline pl-3 text-[14px] leading-[22px]">
              <span className="t-data text-ink">v{entry.version}</span> · <span className="text-ink">{PURPOSES[entry.purpose].name}</span> · {formatDate(entry.createdAt)}
              {entry.version === 1 && <span className="text-muted"> · set at import</span>}
              {entry.reason && <span className="block text-ink">&ldquo;{entry.reason}&rdquo;</span>}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel id="source-title" title="Where this came from">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label="Source">Bitget Classic spot order history (CSV)</Fact>
          <Fact label="Account label" hint="Declared by you, not verified">
            <span className="t-data">{activity.accountScope}</span>
          </Fact>
          <Fact label="Saved to Reflex">{formatDate(activity.createdAt)}</Fact>
          <Fact label="Reflex activity ID">
            <span className="t-data text-[13px] break-all">{activity.id}</span>
          </Fact>
        </dl>
        <h3 className="t-eyebrow mt-6">Imports that contained this order</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {activity.sourceSnapshots.map((snapshot) => (
            <li key={snapshot.id} className="text-[14px] leading-[22px]">
              {snapshot.importId ? (
                <Link href={`/app/activity/imports/${snapshot.importId}`} className="underline underline-offset-4">
                  Import receipt
                </Link>
              ) : (
                "Import receipt not linked"
              )}{" "}
              · {formatDate(snapshot.createdAt)}
              {snapshot.sourceHash && <span className="t-data block text-[12px] break-all text-muted">file hash {snapshot.sourceHash}</span>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function ImportDetail({ id }: { id: string }) {
  const { state, load } = useRecord<{ import: ImportReceipt; activities: Activity[] }>(`/api/imports/bitget-classic/${id}`);
  if (state.kind !== "ready")
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <Status state={state} retry={() => void load()} />
      </div>
    );
  const { import: receipt, activities } = state.data;
  return (
    <div className="flex flex-col gap-8">
      <BackLink />
      <header>
        <p className="t-eyebrow">Import receipt</p>
        <h1 className="t-h2 mt-3 break-all">{receipt.source_filename ?? "Unnamed file"}</h1>
      </header>
      <Panel id="receipt-title" title="Receipt" aside={<Tag tone="confirmed">Saved</Tag>}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label="Imported">{formatDate(receipt.imported_at)}</Fact>
          <Fact label="Account label" hint="Declared by you, not verified">
            <span className="t-data">{receipt.account_scope}</span>
          </Fact>
          <Fact label="Orders in file">
            <span className="t-data">{receipt.order_count}</span>
          </Fact>
          <Fact label="Fills in file">
            <span className="t-data">{receipt.execution_count}</span>
          </Fact>
          <Fact label="Format">Bitget Classic spot order history, v1</Fact>
          <Fact label="Receipt ID">
            <span className="t-data text-[13px] break-all">{receipt.id}</span>
          </Fact>
          <Fact label="File hash" hint="Importing the same file again adds nothing">
            <span className="t-data text-[12px] break-all">{receipt.source_hash}</span>
          </Fact>
        </dl>
      </Panel>
      <section aria-labelledby="receipt-activity">
        <h2 id="receipt-activity" className="text-[20px] leading-7 font-medium text-ink">
          Orders in this import
        </h2>
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-white">
          {activities.map((activity) => (
            <li key={activity.id}>
              <Link href={`/app/activity/${activity.id}`} className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-cream sm:p-5">
                <span className="text-[15px] font-medium text-ink">{activity.tradingPair}</span>
                <DirectionTag direction={activity.direction} />
                <PurposeTag purpose={activity.purpose.value} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
