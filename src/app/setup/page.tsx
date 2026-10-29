import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setupOwner } from "@/actions/setup";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <AuthShell title="Welcome to Gigsaw" subtitle="Create the owner account. You'll use it to add agencies and manage billing. This page only appears once.">
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
        <SubmitButton className="btn btn-primary h-11 w-full" pendingText="Setting up…">
          Create owner account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
