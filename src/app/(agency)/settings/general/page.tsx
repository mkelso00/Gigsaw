import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { INVOICE_MODES, INVOICE_MODE_LABELS } from "@/lib/act-invoices";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "General settings" };

export default async function GeneralSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="General">
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection title="Business details" description="Shown on emails, contracts and invoices.">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <input name="agencyName" required defaultValue={settings.agencyName} autoComplete="organization" className="input" />
              </Field>
              <Field label="Business email" hint="Replies to every email Gigsaw sends for you come here">
                <input name="agencyEmail" type="email" defaultValue={settings.agencyEmail} placeholder="bookings@example.co.uk" className="input" />
              </Field>
              <Field label="Address" hint="Printed on contracts and invoices" className="sm:col-span-2">
                <textarea name="agencyAddress" rows={3} defaultValue={settings.agencyAddress} className="input" />
              </Field>
              <Field
                label="Accounts email (optional)"
                hint="The weekly pay run's invoices for your records go here, and the Monday “ready to check” email. Empty: the records go to your business email and the reminder to each admin."
                className="sm:col-span-2"
              >
                <input name="accountsEmail" type="email" defaultValue={settings.accountsEmail} placeholder="accounts@example.co.uk" className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="Acts' invoices"
          description="Gigsaw makes a self-billing invoice for each act's fee. Choose when: after each gig, or all at once when you sign off the week's gigs in the Weekly pay run."
        >
          <SettingsCard pad>
            <Field
              label="When act invoices are made"
              hint="Signing off: on Monday you tick off last week's gigs as played (leaving out any that didn't happen) and that makes the invoices. Automatic: each one once its gig is over."
            >
              <select name="actInvoiceMode" defaultValue={settings.actInvoiceMode === "AUTO" ? "AUTO" : "SIGN_OFF"} className="input">
                {INVOICE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {INVOICE_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="Booking acts"
          description="Keep everyone on Gigsaw: an act can only be booked once they've signed up, so they get their gigs, reminders and pay in one place."
        >
          <SettingsCard>
            <SettingsToggle
              name="bookOnlySignedUp"
              defaultChecked={settings.bookOnlySignedUp}
              label="Only book acts who've signed up to Gigsaw"
              hint="A solo act has signed up once they've made their login. A band has once the person its invoices go to has. An admin can approve an act on its page to be booked before then, or book one anyway each time. Everyone else is asked to send the act their sign-up link."
            />
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="Contact for acts"
          description="Who musicians call about a gig. Shown on every gig in their app, calendar and day sheet, instead of the promoter (who stays on your invoices)."
        >
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input name="actContactName" defaultValue={settings.actContactName} placeholder="e.g. Lucy" className="input" />
              </Field>
              <Field label="Phone">
                <input name="actContactPhone" type="tel" defaultValue={settings.actContactPhone} placeholder="07700 900123" className="input" />
              </Field>
            </div>
            <p className="hint mt-2">Leave both empty to show each booking&apos;s promoter instead.</p>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection title="Time zone and currency" description="Used for new bookings, reports and reminders.">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time zone" hint="When days start and end in reports and reminders. A venue's own time zone is used for its bookings.">
                <select name="defaultTimezone" defaultValue={settings.defaultTimezone} className="input">
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Currency" hint="For new bookings. Bookings already made keep theirs.">
                <select name="defaultCurrency" defaultValue={settings.defaultCurrency} className="input">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}
