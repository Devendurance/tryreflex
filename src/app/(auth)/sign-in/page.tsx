import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SignInForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Sign in | Reflex" };

export default function SignInPage() {
  return (
    <>
      <AuthHeading eyebrow="Reflex account" title="Sign in to your desk.">
        Your decisions, reviews and Playbook stay private to your account.
      </AuthHeading>
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
