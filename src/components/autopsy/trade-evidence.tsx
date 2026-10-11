"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { ApiDiagnosis, ApiError, api, formatDate, type Snapshot } from "@/components/decisions/decision-api";
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

type PreviewTrade = {
  externalId: string;
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  fees: string;
  realizedPnl: string;
  openedAt: string;
  closedAt: string;
};

type PreviewResult = {
  trades: PreviewTrade[];
  rejected: { externalId: string | null }[];
  nextCursor: string | null;
  provider: string;
  retrievedAt: string;
};

const FUTURES_SYMBOL = /^[A-Z0-9]{1,30}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}

function toDateInput(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function bitgetErrorMessage(error: unknown): string {
  const apiError = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  const { status } = apiError;
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 403) return "Bitget import isn't available for this sign-in. Manual entry still works.";
  if (status === 400) return "Check the symbol and date range, then preview again.";
  if (status === 404) return "This decision doesn't exist, or it belongs to another account.";
  return `Bitget history is unavailable right now. Nothing was saved. Try again later.${diagnosisNote(apiError.diagnosis)}`;
}

function diagnosisNote(diagnosis: ApiDiagnosis | null): string {
  if (!diagnosis) return "";
  const when = diagnosis.stage === "after_request" ? "after contacting Bitget" : diagnosis.stage === "before_request" ? "before contacting Bitget" : "around the Bitget request";
  const code = diagnosis.providerCode === "CODE_UNAVAILABLE" ? "with no exchange code returned" : `with exchange code ${diagnosis.providerCode}`;
  return ` For the record, the failure happened ${when}, ${code}.`;
}

