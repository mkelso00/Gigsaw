import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
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
      <ActionForm action={saveSettings} className="space-y-9">
        <SettingsSection title="When an arrival counts as on time">
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grace period (minutes)" hint="An arrival this many minutes after call time still counts as on time">
                <input name="lateGraceMinutes" inputMode="numeric" defaultValue={settings.lateGraceMinutes} className="input" />
              </Field>
              <Field label="Venue radius (metres)" hint="A check-in within this distance of the venue's map pin counts as verified">
                <input name="geofenceMetres" inputMode="numeric" defaultValue={settings.geofenceMetres} className="input" />
              </Field>
              <Field
                label="Changeover between gigs (minutes)"
                hint="Time to pack down and get going, added to travel time when checking an act can make two gigs"
              >
                <input name="changeoverMinutes" inputMode="numeric" defaultValue={settings.changeoverMinutes} className="input" />
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
              hint="Emails and texts the booking's lead agent once the call time passes with no check-in."
            />
            <SettingsToggle
              name="clientArrivalMessages"
              defaultChecked={settings.clientArrivalMessages}
              label="Tell clients when the act arrives"
              hint="Messages the booking's client. Can be switched off per booking."
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Also alert this email" hint="Optional on-call address, e.g. a shared inbox">
                <input name="alertEmail" type="email" defaultValue={settings.alertEmail} className="input" />
              </Field>
              <Field label="Also alert this mobile" hint="Optional on-call number">
                <input name="alertPhone" type="tel" defaultValue={settings.alertPhone} className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </SettingsPage>
  );
}
