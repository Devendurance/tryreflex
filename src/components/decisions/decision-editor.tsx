"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { buttonClass } from "@/components/landing/primitives";
import {
  api,
  apiErrorMessage,
  ASSET_CLASSES,
  isInference,
  KNOWLEDGE_BASIS,
  ORIGINS,
  SIDES,
  SOURCE_TYPES,
  type AssetClass,
  type DecisionRecord,
  type KnowledgeBasis,
  type OriginLabel,
  type Side,
  type Snapshot,
  type SnapshotSource,
  type SourceType,
} from "./decision-api";
import { Tag } from "./decision-parts";

type SourceRow = { key: string; sourceType: SourceType; label: string; url: string; note: string; fromText: boolean };

type FormState = {
  assetSymbol: string;
  assetClass: AssetClass | "";
  side: Side | "";
  thesis: string;
  catalyst: string;
  confidence: string;
  intendedEntry: string;
  intendedTakeProfitMarketCap: string;
  marketCapCurrency: string;
  knowledgeBasis: KnowledgeBasis | "";
  invalidation: string;
  intendedRiskPct: string;
  timeframe: string;
  origins: OriginLabel[];
  sources: SourceRow[];
};

type Errors = Partial<Record<keyof FormState | "attest" | `source-${string}`, string>>;

const SYMBOL = /^[A-Za-z][A-Za-z0-9.-]{0,14}$/;
const DECIMAL = /^\d{1,18}(\.\d{1,12})?$/;
const CURRENCY = /^[A-Z][A-Z0-9]{1,11}$/;

function initialState(record: DecisionRecord): FormState {
  const inference = isInference(record.decision.structuredView) ? record.decision.structuredView : null;
  return {
    assetSymbol: inference?.assetSymbol ?? "",
    assetClass: inference?.assetClass ?? "",
    side: inference?.side ?? "",
    thesis: inference?.thesis ?? "",
    catalyst: inference?.catalyst ?? "",
    confidence: "",
    intendedEntry: inference?.intendedEntry?.toString() ?? "",
    intendedTakeProfitMarketCap: "",
    marketCapCurrency: "",
    knowledgeBasis: "",
    invalidation: inference?.invalidation ?? "",
    intendedRiskPct: inference?.intendedRiskPct?.toString() ?? "",
    timeframe: inference?.timeframe ?? "",
    origins: [],
    sources: (inference?.evidence ?? []).map((item, index) => ({
      key: `inferred-${index}`,
      sourceType: item.sourceType,
      label: item.label,
      url: item.url ?? "",
      note: item.quote,
      fromText: true,
    })),
  };
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : NaN;
}

