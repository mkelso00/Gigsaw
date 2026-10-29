import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
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
      <ActionForm action={saveSettings} className="space-y-9">
        <SettingsSection
          title="Reminders to acts"
          description="Sent as a phone notification (once they turn them on in their app) and by email. Anyone without phone notifications gets a text instead. Holds, pending and confirmed gigs are included; enquiries and cancelled gigs never are."
        >
          <SettingsCard>
            <SettingsToggle
              name="weeklyReminders"
              defaultChecked={settings.weeklyReminders}
              label="Weekly list of gigs"
              hint="Each act gets their gigs for the coming Monday to Sunday."
            />
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
              <Field label="Time">
                <input name="weeklyReminderTime" type="time" defaultValue={settings.weeklyReminderTime} className="input" />
              </Field>
            </div>
            <SettingsToggle
              name="dayReminders"
              defaultChecked={settings.dayReminders}
              label="Reminder on the day"
              hint="“Don’t forget your gig this evening”. For an afternoon gig it goes 3 hours before the call time instead."
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Time on the day" hint="Venue's local time">
                <input name="dayReminderTime" type="time" defaultValue={settings.dayReminderTime} className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </SettingsPage>
  );
}
