import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setupOwner } from "@/actions/setup";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <img src="/icon.svg" alt="" className="h-10 w-10 rounded-xl ring-2 ring-white/40" />
          <span className="text-3xl font-bold tracking-tight">Gigsaw</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Welcome to Gigsaw</h1>
          <p className="mb-5 text-sm text-slate-500">Create the owner account. You&apos;ll use it to add agencies and manage billing. This page only appears once.</p>
          <ActionForm action={setupOwner} className="space-y-4">
            <Field label="Your name">
              <input name="name" required autoComplete="name" className="input" />
            </Field>
            <Field label="Your email">
              <input name="email" type="email" required autoComplete="email" className="input" />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
            </Field>
            <SubmitButton className="btn btn-primary w-full" pendingText="Setting up…">
              Create owner account
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
