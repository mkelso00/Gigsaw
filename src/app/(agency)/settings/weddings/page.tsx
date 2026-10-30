import type { Metadata } from "next";
import Link from "next/link";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
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
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection title="Automatic emails" description="Sent between 9am and 8pm, each one only once.">
          <SettingsCard>
            <SettingsToggle
              name="eventEmails"
              defaultChecked={settings.eventEmails}
              label="Send automatic wedding and event emails"
              hint={
                <>
                  The planner link 8 weeks before (and a reminder at 3 weeks if it isn&apos;t filled in), a balance reminder in the last 2 weeks while money is
                  owed, final details to the acts a week before, and a thank-you the day after. Can also be turned off for a single event.
                </>
              }
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Review link" hint="Added to the thank-you email, e.g. your Google reviews page" className="sm:col-span-2">
                  <input name="reviewLink" type="url" defaultValue={settings.reviewLink} placeholder="https://" className="input" />
                </Field>
              </div>
            </SettingsToggle>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Booking confirmations" description="When an act's booking becomes Confirmed, the act is always told. Choose who else hears.">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tell whoever pays" hint="Sent to the booking's customer or company, if they have an email address.">
                <select name="customerConfirmations" defaultValue={settings.customerConfirmations} className="input">
                  <option value="EVENTS">Weddings and private events only</option>
                  <option value="ALL">Every booking, bar venues too</option>
                  <option value="OFF">Never</option>
                </select>
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <p className="text-sm text-ink-500">
          Change the wording of these emails in{" "}
          <Link href="/settings/notifications/customers" className="link">
            Notifications
          </Link>
          .
        </p>
      </ActionForm>
    </SettingsPage>
  );
}