function BitgetImport({ decisionId, snapshot, onImported }: { decisionId: string; snapshot: Snapshot; onImported: () => void }) {
  const [availability, setAvailability] = useState<"checking" | "available" | "hidden">("checking");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"USDT-FUTURES" | "USDC-FUTURES">("USDT-FUTURES");
  const [symbol, setSymbol] = useState(snapshot.assetSymbol.toUpperCase());
  const [start, setStart] = useState<string>(() => toDateInput(Date.now() - 29 * DAY_MS));
  const [end, setEnd] = useState<string>(() => toDateInput(Date.now()));
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "ready"; result: PreviewResult; cursor: string | undefined } | { kind: "error"; message: string }>({ kind: "idle" });
  const [selected, setSelected] = useState<string[]>([]);
  const [importState, setImportState] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "done"; imported: number; deduplicated: number } | { kind: "error"; message: string }>({ kind: "idle" });
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api<{ available: boolean }>("/api/trades/bitget/availability")
      .then(() => { if (!cancelled) setAvailability("available"); })
      .catch(() => { if (!cancelled) setAvailability("hidden"); });
    return () => { cancelled = true; };
  }, []);

  if (availability !== "available") return null;

  const cleanSymbol = symbol.trim().toUpperCase();
  const needsOverride = cleanSymbol !== snapshot.assetSymbol.toUpperCase();

  const buildQuery = (cursor: string | undefined) => {
    const startTime = new Date(`${start}T00:00:00`).getTime();
    const endTime = new Date(`${end}T23:59:59`).getTime();
    return { category, symbol: cleanSymbol, startTime, endTime, ...(cursor === undefined ? {} : { cursor }) };
  };

  const validateQuery = (now: number): string | null => {
    if (!FUTURES_SYMBOL.test(cleanSymbol)) return "Use the Futures ticker as letters and numbers only, like BTCUSDT.";
    const startTime = new Date(`${start}T00:00:00`).getTime();
    const endTime = new Date(`${end}T23:59:59`).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) return "Pick a valid start and end date.";
    if (endTime > now) return "The end date can't be in the future.";
    if (endTime - startTime > 30 * DAY_MS) return "Keep the range within 30 days.";
    if (startTime < now - 90 * DAY_MS) return "Bitget only shows the last 90 days.";
    return null;
  };

  const runPreview = async (cursor: string | undefined) => {
    if (inFlight.current) return;
    const problem = validateQuery(now());
    if (problem) { setPreview({ kind: "error", message: problem }); return; }
    inFlight.current = true;
    setPreview({ kind: "pending" });
    setSelected([]);
    setImportState({ kind: "idle" });
    try {
      const result = await api<PreviewResult>("/api/trades/history", { method: "POST", body: JSON.stringify(buildQuery(cursor)) });
      setPreview({ kind: "ready", result, cursor });
    } catch (thrown) {
      setPreview({ kind: "error", message: bitgetErrorMessage(thrown) });
    } finally {
      inFlight.current = false;
    }
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= 10) return current;
      return [...current, id];
    });
  };

  const runImport = async () => {
    if (inFlight.current || preview.kind !== "ready" || selected.length === 0) return;
    if (needsOverride && !overrideReason.trim()) {
      setImportState({ kind: "error", message: "Explain why this symbol differs from the decision before importing." });
      return;
    }
    inFlight.current = true;
    setImportState({ kind: "pending" });
    try {
      const body: Record<string, unknown> = { decisionId, query: buildQuery(preview.cursor), externalIds: selected };
      if (needsOverride) body.symbolOverrideReason = overrideReason.trim();
      const result = await api<{ imported: unknown[]; deduplicated: unknown[] }>("/api/trades/import", { method: "POST", body: JSON.stringify(body) });
      setImportState({ kind: "done", imported: result.imported.length, deduplicated: result.deduplicated.length });
      setSelected([]);
      onImported();
    } catch (thrown) {
      setImportState({ kind: "error", message: bitgetErrorMessage(thrown) });
    } finally {
      inFlight.current = false;
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("quiet", "sm")} mt-4`}>
        Import from Bitget Futures
      </button>
    );
  }

  const ready = preview.kind === "ready" ? preview.result : null;
  return (
    <div className="mt-4 rounded-[12px] border border-hairline p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-medium text-ink">Import from Bitget Futures</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-[14px] font-medium underline underline-offset-4">
          Close
        </button>
      </div>
      <p className="mt-1 text-[14px] leading-[22px]">
        Preview closed Futures positions, then choose up to 10 to save as trade evidence. Previewing saves nothing.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id="bitget-category" label="Contract type">
          <select id="bitget-category" value={category} onChange={(event) => setCategory(event.target.value as "USDT-FUTURES" | "USDC-FUTURES")} className={inputClass}>
            <option value="USDT-FUTURES">USDT-FUTURES</option>
            <option value="USDC-FUTURES">USDC-FUTURES</option>
          </select>
        </Field>
        <Field id="bitget-symbol" label="Symbol" hint="Futures ticker, letters and numbers only.">
          <input id="bitget-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} className={inputClass} autoComplete="off" />
        </Field>
        <Field id="bitget-start" label="From">
          <input id="bitget-start" type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} className={inputClass} />
        </Field>
        <Field id="bitget-end" label="To">
          <input id="bitget-end" type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} className={inputClass} />
        </Field>
      </div>
      {needsOverride && FUTURES_SYMBOL.test(cleanSymbol) && (
        <div className="mt-4">
          <Field id="bitget-override" label="Why does this differ from the decision?" hint="Previewing needs no explanation. This is only required if you go on to import.">
            <textarea id="bitget-override" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={2} className={`${inputClass} h-auto min-h-[64px] py-2`} />
          </Field>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void runPreview(undefined)} disabled={preview.kind === "pending"} className={buttonClass("secondary", "sm")}>
          {preview.kind === "pending" && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {preview.kind === "pending" ? "Reading history" : "Preview closed positions"}
        </button>
        {preview.kind === "pending" && <p role="status" className="text-[14px]">Asking Bitget for closed positions. This can take a few seconds.</p>}
      </div>
      {preview.kind === "error" && <div className="mt-4"><FormNotice tone="error">{preview.message}</FormNotice></div>}
      {ready && (
        <div className="mt-4" aria-live="polite">
          <p className="t-caption">Retrieved {formatDate(ready.retrievedAt)} from Bitget ({category}). Net PnL is the provider-reported figure; Reflex doesn&rsquo;t recalculate it or subtract fees again. Times are position open/close as reported, not exact fills.</p>
          {ready.rejected.length > 0 && (
            <p className="mt-2 text-[14px]">Skipped {ready.rejected.length} incomplete {ready.rejected.length === 1 ? "position" : "positions"} that {ready.rejected.length === 1 ? "wasn't" : "weren't"} fully closed.</p>
          )}
          {ready.trades.length === 0 ? (
            <p className="mt-3 text-[15px]">No closed positions in this range. Widen the dates or try another symbol.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {ready.trades.map((trade) => {
                const checked = selected.includes(trade.externalId);
                const capped = !checked && selected.length >= 10;
                const rows: [string, string][] = [
                  ["Quantity", trade.quantity],
                  ["Entry price", trade.entryPrice],
                  ["Exit price", trade.exitPrice],
                  ["Fees", trade.fees],
                  ["Net PnL (reported)", trade.realizedPnl],
                  ["Opened", formatDate(trade.openedAt)],
                  ["Closed", formatDate(trade.closedAt)],
                ];
                return (
                  <li key={trade.externalId} className="rounded-[10px] border border-hairline p-3 sm:p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" checked={checked} disabled={capped} onChange={() => toggle(trade.externalId)} className="mt-1 h-5 w-5 accent-[#f26b1d]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-[15px] font-medium text-ink">{trade.symbol}</span>
                          <Tag>{trade.side === "short" ? "Short" : "Long"}</Tag>
                          <span className="t-caption">Preview only, not imported</span>
                        </span>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                          {rows.map(([label, content]) => (
                            <div key={label} className="min-w-0">
                              <dt className="t-eyebrow text-[11px]">{label}</dt>
                              <dd className="t-data mt-0.5 break-words">{content}</dd>
                            </div>
                          ))}
                        </dl>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {ready.nextCursor && (
              <button type="button" onClick={() => void runPreview(ready.nextCursor ?? undefined)} disabled={preview.kind === "pending"} className={buttonClass("quiet", "sm")}>
                Load more
              </button>
            )}
            {ready.trades.length > 0 && (
              <button type="button" onClick={() => void runImport()} disabled={importState.kind === "pending" || selected.length === 0} className={buttonClass("primary", "sm")}>
                {importState.kind === "pending" ? "Saving" : `Import ${selected.length} selected`}
              </button>
            )}
            {selected.length >= 10 && <p className="t-caption">Up to 10 positions per import.</p>}
          </div>
          {importState.kind === "error" && <div className="mt-4"><FormNotice tone="error">{importState.message}</FormNotice></div>}
          {importState.kind === "done" && (
            <div className="mt-4">
              <FormNotice tone="success">
                Saved {importState.imported} {importState.imported === 1 ? "position" : "positions"}
                {importState.deduplicated > 0 && `, ${importState.deduplicated} already saved and skipped`}. The evidence list above is refreshed.
              </FormNotice>
            </div>
          )}
        </div>
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
      {state.kind === "ready" && !watchOnly && (
        <BitgetImport decisionId={decisionId} snapshot={snapshot} onImported={() => { setSaved(true); void load(); }} />
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
