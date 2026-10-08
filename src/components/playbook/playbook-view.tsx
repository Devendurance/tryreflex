"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FormNotice } from "@/components/auth/form-parts";
import { ApiError, api, formatDate } from "@/components/decisions/decision-api";
import { Panel, Tag } from "@/components/decisions/decision-parts";
import { buttonClass } from "@/components/landing/primitives";

type Provenance = {
  templateId: "target_revision" | "research_check";
  maturity: "experimental" | "pattern_backed";
  sourceStatus: "observation" | "emerging" | "established";
  supportingDecisionCount: number;
  supportingReviewIds: string[];
  observedBehavior: string;
  supportingFacts: { decisionId: string; reviewId: string; observedFacts: { quote: string }[] }[];
  scope: string;
  effectiveness: "unproven";
  financialBenefit: "unknown";
};

type Rule = {
  id: string;
  version: number;
  status: "proposed" | "active" | "rejected" | "deferred";
  title: string;
  trigger: string;
  ruleText: string;
  rationale: string;
  decidedAt: string | null;
  createdAt: string | null;
  evidenceRefs: string[];
  provenance: Provenance | null;
};

type Playbook = { currentRules: Rule[]; pendingProposals: Rule[]; rejectedProposals: Rule[]; history: Rule[] };
type Action = "accept" | "reject" | "defer";
type Notice = { tone: "error" | "success"; text: ReactNode } | null;

const MATURITY = {
  experimental: { name: "Experimental", meaning: "Based on one or a few reviewed decisions. Whether it helps is unproven." },
  pattern_backed: { name: "Pattern-backed", meaning: "Based on an established pattern that passed Reflex's evidence-quality gate. Still unproven as a rule." },
};
const STATUS: Record<Rule["status"], string> = { proposed: "Waiting for you", active: "Active", rejected: "Rejected", deferred: "Deferred" };
const ACTION_DONE: Record<Action, string> = { accept: "accepted. It's now part of your active Playbook", reject: "rejected. It won't be proposed again from the same evidence", defer: "deferred. It stays out of your active rules until you decide" };

function message(error: unknown, action: "load" | "propose" | Action): string {
  const { status } = error instanceof ApiError ? error : new ApiError(0, "NETWORK");
  if (status === 0) return "Couldn't reach Reflex. Check your connection and try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 404) return "This rule doesn't exist, or it belongs to another account.";
  if (status === 409) return "This rule changed since you opened it. The latest version is now shown.";
  if (status === 429) return "Reflex is busy right now. Wait a moment, then try again.";
  if (status === 503) return action === "accept" ? "Reflex couldn't save the rule to memory right now. It wasn't accepted. Try again." : "Reflex storage or sign-in is unavailable right now. Nothing was changed.";
  if (status === 400) return action === "propose" ? "Your saved patterns couldn't be validated, so no proposals were made." : "Reflex couldn't accept that request.";
  return "Something went wrong. Nothing was changed. Try again.";
}

