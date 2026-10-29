import type { Metadata } from "next";
import { logout } from "@/actions/auth";
import { changePassword, clearDemoData, createStaffUser, loadDemoData, removeStaffUser, saveSettings } from "@/actions/settings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const [settings, team, demoBookings] = await Promise.all([
    getSettings(),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "AGENT"] }, demo: false }, orderBy: { name: "asc" } }),
    prisma.booking.count({ where: { demo: true } }),
  ]);

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
        <ActionForm action={saveSettings} className="card card-pad space-y-4">
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

          <h2 className="section-title pt-2">Arrival tracking</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Grace period (minutes)" hint="An arrival this many minutes after call time still counts as on time">
              <input name="lateGraceMinutes" inputMode="numeric" defaultValue={settings.lateGraceMinutes} className="input" />
            </Field>
            <Field label="Venue radius (metres)" hint="A check-in within this distance of the venue's map pin counts as verified">
              <input name="geofenceMetres" inputMode="numeric" defaultValue={settings.geofenceMetres} className="input" />
            </Field>
          </div>

          <h2 className="section-title pt-2">Documents</h2>
          <Field label="Contract terms" hint="Added to every contract">
            <textarea name="contractTerms" rows={5} defaultValue={settings.contractTerms} className="input" />
          </Field>
          <Field label="Invoice terms">
            <textarea name="invoiceTerms" rows={2} defaultValue={settings.invoiceTerms} className="input" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </ActionForm>
      )}

      {isAdmin && (
        <section className="card card-pad">
          <h2 className="section-title mb-3">Team</h2>
          <ul className="mb-5 divide-y divide-slate-100 text-sm">
            {team.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <span>
                  <strong>{u.name}</strong> · {u.email} · {u.role === "ADMIN" ? "Admin" : "Agent"}
                </span>
                {u.id !== user.id && (
                  <form action={removeStaffUser.bind(null, u.id)}>
                    <ConfirmButton message={`Remove ${u.name}'s access?`} className="btn btn-sm btn-danger">
                      Remove
                    </ConfirmButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <ActionForm action={createStaffUser} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <Field label="Name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className="input" />
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
          <p className="hint mt-2">Admins can change settings and manage the team. Agents can do everything else. Artist logins are made on each artist&apos;s page.</p>
        </section>
      )}

      {isAdmin && (
        <section className="card card-pad">
          <h2 className="section-title">Demo data</h2>
          {demoBookings > 0 ? (
            <>
              <p className="mt-1 mb-4 text-sm text-slate-500">
                Demo data is loaded ({demoBookings} bookings). Remove it before you start using Gigsaw for real. Only the demo artists,
                venues, contacts and bookings are removed, plus anything you added to a demo artist.
              </p>
              <ActionForm action={clearDemoData}>
                <ConfirmButton message="Remove all demo data? This can't be undone.">Remove demo data</ConfirmButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mt-1 mb-4 text-sm text-slate-500">
                Fill Gigsaw with sample artists, venues, promoters and about 80 bookings, including live arrivals for today, so you can
                see how everything works. It sits alongside your own data and can be removed in one click.
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
