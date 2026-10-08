import { Capabilities } from "@/components/landing/capabilities";
import { ClosingCta, SiteFooter } from "@/components/landing/closing";
import { Differentiation } from "@/components/landing/differentiation";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProblemSection } from "@/components/landing/problem-section";
import { SiteNav } from "@/components/landing/site-nav";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main" className="flex-1">
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <Capabilities />
        <Differentiation />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