function RuleCard({ rule, onDecided }: { rule: Rule; onDecided?: (action: Action, result: { ok: true; rule: Rule } | { ok: false; error: unknown }) => Promise<void> }) {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const inFlight = useRef(false);
  const p = rule.provenance;
  const actionable = onDecided && (rule.status === "proposed" || rule.status === "deferred");
  const quotes = p?.supportingFacts.flatMap((fact) => fact.observedFacts.map((observed) => observed.quote)) ?? [];

  const run = async (action: Action) => {
    if (inFlight.current || !onDecided) return;
    inFlight.current = true;
    setPending(action);
    try {
      const result = await api<Rule>(`/api/playbook/${rule.id}/decision`, { method: "POST", body: JSON.stringify({ action }) });
      await onDecided(action, { ok: true, rule: result });
    } catch (error) {
      await onDecided(action, { ok: false, error });
    } finally {
      inFlight.current = false;
      setPending(null);
      setConfirming(null);
    }
  };

  return (
    <li className="rounded-[12px] border border-hairline bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={rule.status === "active" ? "confirmed" : "neutral"}>{STATUS[rule.status]}</Tag>
        {p && <Tag tone={p.maturity === "pattern_backed" ? "confirmed" : "inferred"}>{MATURITY[p.maturity].name}</Tag>}
        <span className="t-caption">
          Version <span className="t-data">{rule.version}</span>
          {rule.decidedAt ? ` · decided ${formatDate(rule.decidedAt)}` : rule.createdAt ? ` · proposed ${formatDate(rule.createdAt)}` : ""}
        </span>
      </div>
      <h3 className="mt-3 text-[19px] leading-7 font-medium text-ink">{rule.title}</h3>
      <dl className="mt-3 flex flex-col gap-3 text-[15px] leading-[24px]">
        <div>
          <dt className="t-eyebrow text-[11px]">When</dt>
          <dd className="mt-0.5 text-ink">{rule.trigger}</dd>
        </div>
        <div>
          <dt className="t-eyebrow text-[11px]">Do this</dt>
          <dd className="mt-0.5 text-ink">{rule.ruleText}</dd>
        </div>
        <div>
          <dt className="t-eyebrow text-[11px]">Why it was proposed</dt>
          <dd className="mt-0.5">{rule.rationale}</dd>
        </div>
      </dl>
      {p ? (
        <div className="mt-4 border-t border-hairline pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
            <div>
              <dt className="t-eyebrow text-[11px]">Reviewed decisions</dt>
              <dd className="t-data mt-1 text-ink">{p.supportingDecisionCount}</dd>
            </div>
            <div>
              <dt className="t-eyebrow text-[11px]">Evidence scope</dt>
              <dd className="mt-1 text-ink">{p.scope}</dd>
            </div>
            <div>
              <dt className="t-eyebrow text-[11px]">Does it help?</dt>
              <dd className="mt-1 text-ink">Unproven</dd>
            </div>
            <div>
              <dt className="t-eyebrow text-[11px]">Financial benefit</dt>
              <dd className="mt-1 text-ink">Unknown</dd>
            </div>
          </dl>
          <p className="t-caption mt-3">{MATURITY[p.maturity].meaning}</p>
          {quotes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {quotes.slice(0, 3).map((quote, index) => (
                <li key={index} className="border-l-2 border-ink/70 pl-3 text-[14px] leading-[22px] text-ink break-words">
                  &ldquo;{quote}&rdquo;
                </li>
              ))}
            </ul>
          )}
          {p.supportingReviewIds.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px]">
              Evidence from:
              {p.supportingReviewIds.map((reviewId, index) => (
                <Link key={reviewId} href={`/app/autopsies/${reviewId}`} className="underline underline-offset-4">
                  Autopsy {index + 1}
                </Link>
              ))}
            </p>
          )}
        </div>
      ) : (
        <p className="t-caption mt-4 border-t border-hairline pt-4">This rule has no evidence record in the current format, so its provenance can&rsquo;t be shown.</p>
      )}
      {actionable && (
        <div className="mt-5 border-t border-hairline pt-4" aria-busy={pending !== null}>
          {confirming ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-ink">
                {confirming === "accept"
                  ? "Accept this rule? It becomes part of your active Playbook and Pre-Trade Recall can bring it back. It never places or blocks a trade."
                  : "Reject this rule? Rejection is final for this version and stays in your history."}
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void run(confirming)} disabled={pending !== null} className={buttonClass(confirming === "accept" ? "primary" : "secondary", "sm")}>
                  {pending && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                  {pending ? "Saving" : confirming === "accept" ? "Yes, accept" : "Yes, reject"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} disabled={pending !== null} className={buttonClass("quiet", "sm")}>
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setConfirming("accept")} disabled={pending !== null} className={buttonClass("primary", "sm")}>
                Accept
              </button>
              {rule.status === "proposed" && (
                <button type="button" onClick={() => void run("defer")} disabled={pending !== null} className={buttonClass("quiet", "sm")}>
                  {pending === "defer" && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                  Decide later
                </button>
              )}
              <button type="button" onClick={() => setConfirming("reject")} disabled={pending !== null} className={buttonClass("quiet", "sm")}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ id, title, note, rules, onDecided }: { id: string; title: string; note: string; rules: Rule[]; onDecided?: Parameters<typeof RuleCard>[0]["onDecided"] }) {
  if (rules.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-[20px] leading-7 font-medium text-ink">
        {title} <span className="t-data text-[15px] text-muted">{rules.length}</span>
      </h2>
      <p className="mt-1 text-[14px] leading-[22px]">{note}</p>
      <ul className="mt-4 flex flex-col gap-3">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} onDecided={onDecided} />
        ))}
      </ul>
    </section>
  );
}

