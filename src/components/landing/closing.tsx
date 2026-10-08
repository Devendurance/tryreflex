import { ACCESS_HREF, ButtonLink, Container, NAV_LINKS, ReflexLogo, SECTION_Y } from "./primitives";

export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className={`bg-cream ${SECTION_Y}`}>
      <Container className="flex flex-col items-center text-center">
        <h2 id="closing-title" className="t-h2 max-w-[18ch]">
          Make the next decision more yours.
        </h2>
        <p className="t-lead mt-4 max-w-[52ch]">
          Your trading history already holds lessons. Reflex helps you find them, test them, and carry them into the next decision.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-6">
          <ButtonLink href={ACCESS_HREF}>Review a trade</ButtonLink>
          <ButtonLink href="/#how-it-works" variant="secondary">
            See how Reflex works
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-paper py-12">
      <Container className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[44ch]">
          <ReflexLogo />
          <p className="mt-4 text-[14px] leading-[22px]">
            Decision intelligence for crypto and tokenized US equities. Built for the Bitget AI Base Camp hackathon.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="rounded-sm text-[14px] leading-5 font-medium text-ink hover:text-muted">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a href={ACCESS_HREF} className="rounded-sm text-[14px] leading-5 font-medium text-ink hover:text-muted">
                Open Reflex
              </a>
            </li>
          </ul>
        </nav>
      </Container>
      <Container className="mt-10">
        <p className="t-caption border-t border-hairline pt-6">
          Reflex is a decision-review and decision-support product. It isn&rsquo;t financial advice and doesn&rsquo;t place trades. Historical patterns don&rsquo;t
          guarantee future results.
        </p>
      </Container>
    </footer>
  );
}
