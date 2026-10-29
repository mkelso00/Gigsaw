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
import { WEEKDAYS } from "@/lib/rota";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked: boolean; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink-200 bg-ink-50/40 p-4 transition-colors hover:border-ink-300">
      <span>
        <span className="block text-sm font-medium text-ink-950">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{hint}</span>
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="switch mt-0.5" />
    </label>
  );
}

/** One settings area: a title and short explanation, then its own card. */
function Section({
  id,
  title,
  description,
  children,
  className = "",
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink-950">{title}</h2>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
      </div>
      <div className={`card card-pad ${className}`}>{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const month = new Date().toISOString().slice(0, 7);
  const [settings, team, demoBookings, messages, unresolved, usage] = await Promise.all([
    getSettings(user.agencyId),
    prisma.user.findMany({
      where: {
        agencyId: user.agencyId,
        role: { in: ["ADMIN", "AGENT"] },
        demo: false,
      },
      orderBy: { name: "asc" },
    }),
    prisma.booking.count({ where: { agencyId: user.agencyId, demo: true } }),
    isAdmin
      ? prisma.message.findMany({
          where: { agencyId: user.agencyId },
          orderBy: { createdAt: "desc" },
          take: 15,
        })
      : [],
    prisma.booking.count({
      where: { agencyId: user.agencyId, ...unresolvedPastWhere() },
    }),
    isAdmin ? usageForMonth(month, user.agencyId) : new Map(),
  ]);
  const gigsThisMonth = usage.get(user.agencyId)?.count ?? 0;
  const agency = user.agency!;
  const price = (m: number) => formatMoney(m, agency.billingCurrency);
  const menu: [string, string][] = isAdmin
    ? [
        ["plan", "Your plan"],
        ["you", "Your details"],
        ["agency", "Agency"],
        ["arrivals", "Arrivals and alerts"],
        ["reminders", "Gig reminders"],
        ["weddings", "Weddings and events"],
        ["documents", "Documents"],
        ["messages", "Messages"],
        ["team", "Team"],
        ["demo", "Demo data"],
        ["password", "Password"],
      ]
    : [
        ["you", "Your details"],
        ["password", "Password"],
      ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={isAdmin ? "Settings" : "My account"}
        subtitle={isAdmin ? "How your agency works in Gigsaw: alerts, reminders, documents and your team." : undefined}
        actions={
          <form action={logout}>
            <button className="btn">Sign out</button>
          </form>
        }
      />
      <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        <nav className="no-print hidden lg:block" aria-label="Settings sections">
          <ul className="sticky top-6 space-y-0.5 text-sm">
            {menu.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-2 text-ink-600 transition-colors hover:bg-white hover:text-ink-950">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-10">
          {isAdmin && (
            <section id="plan" className="scroll-mt-6 rounded-[var(--radius-card)] bg-ink-950 p-6 text-white">
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

          <Section id="you" title="Your details" description="Your name, and the mobile we text if one of your acts is late.">
            <ActionForm action={updateMyDetails} className="space-y-4">
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
          </Section>

          {isAdmin && (
            <ActionForm action={saveSettings} className="space-y-10">
              <Section id="agency" title="Agency" description="Shown on emails, contracts and invoices.">
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
              </Section>

              <Section id="arrivals" title="Arrivals and alerts" description="When an arrival counts as on time, and who hears about it when an act is late.">
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
              </Section>

              <Section
                id="reminders"
                title="Gig reminders for acts"
                description="Sent as a phone notification (once they turn them on in their app) and by email. Anyone without phone notifications gets a text instead. Holds, pending and confirmed gigs are included; enquiries and cancelled gigs never are."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Toggle
                    name="weeklyReminders"
                    defaultChecked={settings.weeklyReminders}
                    label="Weekly list of gigs"
                    hint="Each artist gets their gigs for the coming Monday to Sunday."
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Day">
                      <select name="weeklyReminderDay" defaultValue={settings.weeklyReminderDay} className="input">
                        {WEEKDAYS.map(([n, , long]) => (
                          <option key={n} value={n}>
                            {long}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Time">
                      <input name="weeklyReminderTime" type="time" defaultValue={settings.weeklyReminderTime} className="input" />
                    </Field>
                  </div>
                  <Toggle
                    name="dayReminders"
                    defaultChecked={settings.dayReminders}
                    label="Reminder on the day"
                    hint="“Don’t forget your gig this evening”. For an afternoon gig it goes 3 hours before the call time instead."
                  />
                  <Field label="Time on the day" hint="Venue's local time">
                    <input name="dayReminderTime" type="time" defaultValue={settings.dayReminderTime} className="input" />
                  </Field>
                </div>
              </Section>

              <Section
                id="weddings"
                title="Weddings and events"
                description="Automatic emails for weddings and events: the planner link and a reminder to the customer, a balance reminder, final details to the acts a week before, and a thank-you afterwards."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Toggle
                    name="eventEmails"
                    defaultChecked={settings.eventEmails}
                    label="Send automatic wedding and event emails"
                    hint="Can also be turned off for a single event. Sent between 9am and 8pm."
                  />
                  <Field
                    label="Tell the customer when an act is confirmed"
                    hint="The act is always told. Bar gigs' venues aren't told: that's just for your records."
                  >
                    <select name="customerConfirmations" defaultValue={settings.customerConfirmations} className="input">
                      <option value="EVENTS">Weddings and private events only</option>
                      <option value="ALL">Every booking with a customer email</option>
                      <option value="OFF">Never</option>
                    </select>
                  </Field>
                  <Field label="Review link" hint="Added to the thank-you email, e.g. your Google or Facebook reviews page">
                    <input name="reviewLink" type="url" defaultValue={settings.reviewLink} placeholder="https://" className="input" />
                  </Field>
                </div>
              </Section>

              <Section id="documents" title="Documents" description="Wording added to every contract and invoice.">
                <div className="space-y-4">
                  <Field label="Contract terms" hint="Added to every contract">
                    <textarea name="contractTerms" rows={5} defaultValue={settings.contractTerms} className="input" />
                  </Field>
                  <Field label="Invoice terms">
                    <textarea name="invoiceTerms" rows={2} defaultValue={settings.invoiceTerms} className="input" />
                  </Field>
                </div>
              </Section>
              <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-ink-200 bg-white/90 px-5 py-3 shadow-lg shadow-ink-950/5 backdrop-blur">
                <span className="text-sm text-ink-500">Agency, arrivals, reminders and documents save together.</span>
                <SubmitButton className="btn btn-primary">Save settings</SubmitButton>
              </div>
            </ActionForm>
          )}

          {isAdmin && (
            <Section id="messages" title="Messages" description="Every email, text and phone notification Gigsaw has sent for you.">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-ink-500">
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
            </Section>
          )}

          {isAdmin && (
            <Section id="team" title="Team" description="Admins can change settings and manage the team. Agents can do everything else.">
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
              <h3 className="mb-3 text-sm font-medium text-ink-800">Add someone</h3>
              <ActionForm action={createStaffUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
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
                <SubmitButton className="btn btn-primary">Add to team</SubmitButton>
              </ActionForm>
              <p className="hint mt-3">Logins for acts are made on each act&apos;s page.</p>
            </Section>
          )}

          {isAdmin && (
            <Section id="demo" title="Demo data" description="Sample acts, venues and bookings for trying things out.">
              {demoBookings > 0 ? (
                <>
                  <p className="mb-4 text-sm text-ink-500">
                    Demo data is loaded ({demoBookings} bookings). Remove it before you start using Gigsaw for real. Only the demo artists, venues, contacts and
                    bookings are removed, plus anything you added to a demo artist.
                  </p>
                  <ActionForm action={clearDemoData}>
                    <ConfirmButton message="Remove all demo data? This can't be undone.">Remove demo data</ConfirmButton>
                  </ActionForm>
                </>
              ) : (
                <>
                  <p className="mb-4 text-sm text-ink-500">
                    Fill Gigsaw with a bar-circuit agency: 12 acts (solos, duos, a DJ and two bands, one built from solo acts), 8 venues with weekly music
                    schedules, managers and the pub companies that pay, six weeks of gigs played, live arrivals today, the next month of gigs with offers out
                    and gigs still needing an act, two weddings and two private events. It sits alongside your own data, is never billed or messaged, and can be
                    removed in one click.
                  </p>
                  <ActionForm action={loadDemoData}>
                    <SubmitButton pendingText="Loading demo data…">Load demo data</SubmitButton>
                  </ActionForm>
                </>
              )}
            </Section>
          )}

          <Section id="password" title="Password">
            <ActionForm action={changePassword} className="space-y-4">
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
          </Section>
        </div>
      </div>
    </div>
  );
}
