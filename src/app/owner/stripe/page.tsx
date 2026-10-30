import type { Metadata } from "next";
import { saveStripeKeys } from "@/actions/owner";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { appUrl } from "@/lib/messaging";
import { stripe, StripeError } from "@/lib/stripe";
import { maskKey, stripeKeys, stripeKeySources, type StripeKeys } from "@/lib/stripe-keys";

export const metadata: Metadata = { title: "Stripe" };
export const dynamic = "force-dynamic";

// The owner connects Gigsaw's own Stripe account here: the secret key, and the signing secrets
// for the two webhooks (Gigsaw's subscriptions, and card payments into agencies' own accounts).

const FIELDS: { key: keyof StripeKeys; label: string; hint: string; placeholder: string }[] = [
  {
    key: "secretKey",
    label: "Secret key",
    hint: "Stripe dashboard → Developers → API keys → Secret key. Starts sk_live_ (or sk_test_ while testing).",
    placeholder: "sk_live_…",
  },
  {
    key: "webhookSecret",
    label: "Subscriptions webhook signing secret",
    hint: "From the webhook for Gigsaw's own subscriptions (first address below). Starts whsec_.",
    placeholder: "whsec_…",
  },
  {
    key: "connectWebhookSecret",
    label: "Card payments webhook signing secret",
    hint: "From the webhook listening to events on connected accounts (second address below). Starts whsec_.",
    placeholder: "whsec_…",
  },
];

const WEBHOOKS = [
  {
    title: "Subscriptions (your account)",
    path: "/api/stripe/webhook",
    listen: "Events on your account",
    events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"],
  },
  {
    title: "Card payments (connected accounts)",
    path: "/api/stripe/connect-webhook",
    listen: "Events on connected accounts",
    events: ["checkout.session.completed", "checkout.session.async_payment_succeeded", "account.updated", "account.application.deauthorized"],
  },
];

export default async function OwnerStripePage() {
  await requireOwner();
  const [keys, source] = await Promise.all([stripeKeys(), stripeKeySources()]);

  // Ask Stripe who the key belongs to, so it's clear which account (and live or test) is connected.
  let account: { name: string; live: boolean } | null = null;
  let problem = "";
  if (keys.secretKey) {
    try {
      const a = await stripe<{ settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string }; email?: string }>("GET", "account");
      account = {
        name: a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || "Your Stripe account",
        live: keys.secretKey.includes("_live_"),
      };
    } catch (e) {
      problem = e instanceof StripeError ? e.message : "Couldn't reach Stripe just now.";
    }
  }
  const allSet = !!account && !!keys.webhookSecret && !!keys.connectWebhookSecret;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Stripe"
        subtitle="Connect Gigsaw's Stripe account: subscriptions for businesses, and card payments into each business's own account."
      />

      {/* Status, like a desk's channel lights. */}
      <section className="card mb-8 divide-y divide-ink-100">
        <Status
          on={!!account}
          warn={!!problem}
          title={account ? `Connected to ${account.name}` : problem ? "Stripe didn't accept the secret key" : "Not connected yet"}
          sub={account ? (account.live ? "Live mode: real payments." : "Test mode: no real money moves.") : problem || "Paste your secret key below."}
        />
        <Status
          on={!!keys.webhookSecret}
          title="Subscriptions webhook"
          sub={keys.webhookSecret ? "Signing secret saved." : "Needed so Gigsaw hears when a business subscribes or cancels."}
        />
        <Status
          on={!!keys.connectWebhookSecret}
          title="Card payments webhook"
          sub={keys.connectWebhookSecret ? "Signing secret saved." : "Needed so card payments are recorded on the booking."}
        />
        {allSet && (
          <p className="px-5 py-3 text-sm text-volt-700">All set. Businesses can subscribe, and take card payments once they connect their own Stripe.</p>
        )}
      </section>

      <h2 className="section-title mb-3">Keys</h2>
      <ActionForm action={saveStripeKeys} className="card card-pad mb-10 space-y-6">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={f.key}>
              {f.label}
            </label>
            <input
              id={f.key}
              name={f.key}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={keys[f.key] ? `Saved: ${maskKey(keys[f.key])}. Leave blank to keep it.` : f.placeholder}
              className="input font-mono"
            />
            <div className="hint flex flex-wrap items-center justify-between gap-2">
              <span>{f.hint}</span>
              {source[f.key] === "owner" ? (
                <label className="flex items-center gap-1.5 text-ink-600">
                  <input type="checkbox" name={`${f.key}Remove`} /> Remove
                </label>
              ) : source[f.key] === "server" ? (
                <span className="text-ink-400">Set on the server; anything you paste here takes over.</span>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t border-ink-100 pt-5">
          <p className="text-xs text-ink-500">Keys are only ever shown as their last four characters. Only owners can see this page.</p>
          <SubmitButton className="btn btn-primary" pendingText="Checking with Stripe…">
            Save keys
          </SubmitButton>
        </div>
      </ActionForm>

      <h2 className="section-title mb-1">Webhooks to add in Stripe</h2>
      <p className="mb-4 text-sm text-ink-500">
        Stripe dashboard → Developers → Webhooks → Add endpoint. Add both, then paste each one&apos;s signing secret above.
      </p>
      <div className="space-y-4">
        {WEBHOOKS.map((w) => (
          <section key={w.path} className="card card-pad">
            <p className="font-semibold">{w.title}</p>
            <p className="mt-1 text-sm text-ink-500">Listen to: {w.listen}</p>
            <div className="mt-3">
              <CopyField value={`${appUrl()}${w.path}`} />
            </div>
            <p className="mt-3 text-sm text-ink-500">Events:</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {w.events.map((e) => (
                <li key={e} className="badge bg-ink-100 font-mono text-ink-700">
                  {e}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="card card-pad text-sm text-ink-600">
          <p className="font-semibold text-ink-950">Also in Stripe</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Settings → Billing → Customer portal: switch it on, so businesses can change cards and see invoices.</li>
            <li>Connect → Get started: choose Standard accounts, so each business takes card payments into its own Stripe account.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Status({ on, warn = false, title, sub }: { on: boolean; warn?: boolean; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${on ? "bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)]" : warn ? "bg-cue-500 shadow-[0_0_8px_var(--color-cue-400)]" : "bg-ink-300"}`}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-ink-500">{sub}</span>
      </span>
    </div>
  );
}
