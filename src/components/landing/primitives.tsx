import Link from "next/link";
import type { ReactNode } from "react";

export const ACCESS_HREF = "/access";

export const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#why-reflex", label: "Why Reflex" },
] as const;

const MARK_PATH =
  "M147 835H360C430 835 490 780 490 710V590C490 525 545 470 615 470H752C800 470 835 507 835 555C835 600 800 637 752 637H705C655 637 620 675 620 718C620 780 680 835 740 835H978";

export function ReflexMark({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="130 420 1000 480" className={className} aria-hidden="true" focusable="false">
      <path d={MARK_PATH} fill="none" stroke="#241B15" strokeWidth={62} />
      <circle cx={1058} cy={835} r={54} fill="#F26B1D" />
    </svg>
  );
}

export function ReflexLogo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-sm text-ink" aria-label="Reflex home">
      <ReflexMark className="h-[18px] w-auto" />
      <span className="font-serif text-[26px] leading-none font-medium tracking-[-0.01em]">Reflex</span>
    </Link>
  );
}

type Variant = "primary" | "secondary" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-orange hover:bg-orange-hover active:bg-orange-active",
  secondary: "border-[1.5px] border-orange hover:bg-orange-tint",
  quiet: "bg-quiet hover:bg-quiet-hover",
};

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
  className = "",
  onClick,
}: {
  href: string;
  variant?: Variant;
  size?: "md" | "sm";
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const sizing = size === "sm" ? "h-10 px-5 text-[14px]" : "h-12 px-7 text-[15px]";
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-sans leading-5 font-bold text-ink transition-[background-color,transform] duration-150 active:scale-[.98] ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function SectionHeader({ eyebrow, title, lead, id }: { eyebrow?: string; title: string; lead: ReactNode; id?: string }) {
  return (
    <div className="mx-auto mb-12 flex max-w-[760px] flex-col items-center text-center lg:mb-16">
      {eyebrow && (
        <p className="t-eyebrow mb-4 rounded-full border border-hairline bg-[#F8F5EE] px-4 py-1.5">{eyebrow}</p>
      )}
      <h2 id={id} className="t-h2">
        {title}
      </h2>
      <p className="t-lead mt-4 max-w-[62ch]">{lead}</p>
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

export const SECTION_Y = "py-16 sm:py-20 lg:py-[120px]";
