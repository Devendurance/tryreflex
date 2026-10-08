import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EngineGhost } from "@/components/landing/reflex-engine";
import { ReflexLogo } from "@/components/landing/primitives";

export const metadata: Metadata = { robots: { index: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-[linear-gradient(180deg,#F6EADC_0%,#FBF5EC_55%,#FFFFFF_100%)] lg:grid lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden border-r border-hairline lg:flex lg:flex-col lg:justify-between lg:p-12">
        <ReflexLogo />
        <EngineGhost className="pointer-events-none absolute top-1/2 left-1/2 w-[520px] -translate-x-1/2 -translate-y-1/2" />
        <div className="relative max-w-[440px]">
          <p className="t-h2">P&amp;L is a bad teacher.</p>
          <p className="t-lead mt-4">Reflex keeps what you believed before the result, so every review learns from the decision and not the luck.</p>
        </div>
      </aside>
      <div className="flex h-14 items-center border-b border-hairline px-5 lg:hidden">
        <ReflexLogo />
      </div>
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}
