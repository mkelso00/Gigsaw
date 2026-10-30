import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addAgencyAdmin, resendWelcome, resetUserPassword, setStatementPaid, updateAgency } from "@/actions/owner";
import { ActionForm, SubmitButton } from "@/components/forms";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, SettingsCard, SettingsSection } from "@/components/settings-ui";
import { Field, Stat } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { monthLabel, shiftMonth } from "@/lib/billing";
import { CURRENCIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatMoney, minorToInput } from "@/lib/money";
import { userCharge } from "@/lib/seats";
import { billingState } from "@/lib/subscription";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Business" };
export const dynamic = "force-dynamic";

export default async function OwnerAgencyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireOwner();
  const { id } = await params;
  const { created } = await searchParams;
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      users: { where: { demo: false }, orderBy: [{ role: "asc" }, { name: "asc" }] },
      statements: { orderBy: { month: "desc" }, take: 24 },
      _count: { select: { artists: true, venues: true, contacts: true, bookings: true } },
    },
  });
  if (!agency) notFound();

  // Usage for the last six months, newest first.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, -i));
  const usage = await Promise.all(months.map((m) => usageForMonth(m, agency.id).then((u) => u.get(agency.id)?.count ?? 0)));
  const money = (m: number) => formatMoney(m, agency.billingCurrency);
  const staff = agency.users.filter((u) => u.role !== "ARTIST");
  const artists = agency.users.filter((u) => u.role === "ARTIST");
  const seats = userCharge(agency, staff.length);
  const billing = billingState(agency);

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="mx-auto max-w-[880px]">
      <Link href="/owner" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950">
        <Icon name="back" className="h-4 w-4" />
        Businesses
      </Link>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.015em]">{agency.name}</h1>
        <span className={`badge ${agency.status === "ACTIVE" ? "bg-volt-100 text-volt-700" : "bg-rose-100 text-rose-800"}`}>
          {agency.status === "ACTIVE" ? "Active" : "Suspended"}
        </span>
        <p className="w-full text-[15px] text-ink-500">
          {billing.mode === "STRIPE" ? billing.label : `${money(agency.pricePerGigMinor)} per gig, by invoice`} · {agency._count.bookings} bookings ·{" "}
          {agency._count.artists} acts
        </p>
      </div>

      {created && (
        <div className="mb-8 flex items-start gap-3 rounded-[var(--radius-card)] border border-volt-200 bg-volt-100 px-5 py-4 text-sm text-ink-900">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-volt-500" />
          Business created. If you ticked the welcome email, the admin has a link to set their password and sign in.
        </div>
      )}

      <div className="space-y-10">
        <SettingsSection title="Usage" description="Billable gigs and what they come to, with internal users included.">
          <div className="grid grid-cols-3 gap-3">
            {usage.slice(0, 3).map((n, i) => (
              <Stat key={months[i]} label={monthLabel(months[i])} value={n} hint={money(n * agency.pricePerGigMinor + seats.monthlyMinor)} />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title="Internal users" description="Admins and agents who sign in to this business.">
          <SettingsCard>
            {staff.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-xs font-semibold text-volt-300">
                  {initials(u.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {u.name}
                    <Badge>{u.role === "ADMIN" ? "Admin" : "Agent"}</Badge>
                    {u.isOwner && <Badge tone="green">Owner</Badge>}
                    {!u.passwordHash && <Badge tone="amber">Hasn&apos;t set a password</Badge>}
                  </span>
                  <span className="block truncate text-sm text-ink-500">{u.email}</span>
                </span>
                {!u.isOwner && (
                  <div className="flex w-full items-center gap-2 pl-[52px] sm:w-auto sm:pl-0">
                    <form action={resendWelcome.bind(null, u.id)}>
                      <button className="btn btn-sm">Resend welcome</button>
                    </form>
                    <details className="relative">
                      <summary className="btn btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">Set password</summary>
                      <ActionForm
                        action={resetUserPassword.bind(null, u.id)}
                        className="motion-page-in absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-ink-200 bg-white p-4 shadow-xl"
                      >
                        <Field label="New password" hint="At least 8 characters. Signs them out everywhere.">
                          <input name="password" type="text" minLength={8} required autoComplete="off" className="input" />
                        </Field>
                        <SubmitButton className="btn btn-primary w-full">Set password</SubmitButton>
                      </ActionForm>
                    </details>
                  </div>
                )}
              </div>
            ))}
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-medium text-ink-700 hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-500">
                  <Icon name="plus" className="h-4 w-4" />
                </span>
                Add an admin
              </summary>
              <ActionForm action={addAgencyAdmin.bind(null, agency.id)} className="motion-page-in grid gap-4 border-t border-ink-100 px-5 py-5 sm:grid-cols-2">
                <Field label="Name">
                  <input name="name" required className="input" />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" required className="input" />
                </Field>
                <Field label="Password" hint="Optional. Leave blank and they set their own from the welcome email." className="sm:col-span-2">
                  <input name="password" type="text" minLength={8} autoComplete="off" className="input" />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <SubmitButton pendingText="Adding…">Add and send welcome</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </SettingsCard>
          {artists.length > 0 && (
            <p className="mt-2 text-xs text-ink-500">
              Plus {artists.length} act app login{artists.length === 1 ? "" : "s"}, which are always free.
            </p>
          )}
        </SettingsSection>

        <ActionForm action={updateAgency.bind(null, agency.id)} saveBar className="space-y-10">
          <SettingsSection title="Business">
            <div className="card card-pad grid gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <input name="name" required defaultValue={agency.name} className="input" />
              </Field>
              <Field label="Status" hint="Suspended businesses can't sign in. Their data is kept.">
                <select name="status" defaultValue={agency.status} className="input">
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </Field>
              <Field label="Billing email" hint="Where statements go" className="sm:col-span-2">
                <input name="billingEmail" type="email" defaultValue={agency.billingEmail} className="input" />
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection title="Price" description="A new price applies to statements you issue from now on. Statements already issued keep theirs.">
            <div className="card card-pad grid gap-4 sm:grid-cols-2">
              <Field label="How they pay" hint={billing.mode === "STRIPE" ? billing.label : "You send statements from Billing"}>
                <select name="billingMode" defaultValue={agency.billingMode} className="input">
                  <option value="INVOICE">By invoice (per gig)</option>
                  <option value="STRIPE">By card (Stripe subscription)</option>
                </select>
              </Field>
              <Field label="Currency">
                <select name="billingCurrency" defaultValue={agency.billingCurrency} className="input">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price per gig">
                <input
                  name="pricePerGig"
                  inputMode="decimal"
                  required
                  defaultValue={minorToInput(agency.pricePerGigMinor, agency.billingCurrency)}
                  className="input"
                />
              </Field>
              <Field label="Internal users included" hint="Acts, venue managers and customers never count">
                <input name="includedUsers" inputMode="numeric" defaultValue={agency.includedUsers} className="input" />
              </Field>
              <Field
                label="Each extra internal user, per year"
                hint={seats.extra ? `${seats.extra} extra now: ${money(seats.monthlyMinor)} a month` : "Billed monthly at a twelfth"}
              >
                <input
                  name="extraUserYearly"
                  inputMode="decimal"
                  defaultValue={minorToInput(agency.extraUserYearlyMinor, agency.billingCurrency)}
                  placeholder="500.00"
                  className="input"
                />
              </Field>
              <Field
                label="Free trial ends"
                hint={agency.plan ? `Plan: ${agency.plan.toLowerCase()}, ${agency.billingInterval}ly` : "Card-paying businesses only"}
              >
                <input
                  name="trialEndsAt"
                  type="date"
                  defaultValue={agency.trialEndsAt ? agency.trialEndsAt.toISOString().slice(0, 10) : ""}
                  className="input"
                />
              </Field>
              {agency.stripeCustomerId && (
                <p className="text-xs text-ink-500 sm:col-span-2">
                  Stripe customer{" "}
                  <a href={`https://dashboard.stripe.com/customers/${agency.stripeCustomerId}`} target="_blank" rel="noreferrer" className="link">
                    {agency.stripeCustomerId}
                  </a>
                  {agency.stripeSubscriptionId ? ` · subscription ${agency.stripeSubscriptionId}` : ""}
                </p>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title="Private notes" description="Only owners see these.">
            <SettingsCard pad>
              <textarea name="ownerNotes" rows={3} defaultValue={agency.ownerNotes} aria-label="Private notes" className="input" />
            </SettingsCard>
          </SettingsSection>
        </ActionForm>

        <SettingsSection title="Statements" description="Issued from Billing once a month is over.">
          {agency.statements.length === 0 ? (
            <SettingsCard pad>
              <p className="text-sm text-ink-500">None yet.</p>
            </SettingsCard>
          ) : (
            <SettingsCard>
              {agency.statements.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-sm">
                  <span className="w-32 font-medium">{monthLabel(s.month)}</span>
                  <span className="flex-1 text-ink-500">
                    {s.gigCount} gig{s.gigCount === 1 ? "" : "s"} at {formatMoney(s.pricePerGigMinor, s.currency)}
                    {s.extraUsers ? ` + ${s.extraUsers} extra user${s.extraUsers === 1 ? "" : "s"}` : ""}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{formatMoney(s.amountMinor, s.currency)}</span>
                  <Badge tone={s.status === "PAID" ? "green" : "amber"}>{s.status === "PAID" ? "Paid" : "Unpaid"}</Badge>
                  <form action={setStatementPaid.bind(null, s.id, s.status !== "PAID")}>
                    <button className="btn btn-sm">{s.status === "PAID" ? "Mark unpaid" : "Mark paid"}</button>
                  </form>
                </div>
              ))}
            </SettingsCard>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}
