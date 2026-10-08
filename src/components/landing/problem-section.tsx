import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { EngineGhost } from "./reflex-engine";
import { Container, SECTION_Y, SectionHeader } from "./primitives";

type Case = {
  outcome: "Profit" | "Loss";
  process: "Weak" | "Sound";
  title: string;
  body: string;
  edge: "orange" | "blue";
  tilt: string;
};

const CASES: Case[] = [
  {
    outcome: "Profit",
    process: "Weak",
    title: "The lucky win",
    body: "Bought on a stranger's post with no exit plan. It ran anyway, and the P&L says do it again.",
    edge: "orange",
    tilt: "lg:-rotate-[5deg] md:-rotate-2",
  },
  {
    outcome: "Loss",
    process: "Sound",
    title: "The good loss",
    body: "Written thesis, small size, exit at the planned stop. The outcome hurt. The process held.",
    edge: "blue",
    tilt: "lg:rotate-[4deg] md:rotate-2 lg:translate-y-10",
  },
  {
    outcome: "Profit",
    process: "Sound",
    title: "The earned win",
    body: "Research, plan and risk lined up, and the market agreed. Worth repeating on purpose.",
    edge: "blue",
    tilt: "lg:-rotate-[3deg] md:-rotate-2",
  },
  {
    outcome: "Loss",
    process: "Weak",
    title: "The expensive lesson",
    body: "Chased a late move and doubled down. The loss is real, but the lesson lives in the decision.",
    edge: "orange",
    tilt: "lg:rotate-[5deg] md:rotate-2 lg:-translate-y-[30px]",
  },
];

function CaseCard({ outcome, process, title, body, edge, tilt }: Case) {
  const Icon = outcome === "Profit" ? ArrowUpRight : ArrowDownRight;
  return (
    <li
      className={`w-full rounded-[12px] border-l-[3px] bg-white p-6 shadow-[0_12px_32px_rgba(36,27,21,.10),0_2px_6px_rgba(36,27,21,.06)] lg:w-[320px] ${
        edge === "orange" ? "border-orange" : "border-blue"
      } ${tilt}`}
    >
      <div className="flex items-center justify-between gap-4">
        <span className={`inline-flex size-8 items-center justify-center rounded-[4px] ${edge === "orange" ? "bg-orange-tint" : "bg-blue-tint"}`}>
          <Icon size={18} strokeWidth={1.75} className={outcome === "Profit" ? "text-gain" : "text-loss"} aria-hidden />
        </span>
        <dl className="t-data flex gap-3 text-[12px] leading-4 font-semibold tracking-[0.08em] uppercase">
          <div className="flex gap-1">
            <dt className="sr-only">Outcome</dt>
            <dd className={outcome === "Profit" ? "text-gain" : "text-loss"}>{outcome}</dd>
          </div>
          <span aria-hidden className="text-hairline">
            /
          </span>
          <div className="flex gap-1">
            <dt className="text-muted">Process</dt>
            <dd className="text-ink">{process}</dd>
          </div>
        </dl>
      </div>
      <h3 className="mt-6 text-[20px] leading-7 font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[14px] leading-[22px]">{body}</p>
    </li>
  );
}

export function ProblemSection() {
  return (
    <section aria-labelledby="problem-title" className={`bg-white ${SECTION_Y}`}>
      <Container>
        <SectionHeader
          id="problem-title"
          eyebrow="The problem"
          title="P&L is a bad teacher."
          lead="A profitable trade can be a bad decision. A losing trade can be a good one. Judge only by the result and you'll repeat lucky mistakes and abandon sound process."
        />
        <div className="relative mx-auto max-w-[1000px]">
          <EngineGhost className="pointer-events-none absolute top-1/2 left-1/2 hidden w-[360px] -translate-x-1/2 -translate-y-1/2 lg:block" />
          <ul className="relative grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-8 md:gap-y-10 lg:grid-cols-[320px_320px] lg:justify-between lg:gap-y-32">
            {CASES.map((item) => (
              <CaseCard key={item.title} {...item} />
            ))}
          </ul>
        </div>
        <p className="t-caption mt-12 text-center lg:mt-20">Illustrative examples, not user data. Reflex reviews the process and the outcome separately.</p>
      </Container>
    </section>
  );
}
