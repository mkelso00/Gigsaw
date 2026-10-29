import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "@/actions/password";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter the email you sign in with and we'll send you a link to choose a new one.">
      <ActionForm action={requestPasswordReset} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" autoComplete="email" required className="input" />
        </label>
        <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-500">
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
