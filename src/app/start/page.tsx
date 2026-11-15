import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requestClaimLink } from "@/actions/claim";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { currentUser, homePath } from "@/lib/auth";

export const metadata: Metadata = { title: "Set up your login" };
export const dynamic = "force-dynamic";

// For acts whose agency already has their email: they set their own password from a link, so
// nobody has to make one up and send it to them. See src/lib/act-claim.ts.
export default async function StartPage() {
  const user = await currentUser();
  if (user) redirect(homePath(user));
  return (
    <AuthShell title="Set up your login" subtitle="Type the email your agency has for you. We'll send you a link to create your password.">
      <ActionForm action={requestClaimLink} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" autoComplete="email" inputMode="email" required className="input" />
        </label>
        <SubmitButton className="btn btn-primary h-11 w-full" pendingText="Sending…">
          Send me a link
        </SubmitButton>
      </ActionForm>
      <ol className="mt-8 space-y-2 text-sm text-ink-600">
        {["Type your email", "Open the link we send and create a password", "Add your bank details. That's how you get paid from now on."].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">{i + 1}</span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm text-ink-500">
        Already set up?{" "}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
