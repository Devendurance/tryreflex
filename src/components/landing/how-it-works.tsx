import { Container, SECTION_Y } from "./primitives";

type Step = {
  step: string;
  label: string;
  body: string;
  tile: string;
  span: string;
  anchor: string;
  tilt: string;
};

const STEPS: Step[] = [
  {
    step: "Step 1 · Decide",
    label: "Capture the thinking",
    body: "Start with a sentence, not a spreadsheet. Reflex turns it into a Decision Snapshot you confirm before the result exists, so your original belief never blends with hindsight.",
    tile: "bg-sage",
    span: "md:col-span-2 lg:col-span-8",
    anchor: "justify-start",
    tilt: "-rotate-3",
  },
  {
    step: "Step 2 · Understand",
    label: "Review the process",
    body: "Decision Autopsy scores research, context, risk, execution and behaviour separately. P&L is shown beside the review, never inside the score.",
    tile: "bg-butter",
    span: "lg:col-span-4",
    anchor: "justify-center",
    tilt: "rotate-2",
  },
  {
    step: "Step 3 · Learn",
    label: "Find the pattern",
    body: "Decision DNA compares your reviewed decisions to show what repeats, from the source of your conviction to the way you exit.",
    tile: "bg-lavender",
    span: "lg:col-span-4",
    anchor: "justify-start",
    tilt: "rotate-[4deg]",
  },
  {
    step: "Step 4 · Evolve",
    label: "Evolve the Playbook",
    body: "Repeated evidence becomes a proposed rule. You accept it, reject it, or wait for more decisions.",
    tile: "bg-blush",
    span: "lg:col-span-4",
    anchor: "justify-center",
    tilt: "-rotate-2",
  },
  {
    step: "Step 5 · Recall",
    label: "Carry the lesson",
    body: "Before a similar trade, Pre-Trade Recall brings back the decisions, patterns and rules that apply.",
    tile: "bg-stone",
    span: "lg:col-span-4",
    anchor: "justify-end",
    tilt: "rotate-3",
  },
];

function SnapshotArt() {
  return (
    <svg viewBox="0 0 360 150" className="h-auto w-full max-w-[420px] shrink-0" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#241B15" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round">
        <rect x={10} y={40} width={120} height={70} rx={8} fill="#EEF3EE" />
        <path d="M30 110 L24 124 L44 110" fill="#EEF3EE" />
        <line x1={26} y1={60} x2={112} y2={60} strokeOpacity={0.6} />
        <line x1={26} y1={74} x2={96} y2={74} strokeOpacity={0.6} />
        <line x1={26} y1={88} x2={104} y2={88} strokeOpacity={0.6} />
        <path d="M146 75 H188 M180 67 L188 75 L180 83" />
        <rect x={204} y={14} width={146} height={122} rx={8} fill="#FFFFFF" />
        <rect x={210} y={20} width={146} height={122} rx={8} strokeOpacity={0.3} strokeDasharray="3 4" />
        {["Belief", "Influence", "Plan", "Risk"].map((field, i) => (
          <g key={field}>
            <text x={218} y={40 + i * 24} fill="#6B625A" stroke="none" fontSize={10} fontWeight={700} letterSpacing="0.12em" style={{ fontFamily: "var(--font-data)" }}>
              {field.toUpperCase()}
            </text>
            <line x1={292} y1={36 + i * 24} x2={336 - (i % 2) * 14} y2={36 + i * 24} strokeOpacity={0.6} />
          </g>
        ))}
        <circle cx={336} cy={122} r={6} fill="#F26B1D" />
        <path d="M333 122 l2.2 2.2 l4 -4.4" stroke="#241B15" strokeWidth={1.5} />
      </g>
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={`bg-paper ${SECTION_Y}`}>
      <Container>
        <div className="mb-12 flex flex-col gap-4 lg:mb-16 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div>
            <p className="t-eyebrow mb-4 inline-block rounded-full border border-hairline bg-[#F8F5EE] px-4 py-1.5">How Reflex works</p>
            <h2 id="how-title" className="t-h2 max-w-[16ch]">
              Every trade trains the next decision.
            </h2>
            <p className="t-data mt-4 text-[15px] leading-5 font-semibold text-ink">
              Decide <span aria-hidden>→</span> Trade <span aria-hidden>→</span> Understand <span aria-hidden>→</span> Learn{" "}
              <span aria-hidden>→</span> Evolve <span aria-hidden>→</span> Recall <span aria-hidden>→</span> Decide better
            </p>
          </div>
          <p className="max-w-[380px] text-[16px] leading-[26px] font-medium">
            Reflex keeps what you believed before the result, reviews how you decided, and brings the lesson back when a similar decision appears.
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-5 rounded-[28px] bg-white p-5 md:grid-cols-2 lg:grid-cols-12">
          {STEPS.map((item, index) => (
            <li
              key={item.label}
              className={`flex min-h-[220px] flex-col justify-between gap-8 rounded-[12px] p-6 lg:h-[360px] lg:p-8 ${item.tile} ${item.span}`}
            >
              <div className={`flex ${item.anchor}`}>
                <div className="flex flex-col items-start">
                  <span className="t-caption ml-[-8px] text-ink/80">{item.step}</span>
                  <h3
                    className={`mt-2 rounded-full bg-ink px-6 py-2.5 font-data text-[18px] leading-[22px] font-bold tracking-[-0.01em] text-cream sm:text-[20px] sm:leading-6 lg:text-[22px] lg:leading-[26px] ${item.tilt}`}
                  >
                    {item.label}
                  </h3>
                </div>
              </div>
              <div className={index === 0 ? "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between" : ""}>
                <p className="max-w-[46ch] text-[15px] leading-6 text-ink/80">{item.body}</p>
                {index === 0 && <SnapshotArt />}
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
