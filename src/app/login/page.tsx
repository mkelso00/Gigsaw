import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { login } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "ARTIST" ? "/app" : "/dashboard");
  // A brand new install has no logins yet: create the first admin.
  if ((await prisma.user.count()) === 0) redirect("/setup");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <img src="/icon.svg" alt="" className="h-10 w-10 rounded-xl ring-2 ring-white/40" />
          <span className="text-3xl font-bold tracking-tight">Gigsaw</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mb-5 text-sm text-slate-500">Agency staff and artists use the same sign in.</p>
          <ActionForm action={login} className="space-y-4">
            <label className="block">
              <span className="label">Email</span>
              <input name="email" type="email" autoComplete="email" required className="input" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input name="password" type="password" autoComplete="current-password" required className="input" />
            </label>
            <SubmitButton className="btn btn-primary w-full" pendingText="Signing in…">
              Sign in
            </SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-xs text-white/80">Bookings, tours and arrival tracking in one place.</p>
      </div>
    </main>
  );
}
