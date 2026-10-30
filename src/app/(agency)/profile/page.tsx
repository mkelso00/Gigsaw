import type { Metadata } from "next";
import { cookies } from "next/headers";
import { logout } from "@/actions/auth";
import { resetCalendarLink, saveCalendarSync, turnOffCalendarSync } from "@/actions/calendar-sync";
import { disconnectSignIn } from "@/actions/oauth";
import { changePassword, saveMyNotifications, updateMyDetails } from "@/actions/settings";
import { toggleTheme } from "@/actions/theme";
import { CopyField } from "@/components/client-bits";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { OAuthNotice, ProviderLogo } from "@/components/oauth-buttons";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { calendarLinks } from "@/lib/calendar-links";
import { BOOKING_STATUS_LABELS } from "@/lib/constants";
import { appUrl } from "@/lib/messaging";
import { STAFF_ALERTS, wants } from "@/lib/notify-prefs";
import { configuredProviders, PROVIDER_KEYS, PROVIDERS } from "@/lib/oauth";
import { signInMethods } from "@/lib/oauth-flow";
import { feedStatuses, TEAM_FEED_STATUSES } from "@/lib/team-calendar";

export const metadata: Metadata = { title: "Profile" };

/** Your own details, alerts, password, sign-in methods, calendar and look. Separate from the business's Settings. */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ oauth?: string; p?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const theme = (await cookies()).get("gigsaw_theme")?.value === "dark" ? "dark" : "light";
  const methods = await signInMethods(user);
  const configured = configuredProviders();
  // Providers to list: those set up on this site, plus any still connected after being switched off.
  const providers = PROVIDER_KEYS.filter((p) => configured.includes(p) || methods.linked.some((l) => l.provider === PROVIDERS[p].db));
  const feedUrl = user.calendarToken ? `${appUrl()}/api/calendar/team/${user.calendarToken}.ics` : null;
  const links = feedUrl ? calendarLinks(feedUrl, user.calendarScope === "ALL" ? "Gigsaw: all bookings" : "Gigsaw: my bookings") : null;
  const shownStatuses = feedStatuses(user.calendarStatuses);
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
                  {(["email", "text"] as const).map((c) =>
                    (a.channels as readonly string[]).includes(c) ? (
                      <label key={c} className="flex items-center gap-2 text-sm text-ink-700">
                        <input type="checkbox" name={`${a.key}:${c}`} defaultChecked={wants(user.notifyPrefs, a.key, c)} className="switch" />
                        {c === "email" ? "Email" : "Text"}
                      </label>
                    ) : (
                      <span key={c} className="w-[74px]" />
                    ),
                  )}
                </span>
              </div>
            ))}
          </SettingsCard>
        </ActionForm>
      </SettingsSection>

      <SettingsSection
        id="calendar"
        title="Calendar sync"
        description="Your bookings in Google Calendar, Outlook or Apple Calendar, kept up to date by themselves. Times are in the business's time zone, and fees and other money are never included."
      >
        <div className="space-y-4">
          {links && feedUrl && (
            <SettingsCard pad>
              <div className="grid gap-2 sm:grid-cols-2">
                <a href={links.google} target="_blank" rel="noreferrer" className="btn btn-primary">
                  Add to Google Calendar
                </a>
                <a href={links.outlook} target="_blank" rel="noreferrer" className="btn">
                  Add to Outlook
                </a>
                <a href={links.outlook365} target="_blank" rel="noreferrer" className="btn">
                  Add to Outlook (work or school)
                </a>
                <a href={links.webcal} className="btn">
                  Apple Calendar or other
                </a>
              </div>
              <p className="mt-4 text-sm text-ink-500">
                Google Calendar refreshes subscribed calendars every few hours, so a new or changed booking can take a while to appear there. Outlook is
                similar. Apple Calendar lets you choose how often in its settings.
              </p>
              <div className="mt-4">
                <span className="label">Your private calendar link</span>
                <CopyField value={feedUrl} />
                <span className="hint block">
                  For any other calendar app: add a calendar &ldquo;from URL&rdquo; or &ldquo;by subscription&rdquo; and paste this. Keep it to yourself: anyone
                  with it can see the bookings in it.
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={resetCalendarLink}>
                  <ConfirmButton message="Make a new link? The old one stops working, so you'll need to add the calendar again." className="btn btn-sm">
                    Make a new link
                  </ConfirmButton>
                </form>
                <form action={turnOffCalendarSync}>
                  <ConfirmButton message="Turn off calendar sync? The link stops working and the calendar stops updating." className="btn btn-sm btn-danger">
                    Turn off
                  </ConfirmButton>
                </form>
              </div>
            </SettingsCard>
          )}
          <SettingsCard pad>
            <ActionForm action={saveCalendarSync} className="space-y-5">
              <fieldset>
                <legend className="label">Which bookings</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { value: "MINE", label: "My bookings", hint: "Where I'm the lead agent" },
                    { value: "ALL", label: "All bookings", hint: "Everything in the business" },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 px-4 py-3 has-[:checked]:border-ink-950"
                    >
                      <input type="radio" name="scope" value={o.value} defaultChecked={user.calendarScope === o.value} className="mt-0.5 h-4 w-4" />
                      <span>
                        <span className="block text-sm font-medium text-ink-950">{o.label}</span>
                        <span className="block text-xs text-ink-500">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">Statuses</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                  {TEAM_FEED_STATUSES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm text-ink-700">
                      <input type="checkbox" name="status" value={s} defaultChecked={shownStatuses.includes(s)} className="h-4 w-4" />
                      {BOOKING_STATUS_LABELS[s]}
                    </label>
                  ))}
                </div>
                <span className="hint block">Cancelled and archived bookings are always left out. Tick none to include every status.</span>
              </fieldset>
              <div className="flex justify-end">
                <SubmitButton>{feedUrl ? "Save" : "Make my calendar link"}</SubmitButton>
              </div>
            </ActionForm>
          </SettingsCard>
        </div>
      </SettingsSection>

      <SettingsSection
        id="password"
        title="Password"
        description={methods.hasPassword ? undefined : "You sign in with Google or Microsoft. Set a password too if you like."}
      >
        <SettingsCard pad>
          <ActionForm action={changePassword} className="grid gap-4 sm:grid-cols-2">
            {methods.hasPassword && (
              <Field label="Current password">
                <input name="current" type="password" required autoComplete="current-password" className="input" />
              </Field>
            )}
            <Field label="New password" hint="At least 8 characters">
              <input name="next" type="password" required minLength={8} autoComplete="new-password" className="input" />
            </Field>
            <div className="flex justify-end sm:col-span-2">
              <SubmitButton>{methods.hasPassword ? "Change password" : "Set password"}</SubmitButton>
            </div>
          </ActionForm>
        </SettingsCard>
      </SettingsSection>

      {providers.length > 0 && (
        <SettingsSection id="sign-in" title="Sign-in methods" description="Ways you can sign in to Gigsaw. You always keep at least one.">
          <OAuthNotice sp={sp} className="mb-3" />
          <SettingsCard>
            <SettingsRow
              icon="lock"
              title="Email and password"
              sub={methods.hasPassword ? user.email : "No password set"}
              right={methods.hasPassword ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
            />
            {providers.map((p) => {
              const link = methods.linked.find((l) => l.provider === PROVIDERS[p].db);
              const last = methods.count <= 1;
              return (
                <div key={p} className="flex flex-wrap items-start gap-x-3.5 gap-y-3 px-5 py-4 sm:flex-nowrap">
                  <ProviderLogo provider={p} className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-950">{PROVIDERS[p].label}</span>
                    <span className="mt-0.5 block truncate text-sm text-ink-500">
                      {link ? `Connected${link.email ? ` as ${link.email}` : ""}` : "Not connected"}
                    </span>
                  </span>
                  <span className="w-full pl-[34px] sm:w-auto sm:shrink-0 sm:pl-0">
                    {link ? (
                      last ? (
                        <span className="text-xs text-ink-500">Your only way to sign in</span>
                      ) : (
                        <form action={disconnectSignIn.bind(null, p)}>
                          <ConfirmButton message={`Disconnect ${PROVIDERS[p].label}? You won't be able to sign in with it.`} className="btn btn-sm">
                            Disconnect
                          </ConfirmButton>
                        </form>
                      )
                    ) : configured.includes(p) ? (
                      <a href={`/api/auth/${p}?intent=link`} className="btn btn-sm">
                        Connect
                      </a>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </SettingsCard>
        </SettingsSection>
      )}

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
