import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "@/components/landing/primitives";

export function Field({ label, hint, id, ...input }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] leading-5 font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-14 rounded-[12px] border border-hairline bg-white px-5 text-[16px] text-ink transition-[border-color,box-shadow] outline-none focus-visible:outline-none placeholder:text-[rgba(36,27,21,.45)] focus:border-ink focus:shadow-[0_0_0_4px_rgba(242,107,29,.18)] aria-[invalid=true]:border-loss"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-[13px] leading-5">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormNotice({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-[12px] border p-4 text-[14px] leading-[22px] text-ink ${
        tone === "error" ? "border-loss/30 bg-loss/5" : "border-gain/30 bg-gain/5"
      }`}
    >
      <Icon size={18} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${tone === "error" ? "text-loss" : "text-gain"}`} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: ReactNode; pendingLabel: string }) {
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={`${buttonClass("primary")} w-full`}>
      {pending && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {pending ? pendingLabel : children}
    </button>
  );
}
