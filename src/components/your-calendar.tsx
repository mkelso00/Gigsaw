import Link from "next/link";
import { disconnectMyCalendar } from "@/actions/calendar-connect";
import { CalendarConnect } from "@/components/calendar-connect";
import { ScrollIntoViewOnLoad } from "@/components/client-bits";
import { ConfirmButton, ServerForm } from "@/components/forms";
import { ProviderLogo } from "@/components/oauth-buttons";
import { CALENDAR_LABELS, calendarMessage } from "@/lib/calendar-connect";
import { parseProvider, type ProviderKey } from "@/lib/oauth";

export type CalendarConnectionView = { id: string; provider: string; accountEmail: string; calendarName: string; status: string; lastError: string };

const btn = "flex h-12 items-center justify-center gap-2.5 rounded-xl text-[15px] font-medium transition";
const light = `${btn} bg-white text-ink-950 hover:bg-ink-100`;
const dark = `${btn} border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]`;

/** Which calendar the gigs go in, in words. */
function whereGigsGo(provider: ProviderKey, calendarName: string) {
  return calendarName || (provider === "google" ? "your main Google Calendar" : "your main Outlook calendar");
}

/**
 * The act app's "Your calendar": connect Google Calendar or Outlook so gigs go straight in, see which account and
 * calendar they go to, reconnect when access has gone, change calendar or disconnect. The subscribe buttons (Apple
 * Calendar and anyone who prefers a feed) stay underneath. `providers` are the ones set up on this site.
 */
export function YourCalendar({
  connections,
  providers,
  feedUrl,
  feedName,
  notice,
}: {
  connections: CalendarConnectionView[];
  providers: ProviderKey[];
  feedUrl: string | null;
  feedName: string;
  notice: { calendar?: string; p?: string };
}) {
  const msg = calendarMessage(notice.calendar, parseProvider(notice.p));
  return (
    <section id="calendar" className="scroll-mt-20 rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
      <h2 className="text-sm font-medium text-ink-400">Your calendar</h2>
      {msg && (
        <p
          role={msg.tone === "error" ? "alert" : "status"}
          className={`mt-3 rounded-xl px-3.5 py-2.5 text-sm ${msg.tone === "ok" ? "bg-volt-400/10 text-volt-300" : "bg-rose-500/15 text-rose-300"}`}
        >
          {msg.text}
          <ScrollIntoViewOnLoad id="calendar" />
        </p>
      )}

      {connections.length === 0 ? (
        <>
          <p className="mt-1 text-[15px] text-ink-300">
            Connect your calendar once and Gigsaw puts every gig in it. Changes and cancellations follow by themselves.
          </p>
          <div className="mt-4 grid gap-2">
            {providers.map((p, i) => (
              // A plain link: the server sends the browser on to Google or Microsoft to allow access.
              <a key={p} href={`/api/calendar-connect/${p}`} className={i === 0 ? light : dark} data-provider={p}>
                <ProviderLogo provider={p} />
                Connect {CALENDAR_LABELS[p]}
              </a>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">Gigsaw only adds, changes and removes your gigs. Your other events are left alone.</p>
        </>
      ) : (
        connections.map((c) => {
          const p: ProviderKey = c.provider === "MICROSOFT" ? "microsoft" : "google";
          const broken = c.status === "NEEDS_RECONNECT";
          return (
            <div key={c.id} className="mt-4" data-testid="calendar-connection">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white">
                  <ProviderLogo provider={p} className="h-5 w-5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="font-medium break-words">
                    {broken ? "Needs reconnecting" : "Connected"}: {c.accountEmail || CALENDAR_LABELS[p]}
                  </div>
                  <div className="text-sm text-ink-400">Gigs go in {whereGigsGo(p, c.calendarName)}</div>
                </div>
              </div>

              {broken ? (
                <div role="alert" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                  <p className="text-sm text-amber-200">Gigsaw can&apos;t reach your calendar any more, so new gigs and changes aren&apos;t going in.</p>
                  {providers.includes(p) && (
                    <a href={`/api/calendar-connect/${p}`} className={`${btn} mt-3 w-full bg-volt-400 text-ink-950 hover:bg-volt-300`}>
                      Reconnect {CALENDAR_LABELS[p]}
                    </a>
                  )}
                </div>
              ) : c.lastError ? (
                <p className="mt-3 text-sm text-amber-200/90">A recent change hasn&apos;t reached your calendar yet. Gigsaw will keep trying.</p>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-2">
                {broken ? (
                  <span />
                ) : (
                  <Link href="/app/calendar" className={dark}>
                    Change calendar
                  </Link>
                )}
                <ServerForm action={disconnectMyCalendar.bind(null, c.id)} className="contents">
                  <ConfirmButton
                    message={`Disconnect ${CALENDAR_LABELS[p]}? Gigsaw takes out the gigs it added and stops adding new ones.`}
                    className={`${dark} w-full text-ink-300`}
                  >
                    Disconnect
                  </ConfirmButton>
                </ServerForm>
              </div>
            </div>
          );
        })
      )}

      {feedUrl && (
        <details className="group mt-5 border-t border-white/[0.06] pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink-300 hover:text-white">
            Or subscribe instead (Apple Calendar)
            <span className="text-ink-500 transition group-open:rotate-90" aria-hidden>
              ›
            </span>
          </summary>
          <p className="mt-2 mb-4 text-sm text-ink-400">
            Tap once and your calendar checks for new and changed gigs by itself. Use this or a connected calendar, not both, or each gig shows twice.
          </p>
          <CalendarConnect feedUrl={feedUrl} name={feedName} bare />
        </details>
      )}
    </section>
  );
}
