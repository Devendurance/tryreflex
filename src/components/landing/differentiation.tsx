import { Container, ReflexMark, SECTION_Y, SectionHeader } from "./primitives";

const COLUMNS = ["Trade journal", "Signal bot", "Reflex"] as const;

const ROWS: { aspect: string; values: [string, string, string] }[] = [
  {
    aspect: "Learns from",
    values: ["The notes you remember to write", "Price feeds and its own model", "Your recorded decision, its evidence and its outcome, kept apart"],
  },
  {
    aspect: "Grades a trade by",
    values: ["Profit and loss", "Whether the call hit", "Research, context, risk, execution and behaviour"],
  },
  {
    aspect: "Who decides",
    values: ["You, without feedback", "The bot, or whoever sells the signal", "You, with your own history in view"],
  },
  {
    aspect: "How it changes",
    values: ["Only if you reread it", "Updates you can't inspect", "Rules you approve, linked to the decisions behind them"],
  },
  {
    aspect: "When it helps",
    values: ["Long after the trade", "At the click", "After every review and before the next decision"],
  },
];

export function Differentiation() {
  return (
    <section id="why-reflex" aria-labelledby="why-title" className={`bg-white ${SECTION_Y}`}>
      <Container>
        <SectionHeader
          id="why-title"
          eyebrow="Why Reflex"
          title="More than a journal. Never a signal."
          lead="A journal stores what happened. A signal bot tells you what to do. Reflex helps you understand how you decide, and leaves the deciding to you."
        />

        <div className="mx-auto hidden max-w-[1080px] md:block">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">How Reflex compares with a trade journal and a signal bot</caption>
            <colgroup>
              <col className="w-[19%]" />
              <col />
              <col />
              <col className="w-[31%]" />
            </colgroup>
            <thead>
              <tr>
                <td />
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={`px-5 pb-4 align-bottom text-[16px] leading-6 font-bold text-ink ${column === "Reflex" ? "rounded-t-[12px] bg-cream pt-5" : ""}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {column === "Reflex" && <ReflexMark className="h-3 w-auto" />}
                      {column}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, rowIndex) => (
                <tr key={row.aspect} className="border-t border-hairline">
                  <th scope="row" className="t-eyebrow py-5 pr-5 align-top">
                    {row.aspect}
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={value}
                      className={`px-5 py-5 align-top text-[15px] leading-6 ${
                        i === 2 ? `bg-cream font-medium text-ink ${rowIndex === ROWS.length - 1 ? "rounded-b-[12px]" : ""}` : ""
                      }`}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-5 md:hidden">
          {ROWS.map((row) => (
            <li key={row.aspect} className="border-t border-hairline pt-5">
              <h3 className="t-eyebrow">{row.aspect}</h3>
              <dl className="mt-3 flex flex-col gap-3">
                {row.values.map((value, i) => (
                  <div key={value} className={i === 2 ? "rounded-[12px] bg-cream p-4" : "px-4"}>
                    <dt className="text-[13px] leading-5 font-bold text-ink">{COLUMNS[i]}</dt>
                    <dd className={`text-[15px] leading-6 ${i === 2 ? "font-medium text-ink" : ""}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <div className="mx-auto mt-16 grid max-w-[1080px] gap-8 border-t border-hairline pt-10 md:grid-cols-2 md:gap-10">
          <p className="text-[18px] leading-[30px] text-ink">Reflex can interpret, compare and remind. You remain the final decision-maker.</p>
          <p className="text-[18px] leading-[30px] text-ink">Reflex doesn&rsquo;t promise better outcomes. It helps you build better feedback.</p>
        </div>
      </Container>
    </section>
  );
}