export function PlaybookView() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; playbook: Playbook } | { kind: "error"; message: string }>({ kind: "loading" });
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", playbook: await api<Playbook>("/api/playbook") });
    } catch (error) {
      setState({ kind: "error", message: message(error, "load") });
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- owner-scoped playbook read
  useEffect(() => void load(), [load]);

  const propose = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setProposing(true);
    setNotice(null);
    try {
      const result = await api<{ createdCount: number; existingCount: number; unsupportedEvidenceCount: number; recomputationRequired?: boolean }>("/api/playbook/propose", { method: "POST", body: "{}" });
      if (result.recomputationRequired) {
        setNotice({
          tone: "success",
          text: (
            <>
              No proposals yet. Rules come from your current Decision DNA, and there isn&rsquo;t any. Review a decision in{" "}
              <Link href="/app/autopsies" className="underline underline-offset-4">Autopsies</Link>, then update{" "}
              <Link href="/app/dna" className="underline underline-offset-4">Decision DNA</Link>.
            </>
          ),
        });
      } else {
        await load();
        setNotice({
          tone: "success",
          text:
            result.createdCount > 0
              ? `${result.createdCount} new proposal${result.createdCount === 1 ? "" : "s"} from your Decision DNA. Nothing is active until you accept it.`
              : result.existingCount > 0
                ? "No new proposals. Your current DNA findings already have proposals below."
                : "No proposals. None of your current DNA findings match a rule Reflex can propose from evidence.",
        });
      }
    } catch (error) {
      setNotice({ tone: "error", text: message(error, "propose") });
    } finally {
      inFlight.current = false;
      setProposing(false);
    }
  };

  const onDecided = async (action: Action, result: { ok: true; rule: Rule } | { ok: false; error: unknown }) => {
    await load();
    setNotice(result.ok ? { tone: "success", text: `“${result.rule.title}” ${ACTION_DONE[action]}.` } : { tone: "error", text: message(result.error, action) });
  };

  const header = (
    <header>
      <p className="t-eyebrow">Playbook</p>
      <h1 className="t-h2 mt-3">Your rules, earned from your own decisions.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Reflex proposes a rule only when your reviewed decisions support it. Nothing becomes a rule until you accept it, and no rule ever places or blocks a trade.
      </p>
    </header>
  );

  if (state.kind !== "ready")
    return (
      <div className="flex flex-col gap-8">
        {header}
        {state.kind === "loading" ? (
          <p className="inline-flex items-center gap-2 text-[14px]" aria-live="polite">
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading your Playbook
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

  const { playbook } = state;
  const proposed = playbook.pendingProposals.filter((rule) => rule.status === "proposed");
  const deferred = playbook.pendingProposals.filter((rule) => rule.status === "deferred");
  const empty = !playbook.currentRules.length && !playbook.pendingProposals.length && !playbook.rejectedProposals.length && !playbook.history.length;

  return (
    <div className="flex flex-col gap-8">
      {header}
      <Panel
        id="playbook-proposals"
        title={empty ? "Your Playbook is empty, as it should be at the start." : "Proposals"}
        aside={
          <button type="button" onClick={() => void propose()} disabled={proposing} className={buttonClass("quiet", "sm")}>
            {proposing && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {proposing ? "Checking" : "Check for proposals"}
          </button>
        }
      >
        <p className="max-w-[64ch] text-[15px] leading-[24px]">
          {empty ? (
            <>
              Rules come from genuine reviewed decisions. Record a decision in the{" "}
              <Link href="/app/decisions" className="underline underline-offset-4">Decision Desk</Link>, add its trade evidence, review it in{" "}
              <Link href="/app/autopsies" className="underline underline-offset-4">Autopsies</Link>, and update your{" "}
              <Link href="/app/dna" className="underline underline-offset-4">Decision DNA</Link>. Then check for proposals here.
            </>
          ) : (
            "Checking compares your current Decision DNA with the rules Reflex can propose. It never repeats a proposal for the same evidence."
          )}
        </p>
        {notice && (
          <div className="mt-4" aria-live="polite">
            <FormNotice tone={notice.tone}>{notice.text}</FormNotice>
          </div>
        )}
      </Panel>
      <Section id="pb-active" title="Active rules" note="Rules you accepted. Pre-Trade Recall can bring these back when they may apply." rules={playbook.currentRules} />
      <Section id="pb-proposed" title="Waiting for your decision" note="Proposed from your evidence. Accept, decide later, or reject." rules={proposed} onDecided={onDecided} />
      <Section id="pb-deferred" title="Deferred" note="Set aside for now. Not active." rules={deferred} onDecided={onDecided} />
      <Section id="pb-rejected" title="Rejected" note="Never active. Kept so the record stays complete." rules={playbook.rejectedProposals} />
      <Section id="pb-history" title="Earlier versions" note="Every decision on a rule adds a new version. Earlier versions are never edited." rules={playbook.history} />
    </div>
  );
}
