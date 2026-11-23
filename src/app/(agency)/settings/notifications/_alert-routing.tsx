import Link from "next/link";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { CONTEXT_LABELS, ROUTES, TEAM_ALERTS, readRouting, routeField, routeLabels, type AlertContext } from "@/lib/team-alert-routing";

const COLUMNS: AlertContext[] = ["EVENTS", "GIGS"];

/** Settings, Notifications: the two shared inboxes, and who hears about each team alert. Admins only (the page checks). */
export function AlertRoutingSection({ settings }: { settings: { eventsEmail: string; gigsEmail: string; alertRouting: unknown } }) {
  const routing = readRouting(settings.alertRouting);
  return (
    <SettingsSection
      id="team-alerts"
      title="Where team alerts go"
      description="Choose who hears about each one, for weddings and events and for venue gigs. Shared inboxes get emails only: phone notifications and texts go to the lead agent."
    >
      <ActionForm action={saveSettings} saveBar className="space-y-4">
        <input type="hidden" name="alertRouting__shown" value="1" />
        <SettingsCard pad>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Weddings and events email" hint="A shared inbox, e.g. events@yourbusiness.co.uk">
              <input name="eventsEmail" type="email" defaultValue={settings.eventsEmail} placeholder="events@example.co.uk" className="input" />
            </Field>
            <Field label="Venue gigs email" hint="A shared inbox, e.g. gigs@yourbusiness.co.uk">
              <input name="gigsEmail" type="email" defaultValue={settings.gigsEmail} placeholder="gigs@example.co.uk" className="input" />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="hidden px-5 py-3 text-xs font-semibold tracking-wide text-ink-500 uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_180px_180px] sm:gap-3">
            <span>Alert</span>
            {COLUMNS.map((c) => (
              <span key={c}>{CONTEXT_LABELS[c]}</span>
            ))}
          </div>
          {TEAM_ALERTS.map((a) => {
            const labels = routeLabels(a.key);
            const contexts = a.contexts as readonly string[];
            const select = (ctx: AlertContext | "ALL") => (
              <select name={routeField(a.key, ctx)} defaultValue={routing[a.key][ctx]} className="input">
                {ROUTES.map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            );
            return (
              <div key={a.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_180px_180px] sm:items-center">
                <span className="text-sm font-medium text-ink-950">{a.label}</span>
                {contexts.includes("ALL") ? (
                  <label className="block sm:col-span-2">
                    <span className="sr-only">{a.label}: who hears</span>
                    {select("ALL")}
                  </label>
                ) : (
                  COLUMNS.map((c) =>
                    contexts.includes(c) ? (
                      <label key={c} className="block">
                        <span className="label sm:sr-only">{CONTEXT_LABELS[c]}</span>
                        {select(c)}
                      </label>
                    ) : (
                      <span key={c} className="hidden text-sm text-ink-400 sm:block">
                        Weddings and events only
                      </span>
                    ),
                  )
                )}
              </div>
            );
          })}
        </SettingsCard>

        <div className="space-y-1 text-sm text-ink-500">
          <p>
            The shared inbox is the weddings and events email or the venue gigs email; for new leads and billing it&apos;s the business email, and for the pay
            run the accounts email. Until an inbox is filled in, its alerts go to the lead agent (or admins) as before. With no lead agent, the business email
            hears.
          </p>
          <p>
            A late act also goes to the on-call contact in{" "}
            <Link href="/settings/arrivals" className="link">
              Arrivals and alerts
            </Link>
            .
          </p>
          <p>
            You can also switch alerts off for yourself in your{" "}
            <Link href="/profile#notifications" className="link">
              profile
            </Link>
            .
          </p>
        </div>
      </ActionForm>
    </SettingsSection>
  );
}