/** Builds the exact confirmed-snapshot contract. Empty optional fields are omitted, never defaulted. */
function buildSnapshot(form: FormState, attested: boolean): { snapshot?: Snapshot; errors: Errors } {
  const errors: Errors = {};
  const symbol = form.assetSymbol.trim();
  if (!symbol) errors.assetSymbol = "Enter the asset symbol, for example BTC or rNVDA.";
  else if (!SYMBOL.test(symbol)) errors.assetSymbol = "Use letters, numbers, dots or dashes, starting with a letter (up to 15 characters).";
  if (!form.assetClass) errors.assetClass = "Choose the asset class.";
  if (!form.side) errors.side = "Choose the direction.";
  if (form.origins.length === 0) errors.origins = "Choose at least one origin that describes where this decision came from.";

  const confidence = toNumber(form.confidence);
  if (confidence !== undefined && (Number.isNaN(confidence) || confidence < 0 || confidence > 100)) errors.confidence = "Use a number from 0 to 100.";
  const entry = toNumber(form.intendedEntry);
  if (entry !== undefined && (Number.isNaN(entry) || entry <= 0)) errors.intendedEntry = "Use a price above zero, or leave it empty.";
  const risk = toNumber(form.intendedRiskPct);
  if (risk !== undefined && (Number.isNaN(risk) || risk < 0 || risk > 100)) errors.intendedRiskPct = "Use a percentage from 0 to 100.";

  const cap = form.intendedTakeProfitMarketCap.trim().replace(/,/g, "");
  const currency = form.marketCapCurrency.trim().toUpperCase();
  if (cap && (!DECIMAL.test(cap) || Number(cap) <= 0)) errors.intendedTakeProfitMarketCap = "Use a plain number above zero, for example 2000000.";
  if (cap && !currency) errors.marketCapCurrency = "Say which currency the market-cap target is in, for example USD.";
  if (currency && !CURRENCY.test(currency)) errors.marketCapCurrency = "Use a currency code such as USD or USDT.";
  if (currency && !cap) errors.intendedTakeProfitMarketCap = "Add the market-cap target this currency belongs to, or clear the currency.";

  form.sources.forEach((source) => {
    if (!source.label.trim()) errors[`source-${source.key}`] = "Give this source a short name, or remove it.";
    else if (source.url.trim() && !validUrl(source.url.trim())) errors[`source-${source.key}`] = "Use a full link starting with http:// or https://.";
  });
  if (!attested) errors.attest = "Confirm that this reflects what you believed at the time.";

  if (Object.keys(errors).length > 0) return { errors };

  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  const snapshot: Snapshot = {
    assetSymbol: symbol,
    assetClass: form.assetClass as AssetClass,
    side: form.side as Side,
    origins: form.origins,
    sources: form.sources.map((source): SnapshotSource => {
      const row: SnapshotSource = { sourceType: source.sourceType, label: source.label.trim() };
      if (source.url.trim()) row.url = source.url.trim();
      if (source.note.trim()) row.note = source.note.trim();
      return row;
    }),
  };
  const optional: Partial<Snapshot> = {
    thesis: text(form.thesis),
    catalyst: text(form.catalyst),
    confidence: confidence === undefined ? undefined : confidence / 100,
    intendedEntry: entry,
    intendedTakeProfitMarketCap: cap || undefined,
    marketCapCurrency: currency || undefined,
    knowledgeBasis: form.knowledgeBasis || undefined,
    invalidation: text(form.invalidation),
    intendedRiskPct: risk,
    timeframe: text(form.timeframe),
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) Object.assign(snapshot, { [key]: value });
  return { snapshot, errors };
}

const inputClass =
  "w-full rounded-[12px] border border-hairline bg-white px-4 text-[16px] text-ink outline-none placeholder:text-[rgba(36,27,21,.45)] focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] focus-visible:outline-none aria-[invalid=true]:border-loss";

