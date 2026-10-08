import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Choose a new password | Reflex" };

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading eyebrow="Password" title="Choose a new password.">
        After saving, sign in again with the new password.
      </AuthHeading>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </>
  );
}
