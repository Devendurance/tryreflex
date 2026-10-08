import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SignUpForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Create account | Reflex" };

export default function SignUpPage() {
  return (
    <>
      <AuthHeading eyebrow="Reflex account" title="Create your desk.">
        Reflex starts empty. Nothing in your workspace is sample data, and every review is built from what you record.
      </AuthHeading>
      <SignUpForm />
    </>
  );
}
