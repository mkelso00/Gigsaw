import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import {
  changePassword,
  clearDemoData,
  createStaffUser,
  loadDemoData,
  removeStaffUser,
  saveSettings,
  sendTestMessage,
  updateMyDetails,
} from "@/actions/settings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { MessageList } from "@/components/message-list";
import { Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { monthLabel, unresolvedPastWhere } from "@/lib/billing";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { emailConfigured, smsConfigured } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked: boolean; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-4 hover:border-ink-300">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-ink-950" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-500">{hint}</span>
      </span>
    </label>
  );
}

export default async function SettingsPage() {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const month = new Date().toISOString().slice(0, 7);
  const [settings, team, demoBookings, messages, unresolved, usage] = await Promise.all([
    getSettings(user.agencyId),
    prisma.user.findMany({ where: { agencyId: user.agencyId, role: { in: ["ADMIN", "AGENT"] }, demo: false }, orderBy: { name: "asc" } }),
    prisma.booking.count({ where: { agencyId: user.agencyId, demo: true } }),
    isAdmin ? prisma.message.findMany({ where: { agencyId: user.agencyId }, orderBy: { createdAt: "desc" }, take: 15 }) : [],
    prisma.booking.count({ where: { agencyId: user.agencyId, ...unresolvedPastWhere() } }),
    isAdmin ? usageForMonth(month, user.agencyId) : new Map(),
  ]);
  const gigsThisMonth = usage.get(user.agencyId)?.count ?? 0;
  const agency = user.agency!;
  const price = (m: number) => formatMoney(m, agency.billingCurrency);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={isAdmin ? "Settings" : "My account"}
        actions={
          <form action={logout}>
            <button className="btn">Sign out</button>
          </form>
        }
      />

      {isAdmin && (
        <section className="rounded-[var(--radius-card)] bg-ink-950 p-6 text-white">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[13px] text-white/60">Your Gigsaw plan</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">
                {price(agency.pricePerGigMinor)} <span className="text-base font-normal text-white/60">per gig</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-white/60">{monthLabel(month)} so far</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-volt-400 tabular-nums">{price(gigsThisMonth * agency.pricePerGigMinor)}</div>
              <div className="text-xs text-white/60">
                {gigsThisMonth} billable gig{gigsThisMonth === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/60">
            A gig counts when it&apos;s confirmed or settled, when the artist checks in, or when it&apos;s still on hold or pending after its date.
            Cancelled gigs, enquiries and demo data are free.
          </p>
          {unresolved > 0 && (
            <p className="mt-3 text-sm">
              <span className="badge mr-2 bg-amber-400 text-ink-950">{unresolved}</span>
              past gig{unresolved === 1 ? " was" : "s were"} never confirmed or cancelled.{" "}
              <Link href="/bookings?status=UNRESOLVED&when=all" className="text-volt-400 underline underline-offset-4">
                Tidy them up
              </Link>
            </p>
          )}
        </section>
      )}

      <ActionForm action={updateMyDetails} className="card card-pad space-y-4">
        <h2 className="section-title">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input name="name" required defaultValue={user.name} className="input" />
          </Field>
          <Field label="Mobile number" hint="We text this number if one of your artists is late for a gig">
            <input name="phone" type="tel" defaultValue={user.phone} placeholder="07700 900000" className="input" />
          </Field>
        </div>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>

      {isAdmin && (
        <ActionForm action={saveSettings} className="card card-pad space-y-5">
          <h2 className="section-title">Agency</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name">
              <input name="agencyName" required defaultValue={settings.agencyName} className="input" />
            </Field>
            <Field label="Agency email">
              <input name="agencyEmail" type="email" defaultValue={settings.agencyEmail} className="input" />
            </Field>
            <Field label="Address" hint="Printed on contracts and invoices" className="sm:col-span-2">
              <textarea name="agencyAddress" rows={2} defaultValue={settings.agencyAddress} className="input" />
            </Field>
            <Field label="Home time zone">
              <select name="defaultTimezone" defaultValue={settings.defaultTimezone} className="input">
                {TIMEZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </Field>
            <Field label="Default currency">
              <select name="defaultCurrency" defaultValue={settings.defaultCurrency} className="input">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Default commission %">
              <input name="defaultCommission" inputMode="decimal" defaultValue={settings.defaultCommission} className="input" />
            </Field>
          </div>

          <div className="border-t border-ink-100 pt-5">
            <h2 className="section-title mb-4">Arrival tracking and alerts</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grace period (minutes)" hint="An arrival this many minutes after call time still counts as on time">
                <input name="lateGraceMinutes" inputMode="numeric" defaultValue={settings.lateGraceMinutes} className="input" />
              </Field>
              <Field label="Venue radius (metres)" hint="A check-in within this distance of the venue's map pin counts as verified">
                <input name="geofenceMetres" inputMode="numeric" defaultValue={settings.geofenceMetres} className="input" />
              </Field>
              <Field
                label="Changeover time between gigs (minutes)"
                hint="Time to pack down and get going, added to the travel estimate when checking an artist can make two gigs"
              >
                <input name="changeoverMinutes" inputMode="numeric" defaultValue={settings.changeoverMinutes} className="input" />
              </Field>
              <div />
              <Toggle
                name="overdueAlerts"
                defaultChecked={settings.overdueAlerts}
                label="Alert us when an artist is late"
                hint="Emails and texts the booking's agent once the call time passes with no check-in."
              />
              <Toggle
                name="clientArrivalMessages"
                defaultChecked={settings.clientArrivalMessages}
                label="Tell clients when the artist arrives"
                hint="Messages the booking's promoter or client. Can be switched off per booking."
              />
              <Field label="Also alert this email" hint="Optional on-call address, e.g. a shared inbox">
                <input name="alertEmail" type="email" defaultValue={settings.alertEmail} className="input" />
              </Field>
              <Field label="Also alert this mobile" hint="Optional on-call number">
                <input name="alertPhone" type="tel" defaultValue={settings.alertPhone} className="input" />
              </Field>
            </div>
          </div>

          <div className="border-t border-ink-100 pt-5">
            <h2 className="section-title mb-4">Documents</h2>
            <div className="space-y-4">
              <Field label="Contract terms" hint="Added to every contract">
                <textarea name="contractTerms" rows={5} defaultValue={settings.contractTerms} className="input" />
              </Field>
              <Field label="Invoice terms">
                <textarea name="invoiceTerms" rows={2} defaultValue={settings.invoiceTerms} className="input" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </ActionForm>
      )}

      {isAdmin && (
        <section className="card card-pad">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="section-title">Messages</h2>
              <p className="mt-1 text-sm text-ink-500">
                Email {emailConfigured() ? "is connected" : "isn't set up yet"} · Texts {smsConfigured() ? "are connected" : "aren't set up yet"}.
                {!emailConfigured() || !smsConfigured() ? " Until they are, messages are logged here but not sent." : ""}
              </p>
            </div>
            <ActionForm action={sendTestMessage}>
              <SubmitButton className="btn" pendingText="Sending…">
                Send me a test
              </SubmitButton>
            </ActionForm>
          </div>
          <MessageList messages={messages} timezone={settings.defaultTimezone} />
        </section>
      )}

      {isAdmin && (
        <section className="card card-pad">
          <h2 className="section-title mb-3">Team</h2>
          <ul className="mb-5 divide-y divide-ink-100 text-sm">
            {team.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <strong className="font-medium">{u.name}</strong>
                  <span className="text-ink-500">
                    {" "}
                    · {u.email} · {u.role === "ADMIN" ? "Admin" : "Agent"}
                    {u.phone ? ` · ${u.phone}` : " · no mobile"}
                  </span>
                </span>
                {u.id !== user.id && !u.isOwner && (
                  <form action={removeStaffUser.bind(null, u.id)}>
                    <ConfirmButton message={`Remove ${u.name}'s access?`} className="btn btn-sm btn-danger">
                      Remove
                    </ConfirmButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <ActionForm action={createStaffUser} className="grid gap-3 sm:grid-cols-6 sm:items-end">
            <Field label="Name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className="input" />
            </Field>
            <Field label="Mobile">
              <input name="phone" type="tel" className="input" />
            </Field>
            <Field label="Password">
              <input name="password" type="text" minLength={8} required className="input" autoComplete="off" />
            </Field>
            <Field label="Role">
              <select name="role" className="input">
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
          <p className="hint mt-3">Admins can change settings and manage the team. Agents can do everything else. Artist logins are made on each artist&apos;s page.</p>
        </section>
      )}

      {isAdmin && (
        <section className="card card-pad">
          <h2 className="section-title">Demo data</h2>
          {demoBookings > 0 ? (
            <>
              <p className="mt-1 mb-4 text-sm text-ink-500">
                Demo data is loaded ({demoBookings} bookings). Remove it before you start using Gigsaw for real. Only the demo artists, venues,
                contacts and bookings are removed, plus anything you added to a demo artist.
              </p>
              <ActionForm action={clearDemoData}>
                <ConfirmButton message="Remove all demo data? This can't be undone.">Remove demo data</ConfirmButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mt-1 mb-4 text-sm text-ink-500">
                Fill Gigsaw with sample artists, venues, promoters and about 80 bookings, including live arrivals for today, so you can see how
                everything works. It sits alongside your own data, is never billed or messaged, and can be removed in one click.
              </p>
              <ActionForm action={loadDemoData}>
                <SubmitButton pendingText="Loading demo data…">Load demo data</SubmitButton>
              </ActionForm>
            </>
          )}
        </section>
      )}

      <ActionForm action={changePassword} className="card card-pad space-y-4">
        <h2 className="section-title">Change your password</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password">
            <input name="current" type="password" required autoComplete="current-password" className="input" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input name="next" type="password" required minLength={8} autoComplete="new-password" className="input" />
          </Field>
        </div>
        <SubmitButton>Change password</SubmitButton>
      </ActionForm>
    </div>
  );
}
