import type { Metadata } from "next";
import Link from "next/link";
import { createPlan, deletePlan, moveSubscribersToCurrentPrices, saveBillingSettings, savePlan, setPlanArchived } from "@/actions/owner-plans";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Badge, SettingsSection } from "@/components/settings-ui";
import { Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney, minorToInput } from "@/lib/money";
import { loadCatalogue } from "@/lib/plan-store";
import { CURRENCY, featuredPlan, monthsFree, type Plan } from "@/lib/plans";
import { stripeConfigured } from "@/lib/stripe";
import { OwnerNote, StripeNotice } from "../stripe-notice";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

// The owner edits Gigsaw's plans here: prices, bookings a month, users included, what the website
// says about each, whether it's shown, and archiving. Plus the trial and extra-user prices.

const m = (minor: number) => formatMoney(minor, CURRENCY);

export default async function OwnerPlansPage() {
  await requireOwner();
  const [catalogue, onPlan, paying, stripeOn] = await Promise.all([
    loadCatalogue(),
    prisma.agency.groupBy({ by: ["plan"], where: { plan: { not: null } }, _count: { _all: true } }),
    prisma.agency.groupBy({
      by: ["plan"],
      where: { billingMode: "STRIPE", stripeSubscriptionId: { not: null }, subscriptionStatus: { not: "CANCELED" } },
      _count: { _all: true },
    }),
    stripeConfigured(),
  ]);
  const count = (rows: { plan: string | null; _count: { _all: number } }[], key: string) => rows.find((r) => r.plan === key)?._count._all ?? 0;
  const featured = featuredPlan(catalogue.plans)?.key;
  const payingTotal = paying.reduce((n, r) => n + r._count._all, 0);
  const live = catalogue.plans.filter((p) => !p.archived);
  const archived = catalogue.plans.filter((p) => p.archived);

  return (
    <div className="mx-auto max-w-[880px] pb-16">
      <PageHeader
        title="Plans"
        subtitle="What businesses pay to use Gigsaw. Plans shown on the website appear on the pricing page, at sign-up and in Settings > Plan."
      />

      {!stripeOn && <StripeNotice>Stripe isn&apos;t connected, so nobody can pay by card yet. You can still set up the plans.</StripeNotice>}

      <OwnerNote>
        <strong className="font-semibold">Price changes apply to new subscriptions.</strong> Businesses already paying by card keep the price they signed up at.
        To charge them the new price, use <em>Move to today&apos;s prices</em>: it starts from their next bill, with no extra charge or refund for time
        they&apos;ve already paid for.
      </OwnerNote>

      <div className="space-y-10">
        <SettingsSection title="Plans" description="In the order they're shown. Lower numbers come first.">
          <div className="space-y-3">
            {live.map((p) => (
              <PlanCard
                key={p.key}
                plan={p}
                featured={p.key === featured}
                businesses={count(onPlan, p.key)}
                paying={count(paying, p.key)}
                stripeOn={stripeOn}
              />
            ))}
          </div>
          <details className="group mt-3">
            <summary className="card flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-medium text-ink-700 hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-500">
                <Icon name="plus" className="h-4 w-4" />
              </span>
              Add a plan
            </summary>
            <ActionForm action={createPlan} className="card motion-page-in mt-2 p-5">
              <PlanFields keyField />
              <div className="mt-5 flex justify-end">
                <SubmitButton pendingText="Adding…">Add plan</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </SettingsSection>

        {archived.length > 0 && (
          <SettingsSection title="Archived" description="Can't be chosen any more. Businesses already on one keep it.">
            <div className="space-y-3">
              {archived.map((p) => (
                <PlanCard key={p.key} plan={p} featured={false} businesses={count(onPlan, p.key)} paying={count(paying, p.key)} stripeOn={stripeOn} />
              ))}
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="For every plan" description="The free trial for new sign-ups, and what each internal user over a plan's allowance costs.">
          <ActionForm action={saveBillingSettings} className="card card-pad grid gap-4 sm:grid-cols-3">
            <Field label="Free trial, in days" hint="For businesses that sign up from now on">
              <input name="trialDays" inputMode="numeric" required defaultValue={catalogue.trialDays} className="input" />
            </Field>
            <Field label="Extra user, a month" hint="On monthly plans">
              <PoundInput name="extraMonthly" minor={catalogue.extraUserMonthlyMinor} />
            </Field>
            <Field label="Extra user, a year" hint="On yearly plans">
              <PoundInput name="extraYearly" minor={catalogue.extraUserYearlyMinor} />
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-3">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
          {stripeOn && payingTotal > 0 && (
            <ActionForm action={moveSubscribersToCurrentPrices.bind(null, "")} className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <p className="text-sm text-ink-500">
                {payingTotal} business{payingTotal === 1 ? " pays" : "es pay"} by card. Move them all to today&apos;s plan and extra-user prices.
              </p>
              <SubmitButton className="btn btn-sm" pendingText="Moving…">
                Move everyone to today&apos;s prices
              </SubmitButton>
            </ActionForm>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}

function PlanCard({
  plan: p,
  featured,
  businesses,
  paying,
  stripeOn,
}: {
  plan: Plan;
  featured: boolean;
  businesses: number;
  paying: number;
  stripeOn: boolean;
}) {
  const free = monthsFree(p);
  return (
    <div className={`card overflow-hidden ${p.archived ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink-950">{p.name}</span>
            <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-400 uppercase">{p.key}</span>
            {p.archived ? <Badge>Archived</Badge> : p.public ? <Badge tone="green">On the website</Badge> : <Badge tone="amber">Hidden</Badge>}
            {featured && <Badge>Suggested first</Badge>}
          </span>
          {p.tagline && <span className="mt-0.5 block text-sm text-ink-500">{p.tagline}</span>}
          <span className="mt-2 block text-sm text-ink-700">
            {p.gigsPerMonth === null ? "Unlimited bookings" : `Up to ${p.gigsPerMonth} bookings a month`} · {p.includedUsers} internal user
            {p.includedUsers === 1 ? "" : "s"} included
          </span>
        </span>
        <span className="text-right">
          <span className="block font-mono text-[18px] font-semibold tabular-nums">
            {m(p.monthlyMinor)}
            <span className="text-xs font-normal text-ink-500"> /month</span>
          </span>
          <span className="block text-xs text-ink-500">
            {m(p.yearlyMinor)} a year{free ? `, ${free} month${free === 1 ? "" : "s"} free` : ""}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-100 bg-ink-50/60 px-5 py-2.5">
        <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">
          <span
            className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${businesses ? "bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" : "bg-ink-300"}`}
          />
          {businesses} business{businesses === 1 ? "" : "es"}
          {paying ? ` · ${paying} paying by card` : ""}
        </span>
        {businesses > 0 && (
          <Link href={`/owner?plan=${p.key}`} className="text-xs text-ink-500 hover:text-ink-950">
            See them
          </Link>
        )}
      </div>
      <details className="group border-t border-ink-100">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-ink-700 hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
          <Icon name="chevron" className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-90" />
          Edit, hide or archive
        </summary>
        <div className="motion-page-in space-y-5 border-t border-ink-100 px-5 py-5">
          <ActionForm action={savePlan.bind(null, p.key)}>
            <PlanFields plan={p} />
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <p className="mr-auto text-xs text-ink-500">A new price is for new subscriptions. Businesses already paying keep theirs until you move them.</p>
              <SubmitButton>Save {p.name}</SubmitButton>
            </div>
          </ActionForm>
          <div className="flex flex-wrap items-start gap-2 border-t border-ink-100 pt-4">
            {stripeOn && paying > 0 && (
              <ActionForm action={moveSubscribersToCurrentPrices.bind(null, p.key)}>
                <SubmitButton className="btn btn-sm" pendingText="Moving…">
                  Move {paying} to today&apos;s prices
                </SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={setPlanArchived.bind(null, p.key, !p.archived)}>
              <SubmitButton className="btn btn-sm" pendingText="Saving…">
                {p.archived ? "Bring back" : "Archive"}
              </SubmitButton>
            </ActionForm>
            {businesses === 0 ? (
              <ActionForm action={deletePlan.bind(null, p.key)}>
                <ConfirmButton className="btn btn-sm btn-danger" message={`Delete ${p.name}? This can't be undone.`}>
                  Delete
                </ConfirmButton>
              </ActionForm>
            ) : (
              <p className="self-center text-xs text-ink-500">Can&apos;t be deleted while businesses are on it.</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function PoundInput({ name, minor, placeholder }: { name: string; minor?: number; placeholder?: string }) {
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-ink-500">£</span>
      <input
        name={name}
        inputMode="decimal"
        required
        defaultValue={minor === undefined ? "" : minorToInput(minor, CURRENCY)}
        placeholder={placeholder}
        className="input pl-7 tabular-nums"
      />
    </span>
  );
}

function PlanFields({ plan, keyField = false }: { plan?: Plan; keyField?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name">
        <input name="name" required maxLength={40} defaultValue={plan?.name} placeholder="e.g. Pro" className="input" />
      </Field>
      {keyField ? (
        <Field label="Key" hint="Optional. Made from the name if left blank, e.g. PRO. Can't be changed later.">
          <input name="key" maxLength={30} placeholder="PRO" className="input font-mono uppercase" autoComplete="off" spellCheck={false} />
        </Field>
      ) : (
        <Field label="Order" hint="Lower numbers are shown first">
          <input name="sortOrder" inputMode="numeric" defaultValue={plan?.sortOrder ?? 0} className="input" />
        </Field>
      )}
      <Field label="One line about it" className="sm:col-span-2">
        <input name="tagline" maxLength={80} defaultValue={plan?.tagline} placeholder="For busy bar circuits and wedding work" className="input" />
      </Field>
      <Field label="Price a month">
        <PoundInput name="monthly" minor={plan?.monthlyMinor} placeholder="99" />
      </Field>
      <Field label="Price a year" hint="Ten times the monthly price gives two months free">
        <PoundInput name="yearly" minor={plan?.yearlyMinor} placeholder="990" />
      </Field>
      <Field label="Bookings a month" hint="Leave blank for unlimited">
        <input name="bookings" inputMode="numeric" defaultValue={plan?.gigsPerMonth ?? ""} placeholder="Unlimited" className="input" />
      </Field>
      <Field label="Internal users included">
        <input name="includedUsers" inputMode="numeric" required defaultValue={plan?.includedUsers ?? 2} className="input" />
      </Field>
      <Field label="What's included" hint="One per line. Shown as ticks on the pricing page." className="sm:col-span-2">
        <textarea name="highlights" rows={4} defaultValue={plan?.highlights.join("\n")} className="input" />
      </Field>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink-200 px-4 py-3 sm:col-span-2">
        <span>
          <span className="block text-sm font-medium text-ink-950">Show on the website</span>
          <span className="mt-0.5 block text-sm text-ink-500">Off: hidden from the website and sign-up. You can still put a business on it from its page.</span>
        </span>
        <input type="checkbox" name="public" defaultChecked={plan ? plan.public : true} className="switch mt-0.5" />
      </label>
    </div>
  );
}
