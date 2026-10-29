import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "Weddings and events" };

export default async function WeddingSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="Weddings and events">
      <ActionForm action={saveSettings} className="space-y-9">
        <SettingsSection
          title="Automatic emails"
          description="The planner link and a reminder to the customer, a balance reminder, final details to the acts a week before, and a thank-you afterwards."
        >
          <SettingsCard>
            <SettingsToggle
              name="eventEmails"
              defaultChecked={settings.eventEmails}
              label="Send automatic wedding and event emails"
              hint="Can also be turned off for a single event. Sent between 9am and 8pm."
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Tell the customer when an act is confirmed" hint="The act is always told. Bar venues aren't told: that's just for your records.">
                <select name="customerConfirmations" defaultValue={settings.customerConfirmations} className="input">
                  <option value="EVENTS">Weddings and private events only</option>
                  <option value="ALL">Every booking with a customer email</option>
                  <option value="OFF">Never</option>
                </select>
              </Field>
              <Field label="Review link" hint="Added to the thank-you email, e.g. your Google reviews page">
                <input name="reviewLink" type="url" defaultValue={settings.reviewLink} placeholder="https://" className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </SettingsPage>
  );
}
