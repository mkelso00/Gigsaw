import { CopyField } from "@/components/client-bits";

/**
 * One-tap buttons that subscribe the artist's phone calendar to their private gig feed.
 * Subscribed calendars update by themselves when gigs are added or changed.
 */
export function CalendarConnect({ feedUrl, name }: { feedUrl: string; name: string }) {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  const outlook = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`;
  const btn = "flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-medium transition";
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
      <h2 className="text-sm font-medium text-ink-400">Put your gigs in your phone&apos;s calendar</h2>
      <p className="mt-1 text-sm text-ink-300">Tap once. New gigs and any changes then appear in your calendar automatically.</p>
      <div className="mt-4 grid gap-2">
        <a href={webcal} className={`${btn} bg-white text-ink-950 hover:bg-ink-100`}>
          iPhone / Apple Calendar
        </a>
        <a href={google} target="_blank" rel="noreferrer" className={`${btn} border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]`}>
          Google Calendar
        </a>
        <a href={outlook} target="_blank" rel="noreferrer" className={`${btn} border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]`}>
          Outlook
        </a>
      </div>
      <details className="mt-4 text-xs text-ink-400">
        <summary className="cursor-pointer">Other calendars, or if a button doesn&apos;t work</summary>
        <p className="my-2">Add a calendar &ldquo;from URL&rdquo; or &ldquo;by subscription&rdquo; and paste this link. Keep it private: anyone with it can see your gig dates.</p>
        <div className="[&_input]:border-white/10 [&_input]:bg-white/[0.04] [&_input]:text-white">
          <CopyField value={feedUrl} />
        </div>
        <p className="mt-2">Google Calendar checks for changes every few hours; Apple Calendar lets you choose how often in its settings.</p>
      </details>
    </section>
  );
}
