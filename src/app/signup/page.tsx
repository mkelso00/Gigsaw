import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { forgetPendingSignup } from "@/actions/oauth";
import { signUp } from "@/actions/signup";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { OAuthButtons, OAuthNotice, ProviderLogo } from "@/components/oauth-buttons";
import { currentUser, homePath } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { configuredProviders, PROVIDERS } from "@/lib/oauth";
import { pendingSignup } from "@/lib/oauth-flow";
import { loadCatalogue } from "@/lib/plan-store";
import { choosablePlans, CURRENCY, featuredPlan, findPlan, yearlySavingLabel } from "@/lib/plans";

export const metadata: Metadata = { title: "Start your free trial" };
export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string; oauth?: string; p?: string; email?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect(homePath(user));
  const sp = await searchParams;
  const catalogue = await loadCatalogue();
  const plans = choosablePlans(catalogue.plans);
  const chosen = findPlan(plans, sp.plan?.toUpperCase()) ?? featuredPlan(catalogue.plans);
  const saving = yearlySavingLabel(plans);
  const interval = sp.interval === "year" ? "year" : "month";
  // Came back from "Sign up with Google/Microsoft": their name and email are filled in, no password needed.
  const linked = await pendingSignup();
  return (
    <AuthShell
      title={`Try Gigsaw free for ${catalogue.trialDays} days`}
      subtitle="Set up your business in a minute. Add a card any time before your trial ends."
    >
      <OAuthNotice sp={sp} />
      {linked ? (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm">
          <ProviderLogo provider={linked.provider} className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink-950">Signing up with {PROVIDERS[linked.provider].label}</span>
            <span className="block break-all text-ink-500">{linked.email}</span>
          </span>
          <form action={forgetPendingSignup}>
            <button className="btn btn-sm">Use a password</button>
          </form>
        </div>
      ) : (
        <OAuthButtons providers={configuredProviders()} intent="signup" verb="Sign up" />
      )}
      <ActionForm action={signUp} className="space-y-4">
        <input name="company_site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <fieldset>
          <legend className="label">Plan</legend>
          <div className="grid gap-2">
            {plans.map((p) => (
              <label
                key={p.key}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3 has-[:checked]:border-ink-950"
              >
                <span className="flex items-center gap-3">
                  <input type="radio" name="plan" value={p.key} defaultChecked={p.key === chosen?.key} className="h-4 w-4 accent-ink-950" />
                  <span>
                    <span className="block text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-ink-500">{p.gigsPerMonth ? `Up to ${p.gigsPerMonth} bookings a month` : "Unlimited bookings"}</span>
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {formatMoney(interval === "year" ? p.yearlyMinor : p.monthlyMinor, CURRENCY)}
                  <span className="text-xs text-ink-500">/{interval === "year" ? "year" : "month"}</span>
                </span>
              </label>
            ))}
          </div>
          <input type="hidden" name="interval" value={interval} />
          <p className="mt-1.5 text-xs text-ink-500">
            Paying {interval === "year" ? `yearly${saving ? ` (${saving.toLowerCase()})` : ""}` : "monthly"}.{" "}
            <Link href={`/signup?plan=${chosen?.key ?? ""}&interval=${interval === "year" ? "month" : "year"}`} className="underline">
              Switch to {interval === "year" ? "monthly" : "yearly"}
            </Link>
            . You can change plan any time.
          </p>
        </fieldset>
        <label className="block">
          <span className="label">Business name</span>
          <input name="business" required autoComplete="organization" className="input" placeholder="e.g. Suave Agency" />
        </label>
        <label className="block">
          <span className="label">Your name</span>
          <input name="name" required autoComplete="name" defaultValue={linked?.name ?? ""} className="input" />
        </label>
        <label className="block">
          <span className="label">Email</span>
          {linked ? (
            <input value={linked.email} readOnly className="input opacity-70" />
          ) : (
            <input name="email" type="email" required autoComplete="email" className="input" />
          )}
        </label>
        <label className="block">
          <span className="label">Mobile (optional)</span>
          <input name="phone" type="tel" autoComplete="tel" className="input" />
        </label>
        {!linked && (
          <label className="block">
            <span className="label">Password</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
          </label>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="demo" className="mt-0.5 h-4 w-4 accent-ink-950" />
          <span className="text-ink-600">Fill it with sample acts, venues and bookings to try things out (remove them in one click later)</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="terms" required className="mt-0.5 h-4 w-4 accent-ink-950" />
          <span className="text-ink-600">
            I agree to the{" "}
            <Link href="/terms" className="underline" target="_blank">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline" target="_blank">
              privacy policy
            </Link>
          </span>
        </label>
        <SubmitButton className="btn btn-primary h-11 w-full" pendingText="Setting up…">
          Start my free trial
        </SubmitButton>
        <p className="text-center text-sm text-ink-500">
          Already using Gigsaw?{" "}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </ActionForm>
    </AuthShell>
  );
}
