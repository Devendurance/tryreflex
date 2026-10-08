import type { ReactNode } from "react";
import { ORIGINS, isInference, type DecisionRecord } from "./decision-api";

export function StatusBadge({ status }: { status: "draft" | "confirmed" | "closed" }) {
  const styles = {
    draft: "border-hairline bg-paper text-muted",
    confirmed: "border-ink bg-ink text-cream",
    closed: "border-hairline bg-stone text-ink",
  } as const;
  const labels = { draft: "Draft", confirmed: "Confirmed", closed: "Closed" } as const;
  return (
    <span className={`t-data inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "inferred" | "confirmed" }) {
  const styles = {
    neutral: "border-hairline text-muted",
    inferred: "border-blue/40 bg-blue-tint text-ink",
    confirmed: "border-gain/40 bg-gain/10 text-ink",
  } as const;
  return (
    <span className={`t-data inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function Panel({ title, id, children, aside }: { title: string; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-[20px] leading-7 font-medium text-ink">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RawInput({ text }: { text: string }) {
  return (
    <Panel id="raw-title" title="What you wrote" aside={<Tag>Kept exactly as written</Tag>}>
      <blockquote className="border-l-2 border-ink/70 pl-4 text-[16px] leading-[27px] whitespace-pre-wrap text-ink break-words">{text}</blockquote>
    </Panel>
  );
}

function Quote({ children }: { children: string }) {
  return <q className="text-ink before:content-['“'] after:content-['”']">{children}</q>;
}

/** Shows only what the parser stored: inferred origins with exact quotes, and quoted evidence. */
export function InferencePanel({ record }: { record: DecisionRecord }) {
  const inferred = record.origins.filter((origin) => origin.basis === "inference");
  const storedInference = isInference(record.decision.structuredView) ? record.decision.structuredView : null;
  const quotesFor = (label: string) => storedInference?.origins.find((origin) => origin.label === label)?.observedInputFacts ?? [];
  const evidence = storedInference?.evidence ?? [];

  return (
    <Panel id="inference-title" title="What Reflex read" aside={<Tag tone="inferred">Inference</Tag>}>
      {inferred.length === 0 && evidence.length === 0 ? (
        <p className="text-[15px]">
          Reflex didn&rsquo;t find a decision origin or source it could quote from your text. That&rsquo;s fine. Nothing was guessed.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {inferred.length > 0 && (
            <div>
              <h3 className="t-eyebrow">Possible origins</h3>
              <ul className="mt-3 flex flex-col gap-4">
                {inferred.map((origin) => (
                  <li key={origin.id} className="border-l-2 border-blue/40 pl-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[15px] font-medium text-ink">{ORIGINS[origin.label].name}</span>
                      {origin.confidence !== null && (
                        <span className="t-caption">
                          Reading confidence <span className="t-data text-ink">{Math.round(origin.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[14px] leading-[22px]">{origin.explanation}</p>
                    {quotesFor(origin.label).length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-[14px] leading-[22px]">
                        {quotesFor(origin.label).map((quote) => (
                          <li key={quote}>
                            <Quote>{quote}</Quote>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <h3 className="t-eyebrow">Sources you mentioned</h3>
              <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-[22px]">
                {evidence.map((item) => (
                  <li key={`${item.label}-${item.quote}`}>
                    <span className="font-medium text-ink">{item.label}</span>: <Quote>{item.quote}</Quote>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="t-caption">
            Reading confidence describes how clearly your text supports the reading. It says nothing about whether the trade will work.
          </p>
        </div>
      )}
    </Panel>
  );
}
