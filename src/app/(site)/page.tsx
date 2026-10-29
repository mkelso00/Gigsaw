import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import { price } from "./format";
import { ArrivalsSketch, ArrowRight, CheckInSketch, Container, Cross, Eyebrow, FinalCta, Marker, OfferSketch, RotaSketch } from "./site-ui";

export const metadata: Metadata = {
  title: { absolute: "Gigsaw: booking software for music agencies" },
  description:
    "Gigsaw runs your weekly bar slots, weddings and private events in one place. Acts accept gigs by link, check in when they arrive, and you see it all live.",
};

const PAINS = [
  "The rota lives in a spreadsheet that only one person really understands.",
  "Offers go out on WhatsApp, and the replies get lost under everything else.",
  "You chase acts for a yes, then chase them again for their availability.",
  "At 7pm on a Friday you have no idea if the act has turned up, until the venue rings.",
  "Working out what each venue owes, and what each act is due, takes an afternoon.",
];

const STEPS = [
  {
    title: "Set up your venues and their slots",
    body: "Add each venue with its weekly music: Thursday 7pm to 10pm solo, Friday and Saturday 9pm to midnight duo. Put in the fee, who pays and the regular act if there is one. Moving from Overture? Import your contacts first.",
  },
  {
    title: "Fill the rota",
    body: "The rota shows every venue's week on one screen, with empty slots in amber. Book the regulars for the next twelve weeks in one go, then fill the gaps one by one. Gigsaw warns you before anyone is double-booked.",
  },
  {
    title: "Send offers and let acts say yes",
    body: "Each act gets an email, text or phone notification with the gig and their own fee, plus a link to accept or decline. No login, no app store. When they accept, the gig confirms itself and you get an email.",
  },
  {
    title: "Watch them arrive, then get paid",
    body: "On the night, acts tap I've arrived on their phone. You see it live, and you're alerted if anyone is late. Afterwards, send venues their statements and invoices and mark acts as paid.",
  },
];

