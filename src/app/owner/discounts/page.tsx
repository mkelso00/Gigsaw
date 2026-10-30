import type { Metadata } from "next";
import { createDiscountCode, setDiscountCodeActive } from "@/actions/owner-discounts";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Badge, SettingsSection } from "@/components/settings-ui";
import { Empty, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { codeStatus, describeDiscount } from "@/lib/discounts";
import { allPlans } from "@/lib/plan-store";
import { findPlan } from "@/lib/plans";
import { stripe, stripeConfigured, StripeError } from "@/lib/stripe";
import { formatDate } from "@/lib/time";
import { OwnerNote, StripeNotice } from "../stripe-notice";

export const metadata: Metadata = { title: "Discount codes" };
export const dynamic = "force-dynamic";

// Discount codes customers type when they add their card (Stripe Checkout), made here as a Stripe
// coupon and promotion code. How many times each has been used is read from Stripe.

type StripePromo = { id: string; active: boolean; times_redeemed: number };

export default async function OwnerDiscountsPage() {
  await requireOwner();
  const [codes, plans, stripeOn] = await Promise.all([prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } }), allPlans(), stripeConfigured()]);

  // One call for every code's use count and whether Stripe still has it switched on.
  const fromStripe = new Map<string, StripePromo>();
  let problem = "";
  if (stripeOn && codes.length) {
    try {
      const list = await stripe<{ data: StripePromo[] }>("GET", "promotion_codes", { limit: 100 });
      for (const p of list.data) fromStripe.set(p.id, p);
    } catch (e) {
      problem = e instanceof StripeError ? e.message : "Couldn't reach Stripe just now.";
    }
  }
  const choosable = plans.filter((p) => !p.archived);

  return (
    <div className="mx-auto max-w-[880px] pb-16">
      <PageHeader
        title="Discount codes"
        subtitle="Codes businesses type when they add their card, like LAUNCH20. You can also put a discount straight onto one business from its page."
      />

      {!stripeOn ? (
        <StripeNotice>Discount codes live in Stripe, and Stripe isn&apos;t connected yet.</StripeNotice>
      ) : (
        <OwnerNote>
          Customers see an <em>Add promotion code</em> link when they add their card. A code takes money off their Gigsaw subscription; it doesn&apos;t change
          the plan prices.
        </OwnerNote>
      )}

      <div className="space-y-10">
        <SettingsSection title="Codes" description={problem ? `Stripe didn't answer (${problem}), so use counts aren't shown.` : undefined}>
          {codes.length === 0 ? (
            <Empty>No codes yet.</Empty>
          ) : (
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {codes.map((c) => {
                const s = fromStripe.get(c.stripePromotionCodeId);
                const used = s?.times_redeemed ?? 0;
                const status = codeStatus(c, used, s ? s.active : null);
                return (
                  <div key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[15px] font-semibold tracking-[0.06em] text-ink-950">{c.code}</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-700">{describeDiscount(c)}</span>
                      <span className="mt-1 block text-xs text-ink-500">
                        {c.planKeys.length ? `Only ${c.planKeys.map((k) => findPlan(plans, k)?.name ?? k).join(", ")}` : "Every plan"}
                        {c.expiresAt ? ` · last day ${formatDate(c.expiresAt, "Europe/London")}` : " · no end date"}
                        {` · made ${formatDate(c.createdAt, "Europe/London")}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-[10.5px] tracking-[0.12em] text-ink-400 uppercase">Used</span>
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {s || !stripeOn ? used : "?"}
                        {c.maxRedemptions ? <span className="font-normal text-ink-500"> of {c.maxRedemptions}</span> : null}
                      </span>
                    </span>
                    {stripeOn && (
                      <ActionForm action={setDiscountCodeActive.bind(null, c.id, !c.active)} className="w-full sm:w-auto">
                        <SubmitButton className="btn btn-sm" pendingText="Saving…">
                          {c.active ? "Switch off" : "Switch on"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>

        {stripeOn && (
          <SettingsSection title="Make a code" description="It's made in Stripe straight away.">
            <ActionForm action={createDiscountCode} className="card card-pad grid gap-4 sm:grid-cols-2">
              <Field label="Code" hint="Letters and numbers, no spaces. Customers can type it in capitals or not.">
                <input name="code" required maxLength={30} placeholder="LAUNCH20" autoComplete="off" spellCheck={false} className="input font-mono uppercase" />
              </Field>
              <div className="group/kind">
                <span className="label">How much off</span>
                <div className="flex gap-2">
                  <label className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-200 text-sm has-[:checked]:border-ink-950 has-[:checked]:bg-ink-950 has-[:checked]:text-white">
                    <input type="radio" name="kind" value="percent" defaultChecked className="sr-only" />
                    Percent
                  </label>
                  <label className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-200 text-sm has-[:checked]:border-ink-950 has-[:checked]:bg-ink-950 has-[:checked]:text-white">
                    <input type="radio" name="kind" value="amount" className="sr-only" />
                    Pounds
                  </label>
                </div>
                <div className="mt-2 group-has-[[value=amount]:checked]/kind:hidden">
                  <span className="relative block">
                    <input name="percent" inputMode="decimal" placeholder="20" aria-label="Percent off" className="input pr-8 tabular-nums" />
                    <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-ink-500">%</span>
                  </span>
                </div>
                <div className="mt-2 hidden group-has-[[value=amount]:checked]/kind:block">
                  <span className="relative block">
                    <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-ink-500">£</span>
                    <input name="amount" inputMode="decimal" placeholder="10" aria-label="Pounds off" className="input pl-7 tabular-nums" />
                  </span>
                  <span className="hint block">Off each payment it covers, monthly or yearly</span>
                </div>
              </div>
              <div className="group/dur grid gap-4 sm:col-span-2 sm:grid-cols-2">
                <Field label="How long it lasts">
                  <select name="duration" defaultValue="once" className="input">
                    <option value="once">The first payment only</option>
                    <option value="repeating">A number of months</option>
                    <option value="forever">For as long as they&apos;re subscribed</option>
                  </select>
                </Field>
                <div className="hidden group-has-[option[value=repeating]:checked]/dur:block">
                  <Field label="Months" hint="On a yearly plan, it covers any yearly payment in that time">
                    <input name="months" inputMode="numeric" placeholder="3" className="input" />
                  </Field>
                </div>
              </div>
              <Field label="Last day it can be used" hint="Optional">
                <input name="expires" type="date" className="input" />
              </Field>
              <Field label="Most times it can be used" hint="Optional. Leave blank for no limit.">
                <input name="maxRedemptions" inputMode="numeric" placeholder="No limit" className="input" />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="label">Plans</legend>
                <p className="-mt-1 mb-2 text-xs text-ink-500">Leave all unticked for every plan.</p>
                <div className="flex flex-wrap gap-2">
                  {choosable.map((p) => (
                    <label
                      key={p.key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm has-[:checked]:border-ink-950"
                    >
                      <input type="checkbox" name="plans" value={p.key} />
                      {p.name}
                      {!p.public && <span className="text-xs text-ink-500">(hidden)</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end sm:col-span-2">
                <SubmitButton pendingText="Making it in Stripe…">
                  <Icon name="plus" className="h-4 w-4" />
                  Make code
                </SubmitButton>
              </div>
            </ActionForm>
          </SettingsSection>
        )}
      </div>
    </div>
  );
}
