import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { chooseMyCalendar } from "@/actions/calendar-connect";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ProviderLogo } from "@/components/oauth-buttons";
import { requireUser } from "@/lib/auth";
import { CALENDAR_LABELS, calendarProviders, currentChoice, listCalendars, ListNotAllowed, ReconnectNeeded, type CalendarChoice } from "@/lib/calendar-connect";
import { prisma } from "@/lib/db";
import { log } from "@/server/log";

export const metadata: Metadata = { title: "Choose your calendar" };
export const dynamic = "force-dynamic";

/** The act app: choose which of your connected calendars your gigs go in. */
export default async function ChooseCalendarPage() {
  const user = await requireUser(["ARTIST"]);
  const connections = await prisma.calendarConnection.findMany({ where: { userId: user.id, agencyId: user.agencyId }, orderBy: { createdAt: "asc" } });
  if (!connections.length) redirect("/app#calendar");
  const available = calendarProviders();

  // Asks Google or Microsoft for the act's calendars now, so the list is always current.
  const lists = await Promise.all(
    connections.map(async (c) => {
      const provider = c.provider === "MICROSOFT" ? ("microsoft" as const) : ("google" as const);
      let calendars: CalendarChoice[] | null = null;
      let problem: "reconnect" | "not_allowed" | "unreachable" | null = null;
      if (c.status === "NEEDS_RECONNECT") problem = "reconnect";
      else
        try {
          calendars = await listCalendars(c);
        } catch (e) {
          problem = e instanceof ReconnectNeeded ? "reconnect" : e instanceof ListNotAllowed ? "not_allowed" : "unreachable";
          if (problem === "unreachable") log.warn("Couldn't list calendars", { err: e, connectionId: c.id });
        }
      return { c, provider, calendars, problem, current: calendars ? currentChoice(c, calendars) : undefined };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <Link href="/app#calendar" className="text-sm text-ink-400 hover:text-white">
          ← My bookings
        </Link>
        <h1 className="mt-3 text-[28px] leading-tight font-semibold tracking-tight">Choose your calendar</h1>
        <p className="mt-1 text-[15px] text-ink-400">Pick where your gigs go. Gigsaw moves the gigs it has already added.</p>
      </div>

      {lists.map(({ c, provider, calendars, problem, current }) => (
        <section key={c.id} className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white">
              <ProviderLogo provider={provider} />
            </span>
            <div className="min-w-0">
              <div className="font-medium">{CALENDAR_LABELS[provider]}</div>
              {c.accountEmail && <div className="truncate text-sm text-ink-400">{c.accountEmail}</div>}
            </div>
          </div>

          {calendars && calendars.length > 0 ? (
            <ActionForm action={chooseMyCalendar.bind(null, c.id)} className="space-y-3">
              <fieldset className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08]">
                <legend className="sr-only">Calendars</legend>
                {calendars.map((cal) => (
                  <label
                    key={cal.id}
                    className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[0.03] has-[:checked]:bg-volt-400/[0.06]"
                  >
                    <input
                      // Keyed on the saved choice so the tick follows it once the page refreshes after saving.
                      key={`${cal.id}:${current?.id ?? ""}`}
                      type="radio"
                      name="calendarId"
                      value={cal.id}
                      defaultChecked={cal.id === current?.id}
                      className="h-4 w-4 shrink-0 accent-volt-400"
                    />
                    <span className="min-w-0 flex-1 break-words">{cal.name}</span>
                    {cal.main && <span className="shrink-0 text-xs text-ink-400">Main</span>}
                  </label>
                ))}
              </fieldset>
              <SubmitButton
                className="h-12 w-full rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50"
                pendingText="Moving your gigs…"
              >
                Use this calendar
              </SubmitButton>
            </ActionForm>
          ) : (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
              {problem === "reconnect"
                ? "Gigsaw can't reach your calendar any more. Reconnect it, then you can choose."
                : problem === "not_allowed"
                  ? "Gigsaw isn't allowed to see your list of calendars, so your gigs go in your main calendar. To choose another, reconnect and tick every box."
                  : problem === "unreachable"
                    ? "Your calendar didn't answer just now. Please try again in a minute."
                    : "There are no other calendars you can add events to, so your gigs go in your main calendar."}
              {(problem === "reconnect" || problem === "not_allowed") && available.includes(provider) && (
                <a
                  href={`/api/calendar-connect/${provider}`}
                  className="mt-3 flex h-12 items-center justify-center rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300"
                >
                  Reconnect {CALENDAR_LABELS[provider]}
                </a>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
