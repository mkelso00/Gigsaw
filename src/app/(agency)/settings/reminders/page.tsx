import type { Metadata } from "next";
import Link from "next/link";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { WEEKDAYS } from "@/lib/rota";

export const metadata: Metadata = { title: "Act reminders" };

export default async function ReminderSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="Act reminders">
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection
          title="Reminders to acts"
          description="Sent as a phone notification once the act turns them on in their app, and by email. Anyone without phone notifications gets a text instead. Each reminder only ever goes once."
        >
          <SettingsCard>
            <SettingsToggle
              name="weeklyReminders"
              defaultChecked={settings.weeklyReminders}
              label="Weekly list of gigs"
              hint="Each act gets their gigs for the coming Monday to Sunday: on hold, pending and confirmed, never enquiries or cancelled gigs."
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Day">
                  <select name="weeklyReminderDay" defaultValue={settings.weeklyReminderDay} className="input">
                    {WEEKDAYS.map(([n, , long]) => (
                      <option key={n} value={n}>
                        {long}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Time" hint="Your business's time zone">
                  <input name="weeklyReminderTime" type="time" defaultValue={settings.weeklyReminderTime} className="input" />
                </Field>
              </div>
            </SettingsToggle>
            <SettingsToggle
              name="dayReminders"
              defaultChecked={settings.dayReminders}
              label="Reminder on the day"
              hint="“Don’t forget your gig this evening”. For an afternoon gig it goes 3 hours before the arrive-by time instead."
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Time on the day" hint="The venue's local time">
                  <input name="dayReminderTime" type="time" defaultValue={settings.dayReminderTime} className="input" />
                </Field>
              </div>
            </SettingsToggle>
          </SettingsCard>
          <p className="mt-2 text-sm text-ink-500">
            Change the wording in{" "}
            <Link href="/settings/notifications/acts" className="link">
              Notifications
            </Link>
            .
          </p>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}
