import type { Metadata } from "next";
import { SiteFooter } from "@/components/landing/closing";
import { ButtonLink, Container } from "@/components/landing/primitives";
import { SiteNav } from "@/components/landing/site-nav";

export const metadata: Metadata = {
  title: "Open Reflex | Reflex",
  description: "Where the Reflex workspace and sign-in will open.",
  robots: { index: false },
};

export default function AccessPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="flex-1 bg-[linear-gradient(180deg,#F6EADC_0%,#FBF5EC_55%,#FFFFFF_100%)]">
        <Container className="flex min-h-[calc(100svh-56px-220px)] flex-col justify-center py-20 lg:py-[120px]">
          <div className="max-w-[640px]">
            <p className="t-eyebrow">Workspace access</p>
            <h1 className="t-h2 mt-4">The Reflex desk opens here.</h1>
            <p className="t-lead mt-4 max-w-[56ch]">
              Reflex accounts run on Neon Auth, and the review engine behind them is live. The sign-in screen and the workspace where you capture and
              review decisions are the next part being built, so there&rsquo;s no account to open from this page yet.
            </p>
            <p className="mt-4 max-w-[56ch]">Nothing here signs you in or stores anything. Come back once the workspace ships.</p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              <ButtonLink href="/#how-it-works" variant="quiet">
                See how Reflex works
              </ButtonLink>
              <ButtonLink href="/" variant="secondary">
                Back to the overview
              </ButtonLink>
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
