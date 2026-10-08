import { EngineFigure } from "./engine-figure";
import { ACCESS_HREF, ButtonLink } from "./primitives";

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative -mt-14 overflow-hidden bg-[linear-gradient(180deg,#F6EADC_0%,#FBF5EC_55%,#FFFFFF_100%)] pt-14"
    >
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-y-10 px-5 pt-12 pb-10 sm:px-8 sm:pt-16 lg:min-h-[min(calc(100svh-56px),820px)] lg:grid-cols-12 lg:gap-x-5 lg:py-16">
        <div className="relative z-10 lg:col-span-5">
          <h1 id="hero-title" className="t-display max-w-[12ch] lg:max-w-none">
            Don&rsquo;t let a green trade teach you the wrong lesson.
          </h1>
          <p className="t-lead mt-6 max-w-[40ch]">
            Your P&amp;L tells you what happened. Reflex shows you what the trade actually taught you: what you believed, what influenced you, what the
            evidence supported, and what to remember next time.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            <ButtonLink href={ACCESS_HREF}>Review a trade</ButtonLink>
            <ButtonLink href="/#how-it-works" variant="quiet">
              See how Reflex works
            </ButtonLink>
          </div>
          <p className="t-caption mt-6">No signals. No automatic execution. You stay the decision-maker.</p>
        </div>

        <div className="-mr-5 sm:-mr-8 lg:col-span-7 lg:mr-[calc(-1*max(32px,(100vw-1280px)/2+32px))]">
          <EngineFigure />
        </div>
      </div>
    </section>
  );
}
