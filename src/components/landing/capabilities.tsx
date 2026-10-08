import { BookCheck, Dna, FileSpreadsheet, GitCompareArrows, History, ScanSearch, type LucideIcon } from "lucide-react";
import { Container, SECTION_Y, SectionHeader } from "./primitives";

const CAPABILITIES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ScanSearch,
    title: "Decision Autopsy",
    body: "Scores research, market context, risk, execution and behaviour on their own terms. Each finding quotes the record it came from, and missing evidence stays unassessed instead of guessed.",
  },
  {
    icon: GitCompareArrows,
    title: "Plan Drift",
    body: "Compares the plan you confirmed with what you did later. A target raised after entry or an exit that ignored the plan is shown in the order it happened.",
  },
  {
    icon: Dna,
    title: "Decision DNA",
    body: "Groups your reviewed decisions to find what repeats. One example stays an observation. A pattern is only called established after several comparable, well-evidenced decisions.",
  },
  {
    icon: History,
    title: "Pre-Trade Recall",
    body: "Describe the trade you're considering. Reflex retrieves similar past decisions, your recorded patterns and accepted rules, then asks the questions your history raises.",
  },
  {
    icon: BookCheck,
    title: "Self-Evolving Playbook",
    body: "Turns repeated evidence into proposed rules. Nothing becomes active until you accept it, and every rule keeps links to the decisions behind it.",
  },
  {
    icon: FileSpreadsheet,
    title: "Historical CSV import",
    body: "Bring in Bitget spot order history. You label each order's purpose, so a payment conversion is never mistaken for a trading decision.",
  },
];

function Crosshair({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`absolute size-3 text-crosshair ${className}`} aria-hidden="true" focusable="false">
      <path d="M6 0V12M0 6H12" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" aria-labelledby="capabilities-title" className={`bg-paper ${SECTION_Y} pt-0 sm:pt-0 lg:pt-0`}>
      <Container>
        <SectionHeader
          id="capabilities-title"
          eyebrow="Capabilities"
          title="Instruments for the decision, not the ticker."
          lead="Each one works from the same owned record: what you wrote, what you confirmed, what you executed. When evidence is missing, Reflex shows the gap rather than filling it."
        />
        <ul className="grid grid-cols-1 border-t border-l border-hairline sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="relative min-h-[260px] border-r border-b border-hairline bg-[radial-gradient(ellipse_60%_55%_at_20%_0%,#E5DFD1,transparent_70%)] p-8"
            >
              <Crosshair className="-top-1.5 -left-1.5" />
              <Crosshair className="-right-1.5 -bottom-1.5" />
              <span className="inline-flex size-12 items-center justify-center rounded-[4px] border border-[#E2DDD2] bg-[#F7F4EC]">
                <Icon size={24} strokeWidth={1.5} className="text-ink" aria-hidden />
              </span>
              <h3 className="mt-6 text-[20px] leading-7 font-medium text-ink">{title}</h3>
              <p className="mt-2 max-w-[42ch]">{body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
