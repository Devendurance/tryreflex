"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { api, formatDate, type Snapshot } from "@/components/decisions/decision-api";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";
import { autopsyErrorMessage, type DecisionTrade } from "./autopsy-api";

const DECIMAL = /^\d{1,18}(\.\d{1,12})?$/;
const CURRENCY = /^[A-Z][A-Z0-9]{1,11}$/;
const SYMBOL = /^[A-Z][A-Z0-9._-]{0,29}$/;
const MAX_ATTEMPTS = 3;
const inputClass =
  "mt-1.5 h-11 w-full rounded-[10px] border border-hairline bg-white px-3 text-[15px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none aria-[invalid=true]:border-loss disabled:opacity-60";

const unknown = <span className="text-muted">Unknown</span>;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[14px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="t-caption mt-1">{hint}</p>}
    </div>
  );
}

function Fieldset({ legend, note, children }: { legend: string; note: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 border-t border-hairline pt-5">
      <legend className="t-eyebrow">{legend}</legend>
      <p className="mt-1 text-[14px] leading-[22px]">{note}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

type Values = Record<
  | "symbol"
  | "symbolOverrideReason"
  | "quantity"
  | "entryPrice"
  | "exitPrice"
  | "openedAt"
  | "closedAt"
  | "fees"
  | "settlementCurrency"
  | "amountInvested"
  | "proceedsReceived"
  | "entryMarketCap"
  | "exitMarketCap"
  | "peakObservedMarketCap"
  | "marketCapCurrency"
  | "retrospectiveComments",
  string
> & { executionState: "open" | "closed" | "unknown"; captureBasis: "" | "contemporaneous" | "retrospective" | "unknown"; cashFlowBasis: "unknown" | "gross_excluding_fees" | "net_including_fees" };

const OBSERVATIONS = ["quantity", "entryPrice", "exitPrice", "amountInvested", "proceedsReceived", "entryMarketCap", "exitMarketCap", "peakObservedMarketCap"] as const;
const CAPS = ["entryMarketCap", "exitMarketCap", "peakObservedMarketCap"] as const;

function validate(v: Values, decisionSymbol: string): Partial<Record<keyof Values | "form", string>> {
  const errors: Partial<Record<keyof Values | "form", string>> = {};
  const symbol = v.symbol.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) errors.symbol = "Use the ticker, letters and numbers only.";
  if (symbol !== decisionSymbol.toUpperCase() && !v.symbolOverrideReason.trim()) errors.symbolOverrideReason = "Explain why the traded symbol differs from the decision.";
  for (const key of OBSERVATIONS) if (v[key] && (!DECIMAL.test(v[key]) || /^0+(\.0+)?$/.test(v[key]))) errors[key] = "Enter a positive number like 1250.5, without commas.";
  if (v.fees && !DECIMAL.test(v.fees)) errors.fees = "Enter a number like 0.15, without commas.";
  if (v.proceedsReceived && DECIMAL.test(v.proceedsReceived)) delete errors.proceedsReceived;
  for (const key of ["settlementCurrency", "marketCapCurrency"] as const) if (v[key] && !CURRENCY.test(v[key].toUpperCase())) errors[key] = "Use a currency code like USD or USDT.";
  if (CAPS.some((key) => v[key]) && !v.marketCapCurrency) errors.marketCapCurrency = "Say which currency the market caps are in.";
  if ((v.amountInvested || v.proceedsReceived || v.fees) && !v.settlementCurrency) errors.settlementCurrency = "Say which currency these amounts are in.";
  const opened = v.openedAt ? new Date(v.openedAt).getTime() : null;
  const closed = v.closedAt ? new Date(v.closedAt).getTime() : null;
  if (opened !== null && opened > Date.now()) errors.openedAt = "This time is in the future.";
  if (closed !== null && closed > Date.now()) errors.closedAt = "This time is in the future.";
  if (closed !== null && v.executionState !== "closed") errors.closedAt = "Only a closed trade has an exit time. Set the state to closed or clear this.";
  if (opened !== null && closed !== null && closed < opened) errors.closedAt = "The exit can't be before the entry.";
  if (!v.captureBasis) errors.captureBasis = "Say when you're recording these facts.";
  if (!OBSERVATIONS.some((key) => v[key])) errors.form = "Add at least one real observation: a quantity, a price, an amount, or a market cap.";
  return errors;
}

function payload(v: Values, decisionId: string, side: "long" | "short", snapshotSymbol: string): Record<string, unknown> {
  const body: Record<string, unknown> = { decisionId, symbol: v.symbol.trim().toUpperCase(), side, executionState: v.executionState, captureBasis: v.captureBasis, cashFlowBasis: v.cashFlowBasis };
  for (const key of [...OBSERVATIONS, "fees"] as const) if (v[key]) body[key] = v[key];
  for (const key of ["settlementCurrency", "marketCapCurrency"] as const) if (v[key]) body[key] = v[key].toUpperCase();
  if (v.openedAt) body.openedAt = new Date(v.openedAt).toISOString();
  if (v.closedAt) body.closedAt = new Date(v.closedAt).toISOString();
  if (v.retrospectiveComments.trim()) body.retrospectiveComments = v.retrospectiveComments.trim();
  if (body.symbol !== snapshotSymbol.toUpperCase() && v.symbolOverrideReason.trim()) body.symbolOverrideReason = v.symbolOverrideReason.trim();
  return body;
}

function AttachForm({ decisionId, snapshot, onAttached, onCancel }: { decisionId: string; snapshot: Snapshot; onAttached: () => void; onCancel: () => void }) {
  const [values, setValues] = useState<Values>({
    symbol: snapshot.assetSymbol, symbolOverrideReason: "", quantity: "", entryPrice: "", exitPrice: "", openedAt: "", closedAt: "", fees: "", settlementCurrency: "",
    amountInvested: "", proceedsReceived: "", entryMarketCap: "", exitMarketCap: "", peakObservedMarketCap: "", marketCapCurrency: "", retrospectiveComments: "",
    executionState: "unknown", captureBasis: "", cashFlowBasis: "unknown",
  });
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const set = (key: keyof Values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const text = (key: keyof Values, label: string, hint?: string, extra: Record<string, unknown> = {}) => (
    <Field id={`trade-${key}`} label={label} hint={errors[key] ?? hint}>
      <input id={`trade-${key}`} value={values[key]} onChange={set(key)} disabled={pending} aria-invalid={errors[key] ? true : undefined} className={inputClass} {...extra} />
    </Field>
  );
  const decimal = (key: keyof Values, label: string, hint?: string) => text(key, label, hint, { inputMode: "decimal", autoComplete: "off", className: `${inputClass} t-data` });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const found = validate(values, snapshot.assetSymbol);
    if (!attested) found.form = found.form ?? "Confirm that these facts describe this decision's real trade.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    inFlight.current = true;
    setPending(true);
    setServerError(null);
    try {
      await api("/api/trades/manual", { method: "POST", body: JSON.stringify(payload(values, decisionId, snapshot.side as "long" | "short", snapshot.assetSymbol)) });
      onAttached();
    } catch (thrown) {
      setServerError(autopsyErrorMessage(thrown, "attach"));
      inFlight.current = false;
      setPending(false);
    }
  };

  const symbolDiffers = values.symbol.trim().toUpperCase() !== snapshot.assetSymbol.toUpperCase();
  return (
    <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-6 rounded-[12px] border border-hairline bg-cream/40 p-4 sm:p-5" aria-busy={pending}>
      <p className="text-[14px] leading-[22px]">
        Enter only what you actually know. Leave everything else empty and Reflex keeps it unknown. Your confirmed decision stays exactly as it is.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {text("symbol", "Traded symbol", undefined, { autoCapitalize: "characters", spellCheck: false, className: `${inputClass} t-data uppercase` })}
        <Field id="trade-side" label="Direction" hint="Fixed by your confirmed decision">
          <input id="trade-side" value={snapshot.side === "short" ? "Short" : "Long"} readOnly className={`${inputClass} bg-paper`} />
        </Field>
        <Field id="trade-executionState" label="Trade state">
          <select id="trade-executionState" value={values.executionState} onChange={set("executionState")} disabled={pending} className={inputClass}>
            <option value="unknown">Not sure</option>
            <option value="open">Still open</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        {symbolDiffers && <div className="sm:col-span-2 lg:col-span-3">{text("symbolOverrideReason", "Why the symbol differs", "Required when the traded symbol isn't the decision's symbol")}</div>}
      </div>
      <Fieldset legend="Execution" note="Prices are per token or share, never an amount invested or a market cap.">
        {decimal("quantity", "Quantity")}
        {decimal("entryPrice", "Entry price per unit")}
        {decimal("exitPrice", "Exit price per unit")}
        {text("openedAt", "Entry time", errors.openedAt ? undefined : `Your device timezone, ${timezone}`, { type: "datetime-local" })}
        {text("closedAt", "Exit time", errors.closedAt ? undefined : "Only for a closed trade", { type: "datetime-local" })}
        {decimal("fees", "Fees paid")}
      </Fieldset>
      <Fieldset legend="Money in and out" note="Actual amounts you invested and received. Reflex won't call a market-cap move a return.">
        {decimal("amountInvested", "Amount invested")}
        {decimal("proceedsReceived", "Proceeds received")}
        {text("settlementCurrency", "Currency of these amounts", undefined, { autoCapitalize: "characters", spellCheck: false, className: `${inputClass} t-data uppercase`, maxLength: 12 })}
        <Field id="trade-cashFlowBasis" label="Do these amounts include fees?">
          <select id="trade-cashFlowBasis" value={values.cashFlowBasis} onChange={set("cashFlowBasis")} disabled={pending} className={inputClass}>
            <option value="unknown">Not sure</option>
            <option value="gross_excluding_fees">No, before fees</option>
            <option value="net_including_fees">Yes, after fees</option>
          </select>
        </Field>
      </Fieldset>
      <Fieldset legend="Market caps you saw" note="Valuations at entry, exit and the highest you noticed. These describe the market, not your profit.">
        {decimal("entryMarketCap", "Market cap at entry")}
        {decimal("exitMarketCap", "Market cap at exit")}
        {decimal("peakObservedMarketCap", "Highest market cap you saw")}
        {text("marketCapCurrency", "Market cap currency", undefined, { autoCapitalize: "characters", spellCheck: false, className: `${inputClass} t-data uppercase`, maxLength: 12 })}
      </Fieldset>
      <fieldset className="min-w-0 border-t border-hairline pt-5">
        <legend className="t-eyebrow">When are you recording this?</legend>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-5">
          {([["contemporaneous", "During or right after the trade"], ["retrospective", "Later, from memory"], ["unknown", "Not sure"]] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-[15px] text-ink">
              <input type="radio" name="captureBasis" value={value} checked={values.captureBasis === value} onChange={set("captureBasis")} disabled={pending} className="size-4 accent-[#241B15]" />
              {label}
            </label>
          ))}
        </div>
        {errors.captureBasis && <p className="mt-2 text-[13px] text-loss">{errors.captureBasis}</p>}
      </fieldset>
      <div className="border-t border-hairline pt-5">
        <Field id="trade-retrospectiveComments" label="What you remember now (optional)" hint="Kept separate from what you believed before the trade. Mention any target you changed and when.">
          <textarea id="trade-retrospectiveComments" value={values.retrospectiveComments} onChange={set("retrospectiveComments")} maxLength={4000} rows={4} disabled={pending} className={`${inputClass} h-auto py-2.5 leading-[23px]`} />
        </Field>
      </div>
      <label className="flex cursor-pointer gap-3 text-[15px] leading-[23px] text-ink">
        <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={pending} className="mt-1 size-4 shrink-0 accent-[#241B15]" />
        These facts describe the real trade I made on this decision.
      </label>
      {(errors.form || Object.keys(errors).length > 0) && (
        <FormNotice tone="error">{errors.form ?? "Some fields need attention. They're marked above."}</FormNotice>
      )}
      {serverError && <FormNotice tone="error">{serverError}</FormNotice>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {pending ? "Saving evidence" : "Save trade evidence"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={buttonClass("quiet")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RequestAutopsy({ tradeId }: { tradeId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const exhausted = attempts >= MAX_ATTEMPTS;

  const run = async () => {
    if (inFlight.current || exhausted) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api<{ review: { id: string } }>("/api/reviews/generate", { method: "POST", body: JSON.stringify({ tradeId }) });
      router.push(`/app/autopsies/${result.review.id}`);
    } catch (thrown) {
      setAttempts((count) => count + 1);
      setError(autopsyErrorMessage(thrown, "generate"));
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run()} disabled={pending || exhausted} className={buttonClass("primary", "sm")}>
          {pending && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {pending ? "Reviewing the evidence" : error ? "Try the autopsy again" : "Request autopsy"}
        </button>
        {pending && (
          <p role="status" className="text-[14px]">
            Reflex is checking every claim against your evidence. This can take up to a minute.
          </p>
        )}
      </div>
      {error && (
        <FormNotice tone="error">
          {error}
          {exhausted && " You've tried three times on this page. Reload later to try again."}
        </FormNotice>
      )}
    </div>
  );
}

function TradeCard({ trade }: { trade: DecisionTrade }) {
  const value = (v: string | null) => (v ? <span className="t-data">{v}</span> : unknown);
  return (
    <li className="rounded-[12px] border border-hairline p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[16px] font-medium text-ink">{trade.symbol}</span>
        <Tag>{trade.side === "short" ? "Short" : "Long"}</Tag>
        <Tag>{trade.provider === "manual" ? "Entered by you" : "Bitget"}</Tag>
        <span className="t-caption">Added {formatDate(trade.createdAt)}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-5">
        {(
          [
            ["Quantity", value(trade.quantity)],
            ["Entry price", value(trade.entryPrice)],
            ["Exit price", value(trade.exitPrice)],
            ["Entry time", trade.openedAt ? formatDate(trade.openedAt) : unknown],
            ["Exit time", trade.closedAt ? formatDate(trade.closedAt) : unknown],
          ] as const
        ).map(([label, content]) => (
          <div key={label} className="min-w-0">
            <dt className="t-eyebrow text-[11px]">{label}</dt>
            <dd className="mt-1 break-words text-ink">{content}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-hairline pt-4">
        {trade.currentReview ? (
          <Link href={`/app/autopsies/${trade.currentReview.id}`} className="inline-flex items-center gap-2 text-[15px] font-medium text-ink underline underline-offset-4">
            Open autopsy, version {trade.currentReview.version} <ArrowRight size={16} aria-hidden />
          </Link>
        ) : (
          <RequestAutopsy tradeId={trade.id} />
        )}
      </div>
    </li>
  );
}

export function TradeEvidence({ decisionId, snapshot }: { decisionId: string; snapshot: Snapshot }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; trades: DecisionTrade[] } | { kind: "error"; message: string }>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    try {
      const body = await api<{ trades: DecisionTrade[] }>(`/api/decisions/${decisionId}/trades`);
      setState({ kind: "ready", trades: body.trades });
    } catch (thrown) {
      setState({ kind: "error", message: autopsyErrorMessage(thrown, "load") });
    }
  }, [decisionId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- owner-scoped fetch of this decision's trades
  useEffect(() => void load(), [load]);

  const watchOnly = snapshot.side === "watch";
  return (
    <Panel id="trades-title" title="What actually happened" aside={<Tag>Trade evidence</Tag>}>
      <p className="max-w-[64ch] text-[14px] leading-[22px]">
        An autopsy compares what you believed with what you did. Imported exchange orders aren&rsquo;t attached automatically, and payment conversions never are.
      </p>
      <div className="mt-4" aria-live="polite">
        {state.kind === "loading" && (
          <p className="inline-flex items-center gap-2 text-[14px]">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading trade evidence
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
        {saved && <FormNotice tone="success">Trade evidence saved. When you&rsquo;re ready, request an autopsy below.</FormNotice>}
        {state.kind === "ready" && state.trades.length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {state.trades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} />
            ))}
          </ul>
        )}
        {state.kind === "ready" && state.trades.length === 0 && !adding && (
          <div className="rounded-[12px] border border-dashed border-hairline p-5 text-[15px]">
            <p className="font-medium text-ink">No trade evidence yet.</p>
            <p className="mt-1">
              {watchOnly
                ? "This was a watch-only decision, so there's no trade to review."
                : "If you acted on this decision, add the facts you genuinely know. Without them, Reflex won't produce an autopsy."}
            </p>
          </div>
        )}
      </div>
      {state.kind === "ready" && !watchOnly && !adding && (
        <button type="button" onClick={() => { setAdding(true); setSaved(false); }} className={`${buttonClass(state.trades.length ? "quiet" : "secondary", "sm")} mt-4`}>
          Add trade evidence
        </button>
      )}
      {adding && (
        <AttachForm
          decisionId={decisionId}
          snapshot={snapshot}
          onCancel={() => setAdding(false)}
          onAttached={() => {
            setAdding(false);
            setSaved(true);
            void load();
          }}
        />
      )}
    </Panel>
  );
}
