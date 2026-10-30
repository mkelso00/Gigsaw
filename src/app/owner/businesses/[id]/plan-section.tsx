import type { Agency } from "@prisma/client";
import Link from "next/link";
import { applyDiscount, removeDiscount } from "@/actions/owner-discounts";
import { adjustTrial, setAgencyPlan } from "@/actions/owner-plans";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { CURRENCIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { describeDiscount, fromStripeCoupon } from "@/lib/discounts";
import { formatMoney, minorToInput } from "@/lib/money";
import { loadCatalogue } from "@/lib/plan-store";
import { CURRENCY, findPlan } from "@/lib/plans";
import { userCharge } from "@/lib/seats";
import { parseLookupKey, stripe, stripeConfigured, StripeError } from "@/lib/stripe";
import { billingState, hasLiveSubscription } from "@/lib/subscription";
import type { StripeSubscription } from "@/lib/subscription-sync";
import { formatDate } from "@/lib/time";

// The Plan and Discount sections of a business's page in the Owner area: put it on a plan, a custom
// price by invoice, or a free account; extend or end its trial; and give it a discount.

const MODES = [
  { value: "PLAN", title: "A plan, by card", sub: "They pay by card through Stripe after a free trial" },
  { value: "CUSTOM", title: "Custom, by invoice", sub: "A price per booking. You send statements from Billing" },
  { value: "FREE", title: "Free account", sub: "No charge and never locked. For friends and test accounts" },
] as const;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function PlanSection({ agency, staffCount }: { agency: Agency; staffCount: number }) {
  const [catalogue, stripeOn] = await Promise.all([loadCatalogue(), stripeConfigured()]);
  const billing = billingState(agency);
  const live = hasLiveSubscription(agency);
  const current = findPlan(catalogue.plans, agency.plan);
  const options = catalogue.plans.filter((p) => !p.archived || p.key === agency.plan);
  const mode = agency.billingMode === "FREE" ? "FREE" : agency.billingMode === "STRIPE" ? "PLAN" : "CUSTOM";
  const trialOpen = agency.billingMode === "STRIPE" && (!live || agency.subscriptionStatus === "TRIALING");
  const seats = userCharge(agency, staffCount);
  const m = (minor: number) => formatMoney(minor, CURRENCY);

  // With a live subscription, ask Stripe what's on it (any discount, and its trial).
  let sub: StripeSubscription | null = null;
  let stripeProblem = "";
  if (live && stripeOn) {
    try {
      sub = await stripe<StripeSubscription>("GET", `subscriptions/${agency.stripeSubscriptionId}`);
    } catch (e) {
      stripeProblem = e instanceof StripeError ? e.message : "Couldn't reach Stripe just now.";
    }
  }
  const planItem = sub?.items.data.map((i) => parseLookupKey(i.price.lookup_key)).find((k) => k && k.kind !== "EXTRA_USER");
  const paying = planItem ? planItem.amountMinor : null;
  const codes =
    agency.billingMode === "STRIPE" && live && stripeOn
      ? (await prisma.discountCode.findMany({ where: { active: true }, orderBy: { code: "asc" } })).filter(
          (c) => !c.planKeys.length || (agency.plan && c.planKeys.includes(agency.plan)),
        )
      : [];

  return (
    <>
      <SettingsSection id="plan" title="Plan" description="How this business pays for Gigsaw.">
        {/* Where they stand now, like a channel strip's readout. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-card)] bg-ink-950 px-5 py-4 text-white">
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[10.5px] tracking-[0.12em] text-white/50 uppercase">Now</span>
            <span className="mt-1 block text-[17px] font-semibold">
              {billing.mode === "FREE"
                ? "Free account"
                : billing.mode === "INVOICE"
                  ? `${formatMoney(agency.pricePerGigMinor, agency.billingCurrency)} per booking, by invoice`
                  : `${current?.name ?? agency.plan ?? "No plan"}, ${agency.billingInterval === "year" ? "yearly" : "monthly"}`}
            </span>
            {billing.mode === "STRIPE" && current && (
              <span className="block text-sm text-white/60">
                {paying !== null
                  ? `${m(paying)} a ${agency.billingInterval === "year" ? "year" : "month"} on their subscription${
                      paying !== (agency.billingInterval === "year" ? current.yearlyMinor : current.monthlyMinor) ? " (an older price)" : ""
                    }`
                  : `${m(agency.billingInterval === "year" ? current.yearlyMinor : current.monthlyMinor)} a ${agency.billingInterval === "year" ? "year" : "month"} at today's price`}
                {current.archived ? " · archived plan" : !current.public ? " · hidden plan" : ""}
              </span>
            )}
          </span>
          <Badge tone={billing.locked ? "red" : billing.mode === "STRIPE" && !billing.subscribed ? "amber" : "green"}>{billing.label}</Badge>
        </div>

        <ActionForm action={setAgencyPlan.bind(null, agency.id)} className="group/mode card card-pad space-y-5">
          <fieldset>
            <legend className="sr-only">How they pay</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-ink-200 p-3.5 transition-colors hover:border-ink-300 has-[:checked]:border-ink-950 has-[:checked]:ring-1 has-[:checked]:ring-ink-950"
                >
                  <input type="radio" name="mode" value={o.value} defaultChecked={mode === o.value} className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">{o.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{o.sub}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* A plan, by card */}
          <div className="hidden gap-4 group-has-[[name=mode][value=PLAN]:checked]/mode:grid sm:grid-cols-3">
            <Field label="Plan">
              <select name="plan" defaultValue={current?.key ?? options.find((p) => p.public)?.key} className="input">
                {options.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                    {p.archived ? " (archived)" : !p.public ? " (hidden)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid">
              <select name="interval" defaultValue={agency.billingInterval} className="input">
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </Field>
            <Field
              label="Free trial ends"
              hint={
                trialOpen
                  ? agency.billingMode === "STRIPE"
                    ? "Leave as it is to keep it"
                    : `Leave blank for ${catalogue.trialDays} days from today`
                  : "Their trial is over and they're paying"
              }
            >
              <input
                name="trialEndsAt"
                type="date"
                disabled={!trialOpen && agency.billingMode === "STRIPE"}
                defaultValue={agency.billingMode === "STRIPE" ? dateOnly(agency.trialEndsAt) : ""}
                className="input"
              />
            </Field>
            <p className="text-sm text-ink-500 sm:col-span-3">
              {live
                ? "They have a card subscription, so a change goes to Stripe straight away and their next bill is adjusted for the days left."
                : "They haven't added a card yet. They'll be asked to when the trial ends, and pay today's price for the plan."}
            </p>
          </div>

          {/* Custom, by invoice */}
          <div className="hidden gap-4 group-has-[[name=mode][value=CUSTOM]:checked]/mode:grid sm:grid-cols-2">
            <Field label="Price per booking">
              <input name="pricePerGig" inputMode="decimal" defaultValue={minorToInput(agency.pricePerGigMinor, agency.billingCurrency)} className="input" />
            </Field>
            <Field label="Currency">
              <select name="billingCurrency" defaultValue={agency.billingCurrency} className="input">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Internal users included" hint="Acts, venue managers and customers never count">
              <input name="includedUsers" inputMode="numeric" defaultValue={agency.includedUsers} className="input" />
            </Field>
            <Field
              label="Each extra internal user, per year"
              hint={
                seats.extra ? `${seats.extra} extra now: ${formatMoney(seats.monthlyMinor, agency.billingCurrency)} a month` : "Billed monthly at a twelfth"
              }
            >
              <input
                name="extraUserYearly"
                inputMode="decimal"
                defaultValue={minorToInput(agency.extraUserYearlyMinor, agency.billingCurrency)}
                placeholder="500.00"
                className="input"
              />
            </Field>
            <p className="text-sm text-ink-500 sm:col-span-2">
              A new price applies to statements you issue from now on. Statements already issued keep theirs.
            </p>
          </div>

          {/* Free account */}
          <p className="hidden text-sm text-ink-500 group-has-[[name=mode][value=FREE]:checked]/mode:block">
            Nothing to pay, no trial, and never locked. They don&apos;t get statements.
          </p>

          {live && (
            <label className="hidden items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 group-has-[[name=mode][value=CUSTOM]:checked]/mode:flex group-has-[[name=mode][value=FREE]:checked]/mode:flex">
              <input type="checkbox" name="cancelSubscription" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block font-medium">Cancel their card subscription</span>
                They pay by card at the moment. This stops it in Stripe today, so they&apos;re not charged again. There&apos;s no refund for time already paid
                for.
              </span>
            </label>
          )}

          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save plan</SubmitButton>
          </div>
        </ActionForm>

        {trialOpen && (
          <ActionForm action={adjustTrial.bind(null, agency.id)} className="mt-3 flex flex-wrap items-center gap-2 px-1">
            <span className="mr-auto text-sm text-ink-500">
              {agency.trialEndsAt
                ? agency.trialEndsAt.getTime() > Date.now()
                  ? `Free trial ends ${formatDate(agency.trialEndsAt, "Europe/London")}`
                  : `Free trial ended ${formatDate(agency.trialEndsAt, "Europe/London")}`
                : "No trial set"}
            </span>
            {["7", "14", "30"].map((d) => (
              <SubmitButton key={d} name="trial" value={d} className="btn btn-sm" pendingText="Saving…">
                Add {d} days
              </SubmitButton>
            ))}
            {agency.trialEndsAt && agency.trialEndsAt.getTime() > Date.now() && (
              <SubmitButton name="trial" value="end" className="btn btn-sm btn-danger" pendingText="Saving…">
                End trial today
              </SubmitButton>
            )}
          </ActionForm>
        )}

        {agency.stripeCustomerId && (
          <p className="mt-3 px-1 text-xs text-ink-500">
            Stripe customer{" "}
            <a href={`https://dashboard.stripe.com/customers/${agency.stripeCustomerId}`} target="_blank" rel="noreferrer" className="link">
              {agency.stripeCustomerId}
            </a>
            {agency.stripeSubscriptionId ? ` · subscription ${agency.stripeSubscriptionId}` : ""}
          </p>
        )}
      </SettingsSection>

      {agency.billingMode === "STRIPE" && (
        <SettingsSection id="discount" title="Discount" description="Money off their Gigsaw subscription, from one of your discount codes.">
          <div className="card card-pad space-y-4">
            {!stripeOn ? (
              <p className="text-sm text-ink-500">
                Discounts live in Stripe, and Stripe isn&apos;t connected yet.{" "}
                <Link href="/owner/stripe" className="link">
                  Connect Stripe
                </Link>
              </p>
            ) : !live ? (
              <p className="text-sm text-ink-500">
                Discounts go on a card subscription, and they haven&apos;t added a card yet. They can type a code when they do, or come back here once they
                have.
              </p>
            ) : stripeProblem ? (
              <p className="text-sm text-rose-700">Stripe didn&apos;t answer: {stripeProblem}</p>
            ) : (
              <>
                {sub?.discount ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-cue-500 shadow-[0_0_8px_var(--color-cue-400)]" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-medium text-ink-950">
                        {sub.discount.coupon.name || "Discount"}: {describeDiscount(fromStripeCoupon(sub.discount.coupon))}
                      </span>
                      {sub.discount.end && <span className="block text-ink-500">Ends {formatDate(new Date(sub.discount.end * 1000), "Europe/London")}</span>}
                    </span>
                    <ActionForm action={removeDiscount.bind(null, agency.id)}>
                      <SubmitButton className="btn btn-sm" pendingText="Removing…">
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <p className="text-sm text-ink-500">No discount at the moment.</p>
                )}
                {codes.length ? (
                  <ActionForm action={applyDiscount.bind(null, agency.id)} className="flex flex-wrap items-end gap-3 border-t border-ink-100 pt-4">
                    <Field label={sub?.discount ? "Swap for" : "Apply a discount"} className="min-w-0 flex-1">
                      <select name="discount" className="input">
                        {codes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code}: {describeDiscount(c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <SubmitButton pendingText="Applying…">Apply</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="border-t border-ink-100 pt-4 text-sm text-ink-500">
                    No codes that fit their plan.{" "}
                    <Link href="/owner/discounts" className="link">
                      Make one
                    </Link>
                  </p>
                )}
              </>
            )}
          </div>
        </SettingsSection>
      )}
    </>
  );
}
