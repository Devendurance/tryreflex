"use client";

import { ArrowRight, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { formatDate } from "@/components/decisions/decision-api";
import { buttonClass } from "@/components/landing/primitives";
import {
  activityErrorMessage,
  formatBytes,
  MAX_FILE_BYTES,
  PURPOSE_ORDER,
  PURPOSES,
  SCOPE_PATTERN,
  upload,
  WARNINGS,
  type CommitResult,
  type PreviewResult,
  type Purpose,
} from "./activity-api";
import { DirectionTag, Fact, Fills, MissingData, Num, OrderFacts, PurposeChoice, Totals } from "./activity-parts";

type Reviewed = { result: PreviewResult; file: File; scope: string };

function Step({ n, title }: { n: number; title: string }) {
  return (
    <p className="flex items-center gap-3 text-[15px] font-medium text-ink">
      <span className="t-data grid size-7 place-items-center rounded-full border border-ink text-[13px]">{n}</span>
      {title}
    </p>
  );
}

export function ImportFlow({ onCommitted }: { onCommitted: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState("main");
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [purposes, setPurposes] = useState<Record<string, Purpose>>({});
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const inFlight = useRef(false);

  const invalidate = () => {
    setReviewed(null);
    setPurposes({});
    setAttested(false);
    setError(null);
  };

  const reset = () => {
    invalidate();
    setFile(null);
    setDone(null);
    setInputKey((key) => key + 1);
  };

  const preview = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!file) return setError("Choose a CSV file first.");
    if (file.size > MAX_FILE_BYTES) return setError("That file is over the 2 MB limit. Export a shorter date range and try again.");
    if (!SCOPE_PATTERN.test(scope)) return setError("Account label must start with a lowercase letter or number and use only a-z, 0-9, hyphens or underscores.");
    inFlight.current = true;
    setBusy("preview");
    invalidate();
    const form = new FormData();
    form.append("file", file);
    form.append("accountScope", scope);
    try {
      const result = await upload<PreviewResult>("/api/imports/bitget-classic/preview", form);
      setReviewed({ result, file, scope });
      setPurposes(Object.fromEntries(result.preview.orders.map((order) => [order.orderId, "unknown" as Purpose])));
    } catch (thrown) {
      setError(activityErrorMessage(thrown, "preview"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const commit = async () => {
    if (inFlight.current || !reviewed) return;
    if (!attested) return setError("Tick the confirmation box before saving.");
    inFlight.current = true;
    setBusy("commit");
    setError(null);
    const form = new FormData();
    form.append("file", reviewed.file);
    form.append("accountScope", reviewed.scope);
    form.append("previewHash", reviewed.result.preview.sourceHash);
    form.append("confirmed", "true");
    form.append("purposes", JSON.stringify(reviewed.result.preview.orders.map((order) => ({ orderId: order.orderId, purpose: purposes[order.orderId] ?? "unknown" }))));
    try {
      const result = await upload<CommitResult>("/api/imports/bitget-classic/commit", form);
      setDone(result);
      setReviewed(null);
      onCommitted();
    } catch (thrown) {
      setError(activityErrorMessage(thrown, "commit"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (done) return <ImportResult result={done} onAnother={reset} />;

  const orders = reviewed?.result.preview.orders ?? [];
  const duplicates = new Map((reviewed?.result.duplicateCandidates ?? []).map((candidate) => [candidate.orderId, candidate]));
  const conflicts = [...duplicates.values()].filter((candidate) => candidate.conflict !== null);
  const eligible = reviewed?.result.preview.importEligible ?? false;
  const tally = PURPOSE_ORDER.map((purpose) => [purpose, orders.filter((order) => purposes[order.orderId] === purpose).length] as const).filter(([, count]) => count > 0);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={preview} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6" aria-busy={busy === "preview"}>
        <Step n={1} title="Choose your Bitget Classic export" />
        <p className="mt-2 max-w-[64ch] text-[14px] leading-[22px]">
          In Bitget Classic, export Spot order history as CSV. Reflex reads it here, shows you every order and fill, and saves nothing until you confirm. The file never goes to an AI service.
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            <label htmlFor="csv-file" className="text-[14px] font-medium text-ink">
              CSV file
            </label>
            <label
              htmlFor="csv-file"
              className="mt-2 flex min-h-[72px] cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-hairline bg-cream/40 p-4 transition-colors hover:bg-cream has-[:focus-visible]:border-ink has-[:focus-visible]:shadow-[0_0_0_4px_rgba(242,107,29,.18)]"
            >
              <FileUp size={20} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 text-[14px]">
                {file ? (
                  <>
                    <span className="block truncate font-medium text-ink">{file.name}</span>
                    <span className="t-caption">{formatBytes(file.size)} · choose a different file</span>
                  </>
                ) : (
                  <span>Select a .csv file, up to 2 MB</span>
                )}
              </span>
              <input
                key={inputKey}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  invalidate();
                }}
              />
            </label>
          </div>
          <div>
            <label htmlFor="account-scope" className="text-[14px] font-medium text-ink">
              Account label
            </label>
            <input
              id="account-scope"
              value={scope}
              disabled={busy !== null}
              onChange={(event) => {
                setScope(event.target.value);
                invalidate();
              }}
              aria-describedby="account-scope-help"
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              className="t-data mt-2 h-12 w-full rounded-[12px] border border-hairline bg-white px-4 text-[15px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none disabled:opacity-60"
            />
            <p id="account-scope-help" className="t-caption mt-1.5">
              Your own name for this account, such as main. Reflex can&rsquo;t verify it.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy !== null} className={buttonClass(reviewed ? "quiet" : "primary")}>
            {busy === "preview" && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {busy === "preview" ? "Reading the file" : reviewed ? "Preview again" : "Preview file"}
          </button>
          {busy === "preview" && (
            <p role="status" className="text-[14px]">
              Checking every row. Nothing is saved yet.
            </p>
          )}
        </div>
        {error && !reviewed && (
          <div className="mt-4">
            <FormNotice tone="error">{error}</FormNotice>
          </div>
        )}
      </form>

      {reviewed && (
        <>
          <Panel id="preview-title" title="What the file contains" aside={<Tag>Preview, not saved</Tag>}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
              <Fact label="File">
                <span className="break-all">{reviewed.file.name}</span>
              </Fact>
              <Fact label="Account label" hint="Declared by you, not verified">
                <span className="t-data">{reviewed.scope}</span>
              </Fact>
              <Fact label="Source">Bitget Classic spot order history</Fact>
              <Fact label="Pairs">{reviewed.result.preview.summary.uniqueTradingPairs.join(", ") || "None"}</Fact>
              <Fact label="Orders">
                <Num value={String(reviewed.result.preview.summary.totalOrders)} />
              </Fact>
              <Fact label="Fills">
                <Num value={String(reviewed.result.preview.summary.totalExecutionRows)} />
              </Fact>
              <Fact label="Buys / sells">
                <Num value={`${reviewed.result.preview.summary.buys} / ${reviewed.result.preview.summary.sells}`} />
              </Fact>
              <Fact label="Can be imported">{eligible ? "Yes" : "No, some orders are incomplete"}</Fact>
            </dl>
            <div className="mt-6 flex flex-col gap-3 border-t border-hairline pt-5">
              <h3 className="t-eyebrow">What to know about this file</h3>
              <ul className="flex flex-col gap-2 text-[14px] leading-[22px]">
                {reviewed.result.preview.warnings.map((warning) => (
                  <li key={warning} className="border-l-2 border-hairline pl-3">
                    {WARNINGS[warning] ?? warning}
                  </li>
                ))}
              </ul>
              <MissingData items={reviewed.result.preview.missingData} />
            </div>
            {reviewed.result.preview.summary.financialGroups.map((group) => (
              <div key={`${group.baseAsset}-${group.quoteAsset}-${group.direction}`} className="mt-6 border-t border-hairline pt-5">
                <h3 className="t-eyebrow">
                  Reported totals · {group.direction === "sell" ? "Sells" : "Buys"} of {group.baseAsset}/{group.quoteAsset}
                </h3>
                <div className="mt-3">
                  <Totals group={group} />
                </div>
              </div>
            ))}
          </Panel>

          <section aria-labelledby="orders-title" className="flex flex-col gap-4">
            <div>
              <Step n={2} title="Review each order and choose its purpose" />
              <p id="orders-title" className="mt-2 max-w-[64ch] text-[14px] leading-[22px]">
                Every order starts as Unknown. Reflex never guesses why you traded, and a sell is not assumed to be a trade. Only speculative trades can later be linked to a decision, and even that never happens automatically.
              </p>
            </div>
            {orders.map((order, index) => {
              const duplicate = duplicates.get(order.orderId);
              return (
                <article key={order.orderId} aria-labelledby={`order-${index}`} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 id={`order-${index}`} className="text-[18px] font-medium text-ink">
                      {order.tradingPair}
                    </h3>
                    <DirectionTag direction={order.direction} />
                    {!order.complete && <Tag>Incomplete</Tag>}
                    {duplicate && <Tag tone="inferred">{duplicate.conflict ? "Conflicts with saved order" : "Already imported"}</Tag>}
                  </div>
                  {duplicate && (
                    <p className="mt-2 text-[14px] leading-[22px]">
                      {duplicate.conflict
                        ? "You already imported an order with this ID, and its details differ. Reflex won't overwrite saved activity."
                        : "You already imported this order. Its saved purpose stays as it is. Change it from the activity page if needed."}
                    </p>
                  )}
                  <div className="mt-5">
                    <OrderFacts order={order} />
                  </div>
                  <div className="mt-5">
                    <h4 className="t-eyebrow mb-3">Fills, as reported</h4>
                    <Fills order={order} />
                  </div>
                  <div className="mt-5 border-t border-hairline pt-5">
                    <PurposeChoice
                      name={`purpose-${order.orderId}`}
                      legend="Why did this order happen?"
                      value={purposes[order.orderId] ?? "unknown"}
                      disabled={busy !== null}
                      onChange={(purpose) => {
                        setPurposes((current) => ({ ...current, [order.orderId]: purpose }));
                        setAttested(false);
                      }}
                    />
                  </div>
                </article>
              );
            })}
          </section>

          <section aria-labelledby="confirm-title" className="rounded-[12px] border border-ink/70 bg-white p-5 sm:p-6" aria-busy={busy === "commit"}>
            <Step n={3} title="Confirm the import" />
            <h3 id="confirm-title" className="sr-only">
              Confirm the import
            </h3>
            <ul className="mt-4 flex flex-col gap-2 text-[14px] leading-[22px]">
              <li>
                <span className="t-data text-ink">{orders.filter((order) => order.complete).length}</span> of <span className="t-data text-ink">{orders.length}</span> orders can be imported.
              </li>
              <li>Purposes: {tally.map(([purpose, count]) => `${count} ${PURPOSES[purpose].name.toLowerCase()}`).join(", ")}.</li>
              <li>
                <span className="t-data text-ink">{duplicates.size - conflicts.length}</span> already imported, kept as saved.{" "}
                <span className="t-data text-ink">{conflicts.length}</span> in conflict.
              </li>
              <li>The account label &ldquo;{reviewed.scope}&rdquo; is yours. Reflex can&rsquo;t prove which Bitget account this file came from, and it isn&rsquo;t matched to API data.</li>
              <li>Saving records exchange history only. It doesn&rsquo;t create a decision, a review or any profit figure.</li>
            </ul>
            {!eligible && (
              <div className="mt-4">
                <FormNotice tone="error">Some orders have incomplete fills, so this file can&rsquo;t be imported. Export the full history for those orders and preview again.</FormNotice>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="mt-4">
                <FormNotice tone="error">
                  {conflicts.length === 1 ? "One order conflicts" : `${conflicts.length} orders conflict`} with activity you already saved. Reflex won&rsquo;t import this file because it never overwrites saved history.
                </FormNotice>
              </div>
            )}
            <label className="mt-5 flex cursor-pointer gap-3 text-[15px] leading-[23px] text-ink">
              <input
                type="checkbox"
                checked={attested}
                disabled={busy !== null || !eligible || conflicts.length > 0}
                onChange={(event) => setAttested(event.target.checked)}
                className="mt-1 size-4 shrink-0 accent-[#241B15]"
              />
              I&rsquo;ve checked these orders and the purpose I chose for each one.
            </label>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void commit()} disabled={busy !== null || !eligible || conflicts.length > 0} className={buttonClass("primary")}>
                {busy === "commit" && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                {busy === "commit" ? "Saving import" : "Save import"}
              </button>
              <button type="button" onClick={reset} disabled={busy !== null} className={buttonClass("quiet")}>
                Cancel
              </button>
            </div>
            {error && (
              <div className="mt-4">
                <FormNotice tone="error">{error}</FormNotice>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ImportResult({ result, onAnother }: { result: CommitResult; onAnother: () => void }) {
  return (
    <section aria-labelledby="result-title" className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
      <FormNotice tone="success">
        <span id="result-title" className="font-medium">
          {result.repeatedFile ? "You'd already imported this exact file. Nothing new was added." : "Import saved to your private record."}
        </span>
        {result.repeatedFile && " Your earlier purposes were kept. Change them from each activity page."}
      </FormNotice>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Fact label="New orders">
          <Num value={String(result.insertedOrderCount)} />
        </Fact>
        <Fact label="Already saved orders">
          <Num value={String(result.existingOrderCount)} />
        </Fact>
        <Fact label="New fills">
          <Num value={String(result.insertedExecutionCount)} />
        </Fact>
        <Fact label="Already saved fills">
          <Num value={String(result.existingExecutionCount)} />
        </Fact>
        <Fact label="Receipt">
          <Link href={`/app/activity/imports/${result.import.id}`} className="t-data text-[13px] break-all underline underline-offset-4">
            {result.import.id}
          </Link>
        </Fact>
        <Fact label="Imported">{formatDate(result.import.imported_at)}</Fact>
        <Fact label="File">{result.import.source_filename ?? "Not recorded"}</Fact>
        <Fact label="Account label">
          <span className="t-data">{result.import.account_scope}</span>
        </Fact>
      </dl>
      <h3 className="t-eyebrow mt-6">Activity in this import</h3>
      <ul className="mt-3 divide-y divide-hairline rounded-[12px] border border-hairline">
        {result.activities.map((activity) => (
          <li key={activity.id}>
            <Link href={`/app/activity/${activity.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-cream">
              <span className="min-w-0 flex-1 text-[15px] text-ink">
                {activity.tradingPair} {activity.direction} · <span className="text-muted">{PURPOSES[activity.purpose.value].name}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAnother} className={`${buttonClass("quiet")} mt-5`}>
        Import another file
      </button>
    </section>
  );
}
