import type { Metadata } from "next";
import Link from "next/link";
import { resetPassword } from "@/actions/password";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { CLAIM_HOURS } from "@/lib/act-claim";
import { findUsableReset } from "@/lib/reset";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ welcome?: string; claim?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const welcome = sp.welcome === "1";
  // A set-up link an act asked for at /start (src/lib/act-claim.ts).
  const claim = sp.claim === "1";
  const reset = await findUsableReset(token);
  if (!reset) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle={
          claim
            ? `Set-up links work once, for ${CLAIM_HOURS} hours. Type your email again for a new one. Already made a password? Just sign in.`
            : welcome
              ? "Welcome links work once, for 7 days. Ask for a new one below, or ask whoever added you to send it again."
              : "Reset links work once, for one hour. Ask for a new one and use the latest email."
        }
      >
        <Link href={claim ? "/start" : "/forgot-password"} className="btn btn-primary w-full">
          Send a new link
        </Link>
        {claim && (
          <p className="mt-6 text-sm text-ink-500">
            <Link href="/login" className="link">
              Sign in
            </Link>
          </p>
        )}
      </AuthShell>
    );
  }
  const first = reset.user.name.split(" ")[0];
  return (
    <AuthShell
      title={claim ? "Create your password" : welcome ? `Welcome, ${first}` : "Choose a new password"}
      subtitle={
        claim
          ? `For ${reset.user.email}. Next you'll add your bank details, so you can be paid.`
          : welcome
            ? `Set a password for ${reset.user.email} and you're in.`
            : `For ${reset.user.email}. You'll be signed out on every other device.`
      }
    >
      <ActionForm action={resetPassword.bind(null, token)} className="space-y-4">
        <label className="block">
          <span className="label">{claim ? "Password" : "New password"}</span>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required className="input" />
          <span className="hint block">At least 8 characters</span>
        </label>
        <label className="block">
          <span className="label">Type it again</span>
          <input name="confirm" type="password" minLength={8} autoComplete="new-password" required className="input" />
        </label>
        <SubmitButton className="btn btn-primary w-full" pendingText="Saving…">
          {claim ? "Create password" : "Save and sign in"}
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
