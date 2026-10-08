"use client";

import { BookCheck, ChevronDown, Dna, History, FileSpreadsheet, LayoutDashboard, Microscope, Loader2, LogOut, Menu, NotebookPen, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "@/components/auth/auth-client";
import { buttonClass, ReflexLogo } from "@/components/landing/primitives";

export type WorkspaceUser = { id: string; name: string; email: string; emailVerified: boolean };

const UserContext = createContext<WorkspaceUser | null>(null);

export function useWorkspaceUser(): WorkspaceUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useWorkspaceUser must be used inside WorkspaceShell");
  return user;
}

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/decisions", label: "Decision Desk", icon: NotebookPen },
  { href: "/app/activity", label: "Trade Activity", icon: FileSpreadsheet },
  { href: "/app/autopsies", label: "Autopsies", icon: Microscope },
  { href: "/app/dna", label: "Decision DNA", icon: Dna },
  { href: "/app/playbook", label: "Playbook", icon: BookCheck },
  { href: "/app/recall", label: "Pre-Trade Recall", icon: History },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-8">
      <ul className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex h-11 items-center gap-3 rounded-full px-4 text-[15px] font-medium text-ink transition-colors ${
                  active ? "bg-quiet" : "hover:bg-quiet/60"
                }`}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function initials(user: WorkspaceUser) {
  const source = user.name.trim() || user.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function UserMenu({ user, compact = false }: { user: WorkspaceUser; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      const { error: authError } = await authClient.signOut();
      if (authError) throw authError;
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Couldn't sign out. Check your connection and try again.");
      setSigningOut(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.name || user.email}`}
        className={`flex items-center gap-3 rounded-full text-left text-ink transition-colors hover:bg-quiet/60 ${compact ? "p-1" : "w-full p-2"}`}
      >
        <span className="t-data inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-cream">{initials(user)}</span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] leading-5 font-medium">{user.name || "Your account"}</span>
              <span className="block truncate text-[13px] leading-5 text-muted">{user.email}</span>
            </span>
            <ChevronDown size={16} aria-hidden className="shrink-0" />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-64 rounded-[12px] border border-hairline bg-white p-2 shadow-[0_12px_32px_rgba(36,27,21,.10),0_2px_6px_rgba(36,27,21,.06)] ${
            compact ? "top-full right-0 mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          <div className="border-b border-hairline px-3 pt-2 pb-3">
            <p className="truncate text-[14px] font-medium text-ink">{user.name || "Your account"}</p>
            <p className="truncate text-[13px]">{user.email}</p>
          </div>
          <Link role="menuitem" href="/" className="mt-1 flex h-10 items-center rounded-[8px] px-3 text-[14px] text-ink hover:bg-paper">
            Reflex home page
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-paper disabled:opacity-45"
          >
            {signingOut ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <LogOut size={16} aria-hidden />}
            {signingOut ? "Signing out" : "Sign out"}
          </button>
          {error && (
            <p role="alert" className="px-3 pt-1 pb-2 text-[13px] text-loss">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MobileNav() {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label="Open workspace menu"
        aria-haspopup="dialog"
        className="-ml-2 inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-quiet"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden />
      </button>
      <dialog
        ref={dialog}
        aria-label="Workspace menu"
        className="m-0 h-dvh max-h-none w-[min(320px,86vw)] max-w-none bg-paper p-0 text-muted backdrop:bg-ink/30"
        onClick={(event) => event.target === dialog.current && close()}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-5">
            <ReflexLogo onClick={close} />
            <button type="button" onClick={close} aria-label="Close workspace menu" className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-quiet">
              <X size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-6">
            <NavList onNavigate={close} />
          </div>
        </div>
      </dialog>
    </>
  );
}

function FullPageState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh flex-col items-center justify-center gap-5 bg-paper px-5 text-center">{children}</div>;
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending, error, refetch } = authClient.useSession();
  const signedOut = !isPending && !error && !data?.user;

  useEffect(() => {
    if (signedOut) router.replace("/sign-in");
  }, [signedOut, router]);

  if (isPending || signedOut) {
    return (
      <FullPageState>
        <Loader2 size={24} className="animate-spin text-ink motion-reduce:animate-none" aria-hidden />
        <p role="status">{signedOut ? "Redirecting to sign in" : "Opening your desk"}</p>
      </FullPageState>
    );
  }

  if (error || !data?.user) {
    return (
      <FullPageState>
        <p className="t-brief">Your session couldn&rsquo;t be checked.</p>
        <p className="max-w-[44ch]">The account service didn&rsquo;t respond. Nothing was changed. Try again, or sign in again if this keeps happening.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => refetch()} className={buttonClass("primary")}>
            Try again
          </button>
          <Link href="/sign-in" className={buttonClass("secondary")}>
            Go to sign in
          </Link>
        </div>
      </FullPageState>
    );
  }

  const user: WorkspaceUser = {
    id: data.user.id,
    name: data.user.name ?? "",
    email: data.user.email,
    emailVerified: Boolean(data.user.emailVerified),
  };

  return (
    <UserContext.Provider value={user}>
      <div className="min-h-svh bg-paper lg:grid lg:grid-cols-[264px_1fr]">
        <aside className="sticky top-0 hidden h-svh flex-col border-r border-hairline bg-cream lg:flex">
          <div className="flex h-16 items-center px-6">
            <ReflexLogo />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-6">
            <NavList />
          </div>
          <div className="border-t border-hairline p-3">
            <UserMenu user={user} />
          </div>
        </aside>

        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-hairline bg-[rgba(251,245,236,.92)] px-5 backdrop-blur-[12px] sm:px-8 lg:hidden">
          <MobileNav />
          <ReflexLogo />
          <UserMenu user={user} compact />
        </header>

        <main id="main" className="min-w-0 px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <div className="mx-auto w-full max-w-[1040px]">{children}</div>
        </main>
      </div>
    </UserContext.Provider>
  );
}
