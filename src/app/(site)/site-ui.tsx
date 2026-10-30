import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/plans";

// Shared building blocks for the public site. The "sketches" are simplified drawings of real
// Gigsaw screens, using made-up acts and venues, so visitors can see what each feature looks like.

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-mono text-xs font-medium tracking-[0.14em] text-ink-500 uppercase ${className}`}>{children}</p>;
}

/** A volt marker stroke behind a few words of a headline. */
export function Marker({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-volt-400 box-decoration-clone px-1.5 whitespace-nowrap">{children}</span>;
}

export function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Check({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Cross({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden className={className}>
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

/** Big closing call to action, used at the bottom of most pages. */
export function FinalCta({ title = "Give your next month of gigs to Gigsaw.", pricingLink = true }: { title?: string; pricingLink?: boolean }) {
  return (
    <section className="bg-volt-400">
      <Container className="py-20 sm:py-28">
        <h2 className="max-w-3xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance text-ink-950 sm:text-6xl">{title}</h2>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-800">
          Set up your venues, put a few weeks of gigs in, send your first offers and watch your acts check in.
          {pricingLink && ` Try it free for ${TRIAL_DAYS} days.`}
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className="btn btn-primary h-12 px-6 text-base">
            Try it free
            <ArrowRight />
          </Link>
          {pricingLink && (
            <Link href="/pricing" className="btn h-12 border-ink-950/15 bg-transparent px-6 text-base shadow-none hover:border-ink-950/30 hover:bg-volt-300">
              See pricing
            </Link>
          )}
        </div>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Sketches                                                                                    */
/* ----------------------------------------------------------------------------------------- */

const ROTA: { venue: string; cells: [string, "booked" | "empty" | "offer"][] }[] = [
  {
    venue: "The Anchor",
    cells: [
      ["Ellie Marsh", "booked"],
      ["Wonderlust", "booked"],
      ["Jo Drummond", "offer"],
    ],
  },
  {
    venue: "Red Lion",
    cells: [
      ["Sam Ortiz Duo", "booked"],
      ["Empty", "empty"],
      ["DJ Kestrel", "booked"],
    ],
  },
  {
    venue: "Wharf Bar",
    cells: [
      ["Empty", "empty"],
      ["Graham McKee", "booked"],
      ["The Velvet Owls", "booked"],
    ],
  },
];

const CELL = {
  booked: "bg-white/[0.06] text-white",
  empty: "bg-amber-400/15 text-amber-300",
  offer: "bg-volt-400/15 text-volt-300",
};

export function RotaSketch() {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">Rota</p>
        <p className="text-xs text-ink-400">Week of 3 November</p>
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,0.9fr)_repeat(3,minmax(0,1fr))] gap-1.5 text-[11px] sm:text-xs">
        <span />
        {["Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="px-1 pb-1 text-ink-400">
            {d}
          </span>
        ))}
        {ROTA.map((row) => (
          <RotaRow key={row.venue} row={row} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Needs an act
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-volt-400" />
          Offer sent
        </span>
      </div>
    </div>
  );
}

function RotaRow({ row }: { row: (typeof ROTA)[number] }) {
  return (
    <>
      <span className="flex items-center truncate pr-1 font-medium text-ink-300">{row.venue}</span>
      {row.cells.map(([act, kind], i) => (
        <span key={i} className={`truncate rounded-md px-2 py-2 ${CELL[kind]}`}>
          {act}
        </span>
      ))}
    </>
  );
}

const ARRIVALS: [string, string, string, string][] = [
  ["Ellie Marsh", "The Anchor", "Arrived 12 min early", "bg-emerald-400"],
  ["Sam Ortiz Duo", "Red Lion", "On the way, here by 18:52", "bg-volt-400"],
  ["DJ Kestrel", "Wharf Bar", "Late: call time was 18:30", "bg-rose-500"],
];

export function ArrivalsSketch({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${dark ? "border-white/10 bg-ink-900" : "border-ink-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${dark ? "text-white" : "text-ink-950"}`}>Arrivals tonight</p>
        <p className={`flex items-center gap-1.5 text-xs ${dark ? "text-ink-400" : "text-ink-500"}`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Live
        </p>
      </div>
      <ul className="mt-4 space-y-2">
        {ARRIVALS.map(([act, venue, status, dot]) => (
          <li key={act} className={`flex items-center gap-3 rounded-xl px-3.5 py-3 ${dark ? "bg-white/[0.04]" : "bg-ink-50"}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="min-w-0">
              <span className={`block truncate text-sm font-medium ${dark ? "text-white" : "text-ink-950"}`}>{act}</span>
              <span className={`block truncate text-xs ${dark ? "text-ink-400" : "text-ink-500"}`}>
                {venue} · {status}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What an act sees when they open an offer link on their phone. */
export function OfferSketch() {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border border-ink-200 bg-white p-3 shadow-[0_30px_60px_-30px_rgba(13,13,12,0.35)]">
      <div className="rounded-[1.5rem] bg-ink-50 p-5">
        <p className="text-xs font-medium text-ink-500">Gig offer from Northside Music</p>
        <p className="mt-3 text-xl leading-tight font-semibold tracking-tight text-ink-950">Friday 14 November</p>
        <dl className="mt-4 space-y-2.5 text-sm">
          {[
            ["Venue", "The Anchor, Leeds"],
            ["Times", "19:00 to 22:00"],
            ["Your fee", "£150"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-ink-500">{k}</dt>
              <dd className="font-medium text-ink-950">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <span className="flex h-10 items-center justify-center rounded-xl bg-ink-950 text-sm font-medium text-white">Accept</span>
          <span className="flex h-10 items-center justify-center rounded-xl border border-ink-200 bg-white text-sm font-medium text-ink-900">Decline</span>
        </div>
      </div>
    </div>
  );
}

/** The act's side of arrivals: the check-in buttons in the act app, just after arriving. */
export function CheckInSketch() {
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border border-white/10 bg-ink-900 p-3">
      <div className="rounded-[1.5rem] bg-ink-950 p-5">
        <p className="text-xs font-medium text-ink-400">Tonight · call time 18:30</p>
        <p className="mt-2 text-xl leading-tight font-semibold tracking-tight text-white">The Anchor, Leeds</p>
        <p className="mt-1 text-sm text-ink-400">19:00 to 22:00 · Your fee £150</p>
        <div className="mt-5 space-y-2">
          <span className="flex h-11 items-center justify-center rounded-xl border border-white/10 text-sm font-medium text-ink-400">I&apos;m on the way</span>
          <span className="flex h-11 items-center justify-center rounded-xl bg-volt-400 text-sm font-semibold text-ink-950">I&apos;ve arrived</span>
          <span className="flex h-11 items-center justify-center rounded-xl border border-white/10 text-sm font-medium text-ink-400">
            I&apos;ve left the venue
          </span>
        </div>
        <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-400/10 px-3.5 py-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
          <span className="text-sm leading-snug text-emerald-200">
            Arrived 18:18, 12 minutes early.
            <span className="block text-emerald-300/80">Verified at the venue.</span>
          </span>
        </div>
      </div>
    </div>
  );
}
