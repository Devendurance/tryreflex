"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCESS_HREF, ButtonLink, NAV_LINKS, ReflexLogo } from "./primitives";

const linkClass = "rounded-sm text-[14px] leading-5 font-medium text-ink transition-colors hover:text-muted";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-[rgba(246,234,220,.8)] backdrop-blur-[12px]">
      <nav aria-label="Primary" className="mx-auto grid h-14 w-full max-w-[1280px] grid-cols-[1fr_auto] items-center px-5 sm:px-8 md:grid-cols-[1fr_auto_1fr]">
        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.slice(0, 2).map((link) => (
            <li key={link.href}>
              <a href={link.href} className={linkClass}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="md:justify-self-center">
          <ReflexLogo />
        </div>

        <div className="hidden items-center justify-end gap-6 md:flex">
          <a href={NAV_LINKS[2].href} className={linkClass}>
            {NAV_LINKS[2].label}
          </a>
          <ButtonLink href={ACCESS_HREF} variant="quiet" size="sm">
            Open Reflex
          </ButtonLink>
        </div>

        <button
          type="button"
          className="-mr-2 inline-flex size-11 items-center justify-center justify-self-end rounded-full text-ink transition-colors hover:bg-quiet md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={22} strokeWidth={1.75} aria-hidden /> : <Menu size={22} strokeWidth={1.75} aria-hidden />}
        </button>
      </nav>

      <div id="mobile-menu" hidden={!open} className="border-t border-hairline bg-cream md:hidden">
        <ul className="flex flex-col px-5 py-3">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={close} className="flex h-12 items-center rounded-sm text-[16px] font-medium text-ink">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="px-5 pb-5">
          <ButtonLink href={ACCESS_HREF} variant="quiet" className="w-full" onClick={close}>
            Open Reflex
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
