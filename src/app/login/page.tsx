import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { OAuthButtons, OAuthNotice } from "@/components/oauth-buttons";
import { currentUser, homePath } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { configuredProviders } from "@/lib/oauth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ oauth?: string; p?: string; email?: string }> }) {
  const user = await currentUser();
  if (user) redirect(homePath(user));
  // A brand new install has no logins yet: create the owner first.
  if ((await prisma.user.count()) === 0) redirect("/setup");
  const sp = await searchParams;

  return (
    <AuthShell title="Welcome back" subtitle="Agency teams and acts sign in here.">
      <OAuthNotice sp={sp} />
      <OAuthButtons providers={configuredProviders()} intent="login" verb="Sign in" />
      <ActionForm action={login} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" autoComplete="email" required className="input" />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between">
            <span className="label">Password</span>
            <Link href="/forgot-password" className="text-xs text-ink-500 hover:text-ink-950">
              Forgot password?
            </Link>
          </span>
          <input name="password" type="password" autoComplete="current-password" required className="input" />
        </label>
        <SubmitButton className="btn btn-primary h-11 w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
