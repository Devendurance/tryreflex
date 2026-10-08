import type { ReactNode } from "react";

export function AuthHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-8">
      <p className="t-eyebrow">{eyebrow}</p>
      <h1 className="t-h2 mt-3">{title}</h1>
      <p className="mt-3">{children}</p>
    </div>
  );
}
