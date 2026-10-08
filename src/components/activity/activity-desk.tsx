"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { api, formatDate } from "@/components/decisions/decision-api";
import { buttonClass } from "@/components/landing/primitives";
import { activityErrorMessage, type Activity, type ImportReceipt } from "./activity-api";
import { ImportFlow } from "./activity-import";
import { DirectionTag, Num, PurposeTag } from "./activity-parts";

type Paged<T> = { items: T[]; nextCursor: string | null; status: "loading" | "ready" | "more" | "error"; error: string | null };

function usePaged<T>(path: string, key: "activities" | "imports", limit: number, reloadKey: number) {
  const [state, setState] = useState<Paged<T>>({ items: [], nextCursor: null, status: "loading", error: null });
  const load = useCallback(
    async (cursor: string | null) => {
      setState((current) => ({ ...current, status: cursor ? "more" : "loading", error: null }));
      try {
        const query = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
        const body = await api<Record<string, unknown> & { nextCursor: string | null }>(`${path}?${query}`);
        const items = body[key] as T[];
        setState((current) => ({ items: cursor ? [...current.items, ...items] : items, nextCursor: body.nextCursor, status: "ready", error: null }));
      } catch (thrown) {
        setState((current) => ({ ...current, status: "error", error: activityErrorMessage(thrown, "list") }));
      }
    },
    [path, key, limit],
  );
  useEffect(() => void load(null), [load, reloadKey]);
  return { ...state, reload: () => void load(null), more: () => void load(state.nextCursor) };
}

function ListSection<T extends { id: string }>({
  id,
  title,
  intro,
  list,
  empty,
  render,
}: {
  id: string;
  title: string;
  intro: string;
  list: ReturnType<typeof usePaged<T>>;
  empty: ReactNode;
  render: (item: T) => ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-[20px] leading-7 font-medium text-ink">
        {title}
      </h2>
      <p className="mt-1 text-[14px] leading-[22px]">{intro}</p>
      <div className="mt-4" aria-live="polite">
        {list.status === "loading" && (
          <p className="inline-flex items-center gap-2 text-[14px]">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading
          </p>
        )}
        {list.status !== "loading" && list.items.length === 0 && list.status !== "error" && (
          <div className="rounded-[12px] border border-dashed border-hairline p-6 text-[15px]">{empty}</div>
        )}
        {list.items.length > 0 && (
          <ul className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-white">
            {list.items.map((item) => (
              <li key={item.id}>{render(item)}</li>
            ))}
          </ul>
        )}
        {list.status === "error" && (
          <div className="mt-3">
            <FormNotice tone="error">
              {list.error}{" "}
              <button type="button" onClick={list.items.length ? list.more : list.reload} className="font-medium underline underline-offset-4">
                Try again
              </button>
            </FormNotice>
          </div>
        )}
        {list.nextCursor && list.status !== "error" && (
          <button type="button" onClick={list.more} disabled={list.status === "more"} className={`${buttonClass("quiet", "sm")} mt-3`}>
            {list.status === "more" && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            Show more
          </button>
        )}
      </div>
    </section>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const first = activity.order.executions[0];
  return (
    <Link href={`/app/activity/${activity.id}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-cream sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[16px] font-medium text-ink">{activity.tradingPair}</span>
          <DirectionTag direction={activity.direction} />
          <PurposeTag purpose={activity.purpose.value} />
        </div>
        <p className="mt-1.5 text-[14px] leading-[22px]">
          <Num value={activity.order.executedQuantity} unit={activity.baseAsset} /> at avg <Num value={activity.order.averagePrice} unit={activity.quoteAsset} />
        </p>
        <p className="t-caption mt-0.5">
          <span className="t-data">{first?.dateText ?? activity.order.dateText}</span> · timezone unknown
        </p>
      </div>
      <ArrowRight size={18} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function ImportRow({ receipt }: { receipt: ImportReceipt }) {
  return (
    <Link href={`/app/activity/imports/${receipt.id}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-cream sm:p-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{receipt.source_filename ?? "Unnamed file"}</p>
        <p className="mt-1 text-[14px] leading-[22px]">
          <Num value={String(receipt.order_count)} /> orders · <Num value={String(receipt.execution_count)} /> fills · label <span className="t-data">{receipt.account_scope}</span>
        </p>
        <p className="t-caption mt-0.5">Imported {formatDate(receipt.imported_at)}</p>
      </div>
      <ArrowRight size={18} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function ActivityDesk() {
  const [reloadKey, setReloadKey] = useState(0);
  const activities = usePaged<Activity>("/api/activities", "activities", 20, reloadKey);
  const imports = usePaged<ImportReceipt>("/api/imports/bitget-classic", "imports", 10, reloadKey);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="t-eyebrow">Trade Activity</p>
        <h1 className="t-h2 mt-3">What actually happened on the exchange.</h1>
        <p className="t-lead mt-3 max-w-[62ch]">
          Imported orders are exchange facts: prices, fills and fees as Bitget reported them. They aren&rsquo;t decisions. Your reasons live in the Decision Desk, and Reflex never invents profit or cost basis.
        </p>
      </header>
      <ImportFlow onCommitted={() => setReloadKey((key) => key + 1)} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ListSection<Activity>
          id="activity-title"
          title="Imported activity"
          intro="Newest first. Each order keeps the purpose you declared."
          list={activities}
          empty={
            <>
              <p className="font-medium text-ink">No exchange activity yet.</p>
              <p className="mt-1">Preview a Bitget Classic export above. Nothing appears here until you confirm an import.</p>
            </>
          }
          render={(activity) => <ActivityRow activity={activity} />}
        />
        <ListSection<ImportReceipt>
          id="imports-title"
          title="Import history"
          intro="A receipt for every file you confirmed."
          list={imports}
          empty={<p>No imports yet.</p>}
          render={(receipt) => <ImportRow receipt={receipt} />}
        />
      </div>
    </div>
  );
}
