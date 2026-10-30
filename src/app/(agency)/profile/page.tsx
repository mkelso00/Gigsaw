import type { Metadata } from "next";
import { cookies } from "next/headers";
import { logout } from "@/actions/auth";
import { changePassword, saveMyNotifications, updateMyDetails } from "@/actions/settings";
import { toggleTheme } from "@/actions/theme";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StaffPushSetup } from "@/components/push-setup";
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CHANNEL_LABELS, STAFF_ALERTS, wants } from "@/lib/notify-prefs";
import { vapidKeys } from "@/lib/push";

export const metadata: Metadata = { title: "Profile" };

/** Your own details, alerts, password and look. Separate from the business's Settings. */
export default async function ProfilePage() {
  const user = await requireStaff();
  const theme = (await cookies()).get("gigsaw_theme")?.value === "dark" ? "dark" : "light";
  return (
    <SettingsPage
      title="Profile"
      actions={
        <form action={logout}>
          <button className="btn">Sign out</button>
        </form>
      }
    >
      <SettingsSection title="Your details" description="Your mobile is used for texts about late acts and turned-down gigs.">
        <SettingsCard pad>
          <ActionForm action={updateMyDetails} saveBar className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required defaultValue={user.name} className="input" />
            </Field>
            <Field label="Mobile number">
              <input name="phone" type="tel" defaultValue={user.phone} placeholder="07700 900000" className="input" />
            </Field>
            <Field label="Email" hint="Your login. Ask an admin to change it.">
              <input value={user.email} readOnly className="input opacity-70" />
            </Field>
          </ActionForm>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        id="notifications"
        title="Notifications"
        description="What you hear about on the gigs and events you look after. Turning one off here only affects you."
      >
        <ActionForm action={saveMyNotifications} saveBar className="space-y-4">
          <SettingsCard>
            {STAFF_ALERTS.map((a) => (
              <div key={a.key} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <span>
                  <span className="block text-sm font-medium text-ink-950">{a.label}</span>
                  <span className="mt-0.5 block text-sm text-ink-500">{a.hint}</span>
                </span>
                <span className="flex gap-5">
                  {(["email", "text", "push"] as const).map((c) =>
                    (a.channels as readonly string[]).includes(c) ? (
                      <label key={c} className="flex w-[78px] items-center gap-2 text-sm text-ink-700">
                        <input type="checkbox" name={`${a.key}:${c}`} defaultChecked={wants(user.notifyPrefs, a.key, c)} className="switch" />
                        {CHANNEL_LABELS[c]}
                      </label>
                    ) : (
                      <span key={c} className="w-[78px]" />
                    ),
                  )}
                </span>
              </div>
            ))}
          </SettingsCard>
        </ActionForm>
        <SettingsCard className="mt-4">
          <StaffPushSetup publicKey={(await vapidKeys()).publicKey} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Password">
        <SettingsCard pad>
          <ActionForm action={changePassword} className="grid gap-4 sm:grid-cols-2">
            <Field label="Current password">
              <input name="current" type="password" required autoComplete="current-password" className="input" />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <input name="next" type="password" required minLength={8} autoComplete="new-password" className="input" />
            </Field>
            <div className="flex justify-end sm:col-span-2">
              <SubmitButton>Change password</SubmitButton>
            </div>
          </ActionForm>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsCard>
          <SettingsRow
            icon={theme === "dark" ? "moon" : "sun"}
            title={theme === "dark" ? "Dark" : "Light"}
            sub="Just for you, on this device."
            right={
              <form action={toggleTheme.bind(null, theme)}>
                <button className="btn btn-sm">Switch to {theme === "dark" ? "light" : "dark"}</button>
              </form>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