function FieldShell({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-[14px] leading-5 font-medium text-ink">
        {label}
        {optional ? <span className="text-[13px] font-normal text-muted">Optional</span> : <span className="text-[13px] font-normal text-muted">Required</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] leading-5">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[13px] leading-5 text-loss">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function DecisionEditor({ record, onConfirmed }: { record: DecisionRecord; onConfirmed: () => void }) {
  const [form, setForm] = useState<FormState>(() => initialState(record));
  const [attested, setAttested] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const suggested = new Set(record.origins.filter((origin) => origin.basis === "inference").map((origin) => origin.label));
  const parsed = isInference(record.decision.structuredView);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setSource = (key: string, patch: Partial<SourceRow>) =>
    set(
      "sources",
      form.sources.map((source) => (source.key === key ? { ...source, ...patch } : source)),
    );

  const text = (id: keyof FormState, label: string, opts: { hint?: string; optional?: boolean; multiline?: boolean; inputMode?: "decimal"; placeholder?: string } = {}) => {
    const error = errors[id];
    const common = {
      id,
      value: form[id] as string,
      onChange: (event: { target: { value: string } }) => set(id, event.target.value as never),
      "aria-invalid": Boolean(error),
      "aria-describedby": describedBy(id, opts.hint, error),
      placeholder: opts.placeholder,
    };
    return (
      <FieldShell id={id} label={label} hint={opts.hint} error={error} optional={opts.optional ?? true}>
        {opts.multiline ? (
          <textarea {...common} rows={3} className={`${inputClass} min-h-[96px] resize-y py-3 leading-6`} />
        ) : (
          <input {...common} inputMode={opts.inputMode} className={`${inputClass} h-12`} />
        )}
      </FieldShell>
    );
  };

  const select = <T extends string>(id: keyof FormState, label: string, options: Record<T, string>, optional = false, hint?: string) => {
    const error = errors[id];
    return (
      <FieldShell id={id} label={label} error={error} optional={optional} hint={hint}>
        <select
          id={id}
          value={form[id] as string}
          onChange={(event) => set(id, event.target.value as never)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(id, hint, error)}
          className={`${inputClass} h-12 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none'%3E%3Cpath stroke='%23241B15' stroke-width='1.5' d='m1 1.5 5 5 5-5'/%3E%3C/svg%3E")] bg-[position:right_16px_center] bg-no-repeat pr-10`}
        >
          <option value="">{optional ? "Not recorded" : "Choose…"}</option>
          {(Object.entries(options) as [T, string][]).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const { snapshot, errors: found } = buildSnapshot(form, attested);
    setErrors(found);
    setSubmitError(null);
    if (!snapshot) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await api(`/api/decisions/${record.decision.id}/confirm`, { method: "POST", body: JSON.stringify(snapshot) });
      onConfirmed();
    } catch (thrown) {
      setSubmitError(apiErrorMessage(thrown, "confirm"));
      inFlight.current = false;
      setPending(false);
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-busy={pending}>
      {!parsed && (
        <FormNotice tone="error">
          Reflex couldn&rsquo;t read this one automatically, so every field below starts empty. Fill in what you knew when you decided. Leave the rest blank.
        </FormNotice>
      )}

      {errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-[12px] border border-loss/30 bg-loss/5 p-4 text-[14px] leading-[22px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink">
          <p className="font-medium">
            {errorCount === 1 ? "One thing needs attention" : `${errorCount} things need attention`} before you can confirm.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <a href={`#${key}`} className="underline underline-offset-4">
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="basics-title" className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
        <h2 id="basics-title" className="text-[20px] leading-7 font-medium text-ink">
          The decision
        </h2>
        <p className="mt-1 text-[14px] leading-[22px]">Fields Reflex could read from your text are filled in. Check each one. Unknown stays empty.</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {text("assetSymbol", "Asset symbol", { optional: false, placeholder: "BTC" })}
          {select("assetClass", "Asset class", ASSET_CLASSES)}
          {select("side", "Direction", SIDES)}
        </div>
        <div className="mt-5 grid gap-5">
          {text("thesis", "Thesis", { multiline: true, hint: "What you expected to happen and why." })}
          {text("catalyst", "Catalyst", { hint: "The event or trigger you were waiting for, if any." })}
        </div>
      </section>

      <section aria-labelledby="plan-title" className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
        <h2 id="plan-title" className="text-[20px] leading-7 font-medium text-ink">
          The plan
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {text("intendedEntry", "Intended entry price", {
            inputMode: "decimal",
            hint: "Price per token or share. Not the amount invested, and not a market cap.",
          })}
          {text("intendedRiskPct", "Risk (% of account)", { inputMode: "decimal", hint: "Only if you planned a percentage. An amount invested isn't a risk %." })}
          {text("intendedTakeProfitMarketCap", "Take-profit market cap", { inputMode: "decimal", hint: "For targets like “sell at a 2M market cap”. A valuation, not a price." })}
          {text("marketCapCurrency", "Market-cap currency", { placeholder: "USD", hint: "Required when you set a market-cap target." })}
          {text("invalidation", "Invalidation", { hint: "What would have told you that you were wrong." })}
          {text("timeframe", "Timeframe", { placeholder: "e.g. two weeks" })}
          {text("confidence", "Your conviction (0–100)", { inputMode: "decimal", hint: "How sure you felt. Reflex never fills this in for you." })}
          {select("knowledgeBasis", "When was this written?", KNOWLEDGE_BASIS, true, "Recollections written later are kept separate from records made at the time.")}
        </div>
      </section>

      <fieldset id="origins" aria-describedby={errors.origins ? "origins-error" : "origins-hint"} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
        <legend className="sr-only">Decision origin</legend>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[20px] leading-7 font-medium text-ink" aria-hidden>
            Where did this decision come from?
          </h2>
          <span className="text-[13px] text-muted">Required, choose one or more</span>
        </div>
        <p id="origins-hint" className="mt-1 text-[14px] leading-[22px]">
          Reflex&rsquo;s suggestions are marked. They only count once you tick them.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(Object.keys(ORIGINS) as OriginLabel[]).map((label) => {
            const checked = form.origins.includes(label);
            return (
              <label
                key={label}
                className={`flex cursor-pointer gap-3 rounded-[12px] border p-4 transition-colors ${checked ? "border-ink bg-cream" : "border-hairline hover:bg-cream/60"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => set("origins", checked ? form.origins.filter((value) => value !== label) : [...form.origins, label])}
                  className="mt-1 size-4 shrink-0 accent-ink"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-ink">{ORIGINS[label].name}</span>
                    {suggested.has(label) && <Tag tone="inferred">Reflex suggested</Tag>}
                  </span>
                  <span className="mt-1 block text-[14px] leading-[22px]">{ORIGINS[label].meaning}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.origins && (
          <p id="origins-error" className="mt-3 text-[13px] text-loss">
            {errors.origins}
          </p>
        )}
      </fieldset>

      <section aria-labelledby="sources-title" className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sources-title" className="text-[20px] leading-7 font-medium text-ink">
            Sources and evidence
          </h2>
          <button
            type="button"
            onClick={() => set("sources", [...form.sources, { key: `added-${Date.now()}`, sourceType: "other", label: "", url: "", note: "", fromText: false }])}
            className={buttonClass("quiet", "sm")}
          >
            <Plus size={16} aria-hidden /> Add a source
          </button>
        </div>
        {form.sources.length === 0 ? (
          <p className="mt-3 text-[14px] leading-[22px]">No sources recorded. Add one if a person, post or article shaped this decision.</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {form.sources.map((source, index) => {
              const error = errors[`source-${source.key}`];
              return (
                <li key={source.key} id={`source-${source.key}`} className="rounded-[12px] border border-hairline p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      Source {index + 1} {source.fromText && <Tag>Quoted from your text</Tag>}
                    </span>
                    <button
                      type="button"
                      onClick={() => set("sources", form.sources.filter((row) => row.key !== source.key))}
                      aria-label={`Remove source ${index + 1}`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-paper"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
                    <label className="flex flex-col gap-2 text-[14px] font-medium text-ink">
                      Type
                      <select value={source.sourceType} onChange={(event) => setSource(source.key, { sourceType: event.target.value as SourceType })} className={`${inputClass} h-12`}>
                        {(Object.entries(SOURCE_TYPES) as [SourceType, string][]).map(([value, name]) => (
                          <option key={value} value={value}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 text-[14px] font-medium text-ink">
                      Name
                      <input value={source.label} onChange={(event) => setSource(source.key, { label: event.target.value })} aria-invalid={Boolean(error)} className={`${inputClass} h-12`} />
                    </label>
                    <label className="flex flex-col gap-2 text-[14px] font-medium text-ink sm:col-span-2">
                      Link <span className="-mt-2 text-[13px] font-normal text-muted">Optional</span>
                      <input value={source.url} onChange={(event) => setSource(source.key, { url: event.target.value })} inputMode="url" placeholder="https://" className={`${inputClass} h-12`} />
                    </label>
                    {source.note && (
                      <p className="text-[14px] leading-[22px] sm:col-span-2">
                        <span className="t-eyebrow mr-2">Note</span>
                        {source.note}
                      </p>
                    )}
                  </div>
                  {error && <p className="mt-2 text-[13px] text-loss">{error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="confirm-title" className="rounded-[12px] border border-ink/20 bg-cream p-5 sm:p-6">
        <h2 id="confirm-title" className="text-[20px] leading-7 font-medium text-ink">
          Confirm your original belief
        </h2>
        <p className="mt-1 max-w-[62ch] text-[14px] leading-[22px]">
          Confirming saves this as the record later reviews are measured against. Your written text stays exactly as you wrote it. Later corrections are added as new
          versions, never overwrites. This doesn&rsquo;t place a trade.
        </p>
        <label id="attest" className="mt-4 flex cursor-pointer gap-3 text-[15px] leading-6 text-ink">
          <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" aria-invalid={Boolean(errors.attest)} />
          This reflects what I believed when I made the decision, not what I know now.
        </label>
        {errors.attest && <p className="mt-2 text-[13px] text-loss">{errors.attest}</p>}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {pending ? "Saving your decision" : "Confirm original belief"}
          </button>
        </div>
        {submitError && (
          <div className="mt-4">
            <FormNotice tone="error">{submitError}</FormNotice>
          </div>
        )}
      </section>
    </form>
  );
}
