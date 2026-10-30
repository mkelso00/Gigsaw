import type { Metadata } from "next";
import Link from "next/link";
import { resetPassword } from "@/actions/password";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { findUsableReset } from "@/lib/reset";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { token } = await params;
  const welcome = (await searchParams).welcome === "1";
  const reset = await findUsableReset(token);
  if (!reset) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle={
          welcome
            ? "Welcome links work once, for 7 days. Ask for a new one below, or ask whoever added you to send it again."
            : "Reset links work once, for one hour. Ask for a new one and use the latest email."
        }
      >
        <Link href="/forgot-password" className="btn btn-primary w-full">
          Send a new link
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={welcome ? `Welcome, ${reset.user.name.split(" ")[0]}` : "Choose a new password"}
      subtitle={welcome ? `Set a password for ${reset.user.email} and you're in.` : `For ${reset.user.email}. You'll be signed out on every other device.`}
    >
      <ActionForm action={resetPassword.bind(null, token)} className="space-y-4">
        <label className="block">
          <span className="label">New password</span>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required className="input" />
          <span className="hint block">At least 8 characters</span>
        </label>
        <label className="block">
          <span className="label">Type it again</span>
          <input name="confirm" type="password" minLength={8} autoComplete="new-password" required className="input" />
        </label>
        <SubmitButton className="btn btn-primary w-full" pendingText="Saving…">
          Save and sign in
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
