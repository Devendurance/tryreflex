import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Reset password | Reflex" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading eyebrow="Password" title="Reset your password.">
        Enter the email you signed up with and we&rsquo;ll send a reset link if email delivery is enabled for this workspace.
      </AuthHeading>
      <ForgotPasswordForm />
    </>
  );
}
