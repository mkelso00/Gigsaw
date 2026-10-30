import type { Metadata } from "next";
import Link from "next/link";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "Arrivals and alerts" };

export default async function ArrivalSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="Arrivals and alerts">
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection title="Checking in" description="How Arrivals and the punctuality table judge each check-in.">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grace period (minutes)" hint="Arriving up to this long after the arrive-by time still counts as on time. 0 to 240.">
                <input name="lateGraceMinutes" type="number" min={0} max={240} step={1} defaultValue={settings.lateGraceMinutes} className="input" />
              </Field>
              <Field label="Venue radius (metres)" hint="A check-in this close to the venue's map pin counts as verified. 25 to 50,000.">
                <input name="geofenceMetres" type="number" min={25} max={50000} step={1} defaultValue={settings.geofenceMetres} className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Late acts" description="Each internal user can also turn these off for themselves in their profile.">
          <SettingsCard>
            <SettingsToggle
              name="overdueAlerts"
              defaultChecked={settings.overdueAlerts}
              label="Alert us when an act is late"
              hint="Emails and texts the booking's lead agent once the arrive-by time passes with no check-in."
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Also alert this email" hint="Optional, e.g. a shared inbox or whoever's on call">
                  <input name="alertEmail" type="email" defaultValue={settings.alertEmail} className="input" />
                </Field>
                <Field label="Also alert this mobile" hint="Optional on-call number">
                  <input name="alertPhone" type="tel" defaultValue={settings.alertPhone} className="input" />
                </Field>
              </div>
            </SettingsToggle>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Customers">
          <SettingsCard>
            <SettingsToggle
              name="clientArrivalMessages"
              defaultChecked={settings.clientArrivalMessages}
              label="Tell clients when the act arrives"
              hint="A short email and text to the booking's client when the act checks in. Can be switched off on each booking."
            />
          </SettingsCard>
          <p className="mt-2 text-sm text-ink-500">
            Change the wording in{" "}
            <Link href="/settings/notifications/customers/arrived" className="link">
              Notifications
            </Link>
            .
          </p>
        </SettingsSection>

        <SettingsSection title="Double-booking checks" description="Used when saving a booking to check an act can get from one booking to the next.">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Changeover between bookings (minutes)" hint="Time to pack down and get going, added to the travel time between venues. 0 to 240.">
                <input name="changeoverMinutes" type="number" min={0} max={240} step={1} defaultValue={settings.changeoverMinutes} className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}
