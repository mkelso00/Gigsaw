import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
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
            </div>
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
