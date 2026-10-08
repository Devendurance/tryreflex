"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { ReflexEngineArt } from "./reflex-engine";

const INPUTS = ["Social call", "Market context", "Research note", "Conviction", "Decision note"];
const OUTPUTS = ["Decision review", "Process quality", "Decision DNA", "Plan drift", "Playbook rule", "Recall"];

export function EngineFigure() {
  const [paused, setPaused] = useState(false);

  return (
    <figure data-motion={paused ? "paused" : "running"} className="relative">
      <ReflexEngineArt />
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-0 lg:pr-8">
        <span className="t-caption">Illustration of the Reflex loop. Not user data.</span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          className="t-caption -ml-3 inline-flex h-11 items-center sm:ml-0 gap-1.5 rounded-full px-3 text-ink transition-colors hover:bg-quiet motion-reduce:hidden"
        >
          {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          {paused ? "Play motion" : "Pause motion"}
        </button>
      </figcaption>
      <dl className="mt-4 grid grid-cols-2 gap-5 sm:hidden">
        {[
          { term: "Goes in", items: INPUTS },
          { term: "Comes out", items: OUTPUTS },
        ].map(({ term, items }) => (
          <div key={term}>
            <dt className="t-eyebrow">{term}</dt>
            <dd className="mt-2">
              <ul className="t-caption space-y-1 text-ink">
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