const HIGHLIGHTS = [
  {
    id: "bookings",
    title: "A rota for weekly bar slots",
    body: "Every venue's slots on one week grid. Empty slots stand out. Book each slot's regular act for up to 12 weeks in a single click.",
  },
  {
    id: "offers",
    title: "Offers acts accept by link",
    body: "Acts get the gig and their own fee, never yours, with Accept and Decline buttons. Several offers can be accepted at once.",
  },
  {
    id: "arrivals",
    title: "Live arrivals and late alerts",
    body: "A live board of tonight's gigs: on the way, arrived, late or overdue. Late acts trigger an email and text to the agent.",
  },
  {
    id: "weddings",
    title: "Weddings and private events",
    body: "One booking for the couple with every act on it, one combined invoice, a planner link for the couple and automatic emails on the right days.",
  },
  {
    id: "money",
    title: "Sale, cost and profit",
    body: "Every booking shows what the venue or client pays, what the act is paid and what you make. Add a booking fee that you keep in full.",
  },
  {
    id: "money",
    title: "Venue statements and invoices",
    body: "Pick a venue and a month. See every gig played, what's owed and what's been paid, then print an invoice that never shows the acts' fees.",
  },
  {
    id: "act-app",
    title: "An app for your acts",
    body: "Acts see their gigs, directions and their own pay on their phone, accept offers, get reminders and add every gig to their calendar.",
  },
  {
    id: "imports",
    title: "Import from Overture",
    body: "Bring your acts, people, venues and customers across from an Overture contacts export. Run it again safely at any time.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="overflow-hidden">
        <Container className="pt-14 pb-16 sm:pt-24 sm:pb-24">
          <Eyebrow>Booking software for music agencies</Eyebrow>
          <h1 className="mt-5 max-w-5xl text-[44px] leading-[0.98] font-semibold tracking-[-0.045em] sm:text-7xl lg:text-[88px]">
            Every gig booked, confirmed and <Marker>on time.</Marker>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-700 sm:text-xl">
            Gigsaw runs your weekly bar slots, weddings and private events in one place. Acts accept gigs with a tap, check in when they arrive, and you see it
            all as it happens. No more spreadsheets, group chats or Friday night phone calls.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className="btn btn-volt h-12 px-6 text-base">
              Try it free
              <ArrowRight />
            </Link>
            <Link href="/pricing" className="btn h-12 px-6 text-base">
              See pricing
            </Link>
            <p className="text-sm text-ink-500 sm:ml-3">Free for {TRIAL_DAYS} days. Made in the UK.</p>
          </div>

          <div className="mt-16 rounded-[1.75rem] bg-ink-950 p-3 sm:mt-20 sm:p-5">
            <div className="grid gap-3 sm:gap-5 lg:grid-cols-[1.35fr_1fr]">
              <RotaSketch />
              <ArrivalsSketch />
            </div>
          </div>
        </Container>
      </section>

      {/* The problem */}
      <section className="border-t border-ink-200/70 bg-ink-50">
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="mt-4 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Running an agency shouldn&apos;t feel like juggling.</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-700">
              <p>
                Most music agencies are run from a spreadsheet, a WhatsApp group, an inbox and somebody&apos;s memory. It works, mostly. Until a slot goes
                unfilled, an act forgets, or a venue manager rings to ask where the music is.
              </p>
              <p>
                Gigsaw puts the whole job in one place: the slots, the acts, the offers, the arrivals and the money. Everyone sees what they need, and nobody
                sees what they shouldn&apos;t.
              </p>
            </div>
          </div>
          <ul className="space-y-3 self-center">
            {PAINS.map((p) => (
              <li key={p} className="flex gap-4 rounded-2xl border border-ink-200/80 bg-white p-5 text-[17px] leading-snug text-ink-800">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                  <Cross className="h-3.5 w-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* How it works */}
      <section>
        <Container className="py-20 sm:py-28">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">From empty slot to paid gig, in four steps.</h2>
          <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-volt-400 text-lg font-semibold text-ink-950">{i + 1}</span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-ink-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Arrivals spotlight */}
      <section className="bg-ink-950 text-white">
        <Container className="grid items-center gap-14 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="text-sm font-semibold tracking-tight text-volt-400">Live arrivals</p>
            <h2 className="mt-4 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Know the act is there before the venue does.</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-300">
              <p>
                When an act gets to the venue, they tap <strong className="font-semibold text-white">I&apos;ve arrived</strong> in the Gigsaw app. Their phone
                shares its location, and Gigsaw checks it against the venue's map pin.
              </p>
              <p>
                Your live board shows every gig tonight: who&apos;s on the way and when they&apos;ll get there, who&apos;s arrived, who&apos;s late. If the call
                time passes with no check-in, the agent gets an email and a text. Over time you build up a punctuality record for every act.
              </p>
            </div>
            <Link href="/features#arrivals" className="mt-8 inline-flex items-center gap-2 font-medium text-volt-400 hover:text-volt-300">
              How arrivals work
              <ArrowRight />
            </Link>
          </div>
          <CheckInSketch />
        </Container>
      </section>

      {/* Feature highlights */}
      <section>
        <Container className="py-20 sm:py-28">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Eyebrow>What&apos;s in it</Eyebrow>
              <h2 className="mt-4 max-w-2xl text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Everything an agency does, in one place.</h2>
            </div>
            <Link href="/features" className="inline-flex shrink-0 items-center gap-2 font-medium text-ink-950 hover:text-ink-600">
              See every feature
              <ArrowRight />
            </Link>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
            {HIGHLIGHTS.map((h) => (
              <Link key={h.title} href={`/features#${h.id}`} className="group flex flex-col bg-white p-6 transition-colors hover:bg-ink-50 sm:p-7">
                <h3 className="text-lg leading-snug font-semibold tracking-tight">{h.title}</h3>
                <p className="mt-3 flex-1 leading-relaxed text-ink-600">{h.body}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 group-hover:text-ink-950">
                  Read more
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* Offers */}
      <section className="border-t border-ink-200/70 bg-ink-50">
        <Container className="grid items-center gap-14 py-20 sm:py-28 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <Eyebrow>Offers</Eyebrow>
            <h2 className="mt-4 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Stop chasing acts for a yes.</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-700">
              <p>
                Put the gig in the calendar first, even before you know who&apos;s playing. When you&apos;ve picked an act, send them an offer. They get a
                message with the date, the venue, the times and their own fee, and a private link with two buttons.
              </p>
              <p>
                If they accept, the gig is confirmed, it shows up in their app and you get an email. If they decline, you get an email and a text, and the gig
                stays put so you can offer it to someone else. The dashboard always shows which offers are still waiting.
              </p>
            </div>
          </div>
          <OfferSketch />
        </Container>
      </section>

      {/* Moving from Overture */}
      <section>
        <Container className="py-20 sm:py-28">
          <div className="grid gap-10 rounded-3xl border border-ink-200 p-6 sm:p-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <div>
              <Eyebrow>Moving from Overture?</Eyebrow>
              <h2 className="mt-4 text-3xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-4xl">Bring your contacts with you.</h2>
            </div>
            <div className="space-y-5 text-lg leading-relaxed text-ink-700">
              <p>
                Export your contacts from Overture as a CSV file and upload it to Gigsaw. Your acts come across with their members linked. Venues come across
                with their staff. Promoters and other companies, and your private customers, land in the right place too.
              </p>
              <p>
                If something is already in Gigsaw with the same name, it&apos;s matched rather than copied, and only blank details are filled in. So you can
                import the same file again without making a mess.
              </p>
              <p className="text-base text-ink-500">
                The import covers contacts. Bookings don&apos;t come across yet: add each venue&apos;s weekly slots and use Book regulars to fill the weeks
                ahead.
              </p>
              <Link href="/features#imports" className="inline-flex items-center gap-2 text-base font-medium text-ink-950 hover:text-ink-600">
                More about importing
                <ArrowRight />
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-ink-200/70 bg-ink-50">
        <Container className="py-20 sm:py-28">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-4 max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">
            Pay for the gigs you book. Your acts are free.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-700">
            Pick a plan by how many gigs you book in a month. Acts, venue managers and customers never cost anything, however many you have.
          </p>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.key} className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-7">
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="mt-4">
                  <span className="text-4xl font-semibold tracking-tight">{price(p.monthlyMinor)}</span>
                  <span className="text-ink-500"> a month</span>
                </p>
                <p className="mt-3 text-ink-600">{p.gigsPerMonth === null ? "Unlimited gigs" : `Up to ${p.gigsPerMonth} gigs a month`}</p>
              </div>
            ))}
          </div>
          <Link href="/pricing" className="mt-8 inline-flex items-center gap-2 font-medium text-ink-950 hover:text-ink-600">
            Compare the plans
            <ArrowRight />
          </Link>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
