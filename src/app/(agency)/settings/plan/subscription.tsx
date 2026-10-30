import type { Agency } from "@prisma/client";
import { changePlan, openBillingPortal, startCheckout } from "@/actions/billing";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { loadCatalogue } from "@/lib/plan-store";
import { choosablePlans, CURRENCY, findPlan, monthsFree, planForGigs } from "@/lib/plans";
import { describeDiscount, fromStripeCoupon } from "@/lib/discounts";
import { parseLookupKey, stripe, stripeConfigured } from "@/lib/stripe";
import type { StripeSubscription } from "@/lib/subscription-sync";
import { billingState } from "@/lib/subscription";

// Settings > Plan for a business that pays by card: its trial or subscription, how much of the
// plan it's using this month, and changing plan.

export async function SubscriptionPlan({
  agency,
  gigs,
  users,
  subscribed: justSubscribed,
}: {
  agency: Agency;
  gigs: number;
  users: number;
  subscribed: boolean;
}) {
  const b = billingState(agency);
  const catalogue = await loadCatalogue();
  const m = (x: number) => formatMoney(x, CURRENCY);
  const yearly = agency.billingInterval === "year";
  const plan = findPlan(catalogue.plans, agency.plan);
  // Plans on the website, plus the one they're on if the owner gave them a hidden or archived one.
  const options = choosablePlans(catalogue.plans);
  if (plan && !options.some((p) => p.key === plan.key)) options.unshift(plan);
  const over = plan?.gigsPerMonth != null && gigs > plan.gigsPerMonth;
  const suggest = over ? planForGigs(catalogue.plans, gigs) : null;
  const tone = b.status === "PAST_DUE" || b.locked ? "red" : b.subscribed ? "green" : "amber";
  const stripeOn = await stripeConfigured();
  // Once subscribed, what they pay is what's on their Stripe subscription: they keep the price they
  // signed up at when plan prices change, and may have a discount.
  let paying: number | null = null;
  let discount = "";
  if (b.subscribed && stripeOn && agency.stripeSubscriptionId) {
    const sub = await stripe<StripeSubscription>("GET", `subscriptions/${agency.stripeSubscriptionId}`).catch(() => null);
    const item = sub?.items.data.map((i) => parseLookupKey(i.price.lookup_key)).find((k) => k && k.kind !== "EXTRA_USER");
    if (item) paying = item.amountMinor;
    if (sub?.discount) discount = describeDiscount(fromStripeCoupon(sub.discount.coupon));
  }
  return (
    <SettingsPage title="Plan">
      {justSubscribed && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Thank you. Your card is saved and your subscription is set up. It can take a few seconds to show here.
        </div>
      )}
      <section className="rounded-[var(--radius-card)] bg-ink-950 p-6 text-white">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[13px] text-white/60">Your plan</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">{plan?.name ?? "No plan chosen"}</div>
            {plan && (
              <div className="mt-1 text-sm text-white/70">
                {m(paying ?? (yearly ? plan.yearlyMinor : plan.monthlyMinor))} a {yearly ? "year" : "month"} ·{" "}
                {plan.gigsPerMonth ? `up to ${plan.gigsPerMonth} bookings a month` : "unlimited bookings"} · {plan.includedUsers} internal users included
              </div>
            )}
            {discount && <div className="mt-2 inline-flex rounded-md bg-volt-400/15 px-2 py-0.5 text-xs font-medium text-volt-300">Discount: {discount}</div>}
          </div>
          <div className="text-right">
            <Badge tone={tone}>{b.label}</Badge>
            {agency.currentPeriodEnd && b.subscribed && (
              <div className="mt-2 text-xs text-white/60">Next payment {formatDate(agency.currentPeriodEnd, "Europe/London")}</div>
            )}
            {!b.subscribed && agency.trialEndsAt && (
              <div className="mt-2 text-xs text-white/60">Trial ends {formatDate(agency.trialEndsAt, "Europe/London")}</div>
            )}
          </div>
        </div>
      </section>

      <SettingsSection title="This month">
        <SettingsCard>
          <SettingsRow
            icon="bookings"
            title={`${gigs} booking${gigs === 1 ? "" : "s"}${plan?.gigsPerMonth ? ` of ${plan.gigsPerMonth}` : ""}`}
            sub={
              over && suggest && suggest.key !== plan?.key
                ? `You're over your plan's bookings. Nothing stops working, but ${suggest.name} fits better.`
                : "A booking counts when it's confirmed or settled, the act checks in, or it's left on hold or pending after its date."
            }
          />
          <SettingsRow
            icon="contacts"
            title={`${users} internal user${users === 1 ? "" : "s"}${plan ? ` of ${plan.includedUsers} included` : ""}`}
            sub={`Each extra one is ${m(yearly ? catalogue.extraUserYearlyMinor : catalogue.extraUserMonthlyMinor)} a ${yearly ? "year" : "month"}. Acts, venue managers and customers are free.`}
            href="/settings/users"
          />
        </SettingsCard>
      </SettingsSection>

      {!stripeOn ? (
        <SettingsCard pad>
          <p className="text-sm text-ink-500">Card payments aren&apos;t switched on yet. Your trial carries on as normal in the meantime.</p>
        </SettingsCard>
      ) : (
        <SettingsSection title="Payment">
          <SettingsCard>
            {b.subscribed ? (
              <SettingsRow
                icon="billing"
                title="Card, invoices and cancelling"
                sub="Opens Stripe, where your card details are kept safe."
                right={
                  <ActionForm action={openBillingPortal}>
                    <SubmitButton className="btn btn-sm" pendingText="Opening…">
                      Manage billing
                    </SubmitButton>
                  </ActionForm>
                }
              />
            ) : (
              <SettingsRow
                icon="billing"
                title={b.locked ? "Add a card to carry on" : "Add a card"}
                sub={
                  b.trialDaysLeft
                    ? `You won't be charged until your trial ends in ${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? "" : "s"}.`
                    : "You'll be charged today, then every month or year."
                }
                right={
                  <ActionForm action={startCheckout}>
                    <SubmitButton className="btn btn-primary btn-sm" pendingText="Opening…">
                      Add card and subscribe
                    </SubmitButton>
                  </ActionForm>
                }
              />
            )}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection
        title="Change plan"
        description="Changes take effect straight away. If you're subscribed, Stripe adjusts your next bill for the days left."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {options.map((p) => {
            const current = p.key === plan?.key;
            return (
              <div key={p.key} className={`card flex flex-col p-5 ${current ? "ring-2 ring-volt-400" : ""}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {current && <Badge tone="green">Current</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-500">{p.tagline}</p>
                <div className="mt-3 text-2xl font-semibold tabular-nums">
                  {m(p.monthlyMinor)}
                  <span className="text-sm font-normal text-ink-500">/month</span>
                </div>
                <div className="text-xs text-ink-500">
                  or {m(p.yearlyMinor)} a year{monthsFree(p) ? ` (${monthsFree(p)} month${monthsFree(p) === 1 ? "" : "s"} free)` : ""}
                </div>
                <ul className="mt-3 mb-4 space-y-1 text-sm text-ink-600">
                  {p.highlights.map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                </ul>
                <ActionForm action={changePlan} className="mt-auto flex flex-wrap gap-2">
                  <input type="hidden" name="plan" value={p.key} />
                  {(["month", "year"] as const).map((i) =>
                    current && agency.billingInterval === i ? null : (
                      <SubmitButton key={i} className="btn btn-sm" name="interval" value={i} pendingText="Changing…">
                        {current ? `Switch to ${i === "year" ? "yearly" : "monthly"}` : `Choose ${i === "year" ? "yearly" : "monthly"}`}
                      </SubmitButton>
                    ),
                  )}
                </ActionForm>
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
