"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient, authErrorMessage, type AuthAction } from "./auth-client";
import { Field, FormNotice, SubmitButton } from "./form-parts";

const textLink = "font-medium text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink";

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>, action: AuthAction) => {
    setPending(true);
    setError(null);
    try {
      await task();
    } catch (thrown) {
      setError(authErrorMessage(thrown, action));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { pending, error, setError, run } = useSubmit();
  const unavailable = params.get("status") === "unavailable";
  const reset = params.get("status") === "reset";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const { error: authError } = await authClient.signIn.email({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (authError) return setError(authErrorMessage(authError, "sign-in"));
      router.replace("/app");
      router.refresh();
    }, "sign-in");
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {unavailable && <FormNotice tone="error">Account access is unavailable because authentication isn&rsquo;t configured on this server.</FormNotice>}
      {reset && <FormNotice tone="success">Your password was updated. Sign in with the new one.</FormNotice>}
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required autoFocus />
      <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required />
      <div className="-mt-2 text-right text-[14px]">
        <Link href="/forgot-password" className={textLink}>
          Forgot password?
        </Link>
      </div>
      <SubmitButton pending={pending} pendingLabel="Signing in">
        Sign in
      </SubmitButton>
      <p className="text-center text-[14px]">
        New to Reflex?{" "}
        <Link href="/sign-up" className={textLink}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const { pending, error, setError, run } = useSubmit();
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    void run(async () => {
      const { error: authError } = await authClient.signUp.email({ name: String(form.get("name")).trim(), email, password });
      if (authError) return setError(authErrorMessage(authError, "sign-up"));
      const { data } = await authClient.getSession();
      if (!data?.user) return setVerifyEmail(email);
      router.replace("/app");
      router.refresh();
    }, "sign-up");
  };

  if (verifyEmail) {
    return (
      <div className="flex flex-col gap-5">
        <FormNotice tone="success">
          Your account was created. Open the verification link sent to <strong className="font-medium">{verifyEmail}</strong>, then sign in.
        </FormNotice>
        <Link href="/sign-in" className={`${textLink} text-center text-[14px]`}>
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <Field id="name" name="name" label="Name" autoComplete="name" required autoFocus />
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <Field id="password" name="password" type="password" label="Password" autoComplete="new-password" minLength={8} required hint="At least 8 characters." />
      <SubmitButton pending={pending} pendingLabel="Creating account">
        Create account
      </SubmitButton>
      <p className="text-center text-[14px]">
        Already have an account?{" "}
        <Link href="/sign-in" className={textLink}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { pending, error, setError, run } = useSubmit();
  const [sent, setSent] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    void run(async () => {
      const { error: authError } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      if (authError) return setError(authErrorMessage(authError, "request-reset"));
      setSent(true);
    }, "request-reset");
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <FormNotice tone="success">If an account exists for that email, a reset link is on its way. The link expires after a short time.</FormNotice>
        <Link href="/sign-in" className={`${textLink} text-center text-[14px]`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required autoFocus />
      <SubmitButton pending={pending} pendingLabel="Sending link">
        Send reset link
      </SubmitButton>
      <p className="text-center text-[14px]">
        <Link href="/sign-in" className={textLink}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { pending, error, setError, run } = useSubmit();

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <FormNotice tone="error">This page needs the reset link from your email. Open the link again, or request a new one.</FormNotice>
        <Link href="/forgot-password" className={`${textLink} text-center text-[14px]`}>
          Request a new link
        </Link>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword.length < 8) return setError("Use a password with at least 8 characters.");
    if (newPassword !== String(form.get("confirm"))) return setError("The two passwords don't match.");
    void run(async () => {
      const { error: authError } = await authClient.resetPassword({ newPassword, token });
      if (authError) return setError(authErrorMessage(authError, "reset"));
      router.replace("/sign-in?status=reset");
    }, "reset");
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <Field id="password" name="password" type="password" label="New password" autoComplete="new-password" minLength={8} required autoFocus hint="At least 8 characters." />
      <Field id="confirm" name="confirm" type="password" label="Confirm new password" autoComplete="new-password" minLength={8} required />
      <SubmitButton pending={pending} pendingLabel="Saving password">
        Save new password
      </SubmitButton>
    </form>
  );
}
