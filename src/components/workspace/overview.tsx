"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWorkspaceUser } from "./workspace-shell";

type RecordState =
  | { kind: "loading" }
  | { kind: "linked"; activityCount: number; more: boolean }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "error" };

const LOOP: { step: string; detail: string; href?: string }[] = [
  { step: "Capture the thinking", detail: "Write what you believe before the result exists, then confirm it.", href: "/app/decisions" },
  { step: "Attach the trade", detail: "Add a trade by hand or import your Bitget spot history." },
  { step: "Review the process", detail: "Decision Autopsy scores the process separately from P&L." },
  { step: "Find the pattern", detail: "Decision DNA compares reviewed decisions as they accumulate." },
  { step: "Carry the lesson", detail: "Playbook rules and Pre-Trade Recall bring it back next time." },
];

function useReflexRecord() {
  const [state, setState] = useState<RecordState>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/activities?limit=50", { cache: "no-store" });
      if (response.status === 401) return setState({ kind: "signed-out" });
      if (response.status === 503) return setState({ kind: "unavailable" });
      if (!response.ok) return setState({ kind: "error" });
      const body = (await response.json()) as { activities?: unknown[]; nextCursor?: string | null };
      setState({ kind: "linked", activityCount: body.activities?.length ?? 0, more: Boolean(body.nextCursor) });
    } catch {
      setState({ kind: "error" });
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of owner-scoped workspace data
  useEffect(() => void load(), [load]);
  return { state, retry: load };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-hairline py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="t-eyebrow shrink-0">{label}</dt>
      <dd className="text-[15px] leading-6 text-ink sm:text-right">{children}</dd>
    </div>
  );
}

function RecordStatus({ state, retry }: ReturnType<typeof useReflexRecord>) {
  switch (state.kind) {
    case "loading":
      return (
        <span className="inline-flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> Checking
        </span>
      );
    case "linked":
      return <>Linked to your private record</>;
    case "signed-out":
      return (
        <>
          Your session ended.{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in again
          </Link>
        </>
      );
    case "unavailable":
      return <>Reflex storage is unavailable right now</>;
    case "error":
      return (
        <>
          Couldn&rsquo;t load your record.{" "}
          <button type="button" onClick={retry} className="underline underline-offset-4">
            Try again
          </button>
        </>
      );
  }
}

export function Overview() {
  const user = useWorkspaceUser();
  const record = useReflexRecord();
  const firstName = user.name.trim().split(/\s+/)[0];
  const { state } = record;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="t-eyebrow">Overview</p>
        <h1 className="t-h2 mt-3">{firstName ? `Welcome to your desk, ${firstName}.` : "Welcome to your desk."}</h1>
        <p className="t-lead mt-3 max-w-[60ch]">
          Reflex starts empty. Everything you see here comes from your own account, and nothing is sample data.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section aria-labelledby="account-title" className="rounded-[12px] border border-hairline bg-white p-6">
          <h2 id="account-title" className="text-[20px] leading-7 font-medium text-ink">
            Your workspace
          </h2>
          <dl className="mt-5" aria-live="polite">
            <Row label="Signed in as">
              <span className="break-all">{user.email}</span>
            </Row>
            <Row label="Email">{user.emailVerified ? "Verified" : "Not verified yet"}</Row>
            <Row label="Reflex record">
              <RecordStatus {...record} />
            </Row>
            <Row label="Imported activity">
              {state.kind === "linked" ? (
                <span className="t-data">
                  {state.activityCount === 0 ? "None yet" : `${state.activityCount}${state.more ? "+" : ""} order${state.activityCount === 1 ? "" : "s"}`}
                </span>
              ) : (
                <span className="text-muted">Not known yet</span>
              )}
            </Row>
          </dl>
        </section>

        <section aria-labelledby="loop-title" className="rounded-[12px] border border-hairline bg-white p-6">
          <h2 id="loop-title" className="text-[20px] leading-7 font-medium text-ink">
            How your desk fills up
          </h2>
          <p className="mt-2 text-[14px] leading-[22px]">Each step opens in this workspace as it ships. Decision capture is ready now.</p>
          <ol className="mt-5 flex flex-col">
            {LOOP.map((item, index) => (
              <li key={item.step} className="flex gap-4 border-t border-hairline py-4 first:border-t-0 first:pt-0 last:pb-0">
                <span className="t-data inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-hairline text-[12px] font-semibold text-ink">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[15px] leading-6 font-medium text-ink">{item.step}</p>
                    {item.href ? (
                      <Link href={item.href} className="text-[14px] font-medium text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
                        Open Decision Desk
                      </Link>
                    ) : (
                      <span className="t-data text-[11px] leading-4 font-semibold tracking-[0.1em] text-crosshair uppercase">Soon</span>
                    )}
                  </div>
                  <p className="text-[14px] leading-[22px]">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <p className="t-caption">Reflex is decision review and support. It isn&rsquo;t financial advice and doesn&rsquo;t place trades.</p>
    </div>
  );
}
