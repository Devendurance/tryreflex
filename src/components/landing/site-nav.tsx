"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ACCESS_HREF, ButtonLink, NAV_LINKS, ReflexLogo } from "./primitives";

const noopSubscribe = () => () => {};

const linkClass = "rounded-sm text-[14px] leading-5 font-medium text-ink transition-colors hover:text-muted";
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function MobileMenu({ open, onClose, panelRef }: { open: boolean; onClose: () => void; panelRef: React.RefObject<HTMLDivElement | null> }) {
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const stagger = (index: number) => ({ transitionDelay: open ? `${140 + index * 60}ms` : "0ms" });
  const item = `transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
    open ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0 motion-reduce:translate-x-0"
  }`;

  return (
    <div
      ref={panelRef}
      id="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={trapFocus}
      className={`fixed inset-0 z-[100] flex flex-col overflow-y-auto overscroll-contain bg-cream transition-[transform,visibility] duration-[400ms] ease-out motion-reduce:transition-none md:hidden ${
        open ? "visible translate-x-0" : "invisible translate-x-full"
      }`}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-5 sm:px-8">
        <ReflexLogo onClick={onClose} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-quiet"
        >
          <X size={22} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <nav aria-label="Mobile" className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-8">
        <p className={`t-eyebrow ${item}`} style={stagger(0)}>
          Menu
        </p>
        <ul className="mt-6 flex flex-col gap-2">
          {NAV_LINKS.map((link, index) => (
            <li key={link.href} className={item} style={stagger(index + 1)}>
              <a
                href={link.href}
                onClick={onClose}
                className="flex min-h-14 items-center rounded-sm font-serif text-[40px] leading-[48px] font-medium tracking-[-0.015em] text-ink transition-colors hover:text-muted"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={`shrink-0 px-5 sm:px-8 ${item}`} style={stagger(NAV_LINKS.length + 1)}>
        <ButtonLink href={ACCESS_HREF} className="w-full" onClick={onClose}>
          Open Reflex
        </ButtonLink>
        <p className="t-caption mt-4 text-center">No signals. No automatic execution.</p>
      </div>
    </div>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) toggleRef.current?.focus({ preventScroll: true });
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;

    const html = document.documentElement;
    const body = document.body;
    const scrollbar = window.innerWidth - html.clientWidth;
    const previous = { overflow: html.style.overflow, paddingRight: body.style.paddingRight };
    html.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const siblings = [...body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(panelRef.current));
    const wasInert = siblings.map((el) => el.inert);
    siblings.forEach((el) => (el.inert = true));

    const focusTimer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button[aria-label="Close menu"]')?.focus({ preventScroll: true }), 50);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      siblings.forEach((el, i) => (el.inert = wasInert[i]));
      html.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
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
          ref={toggleRef}
          type="button"
          className="-mr-2 inline-flex size-11 items-center justify-center justify-self-end rounded-full text-ink transition-colors hover:bg-quiet md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-haspopup="dialog"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} strokeWidth={1.75} aria-hidden />
        </button>
      </nav>

      {mounted && createPortal(<MobileMenu open={open} onClose={close} panelRef={panelRef} />, document.body)}
    </header>
  );
}
