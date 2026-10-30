import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import { price } from "./format";
import { HeroWord } from "./hero-word";
import {
  DeskWindow,
  FactsStrip,
  FeatureCard,
  KindCards,
  LiveSketch,
  MoneySketch,
  OffersSketch,
  PhoneSketch,
  SoundWaves,
  StepLights,
  WeddingSketch,
} from "./home-parts";
import { ArrowRight, Container, Cross, Eyebrow, FinalCta } from "./site-ui";

export const metadata: Metadata = {
  title: { absolute: "Gigsaw: booking software for music agencies" },
  description:
    "Gigsaw runs your weekly bar slots, weddings and private events in one place. Acts accept bookings by link, check in when they arrive, and you see it all live.",
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
    body: "Each act gets an email, text or phone notification with the booking and their own fee, plus a link to accept or decline. No login, no app store. When they accept, the booking confirms itself and you get an email.",
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
    body: "Acts get the booking and their own fee, never yours, with Accept and Decline buttons. Several offers can be accepted at once.",
  },
  {
    id: "arrivals",
    title: "Live arrivals and late alerts",
    body: "A live board of tonight's bookings: on the way, arrived, late or overdue. Late acts trigger an email and text to the agent.",
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
    body: "Pick a venue and a month. See every booking played, what's owed and what's been paid, then print an invoice that never shows the acts' fees.",
  },
  {
    id: "act-app",
    title: "An app for your acts",
    body: "Acts see their bookings, directions and their own pay on their phone, accept offers, get reminders and add every booking to their calendar.",
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
      {/* Hero: words on the left, the agency's screen and an act's phone on the right, on a grid of pulsing dots. */}
      <section className="relative overflow-hidden bg-ink-50">
        <div aria-hidden className="dot-grid absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]" />
        <div aria-hidden className="dot-ripple absolute inset-0" />
        <SoundWaves className="absolute inset-x-0 -bottom-6 h-40 opacity-50 sm:h-56" />
        <Container className="relative grid items-center gap-14 pt-14 pb-20 sm:pt-20 sm:pb-28 lg:grid-cols-[1fr_1.08fr] lg:gap-12">
          <div>
            <Eyebrow>Booking software for music agencies</Eyebrow>
            <h1 className="mt-5 text-[40px] leading-[1.04] font-bold tracking-[-0.025em] sm:text-6xl lg:text-[62px]">
              Every booking
              <br />
              <HeroWord />
              <br />
              without the chasing.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600">
              Weekly bar slots, weddings and private events in one place. Acts accept with a tap, check in when they arrive, and you see it all as it happens.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/signup" className="btn btn-primary h-12 px-6 text-base">
                Try it free
                <ArrowRight />
              </Link>
              <Link href="/pricing" className="btn h-12 px-6 text-base">
                See pricing
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
              <StepLights />
              <p className="font-mono text-[11px] tracking-[0.1em] whitespace-nowrap text-ink-500 uppercase">Free for {TRIAL_DAYS} days · Made in the UK</p>
            </div>
          </div>
          <div className="relative pb-8 sm:pr-10 lg:pr-12">
            <DeskWindow />
            <div className="float-slow absolute -right-1 -bottom-6 hidden sm:block lg:-right-4">
              <PhoneSketch />
            </div>
          </div>
        </Container>
      </section>

      <FactsStrip />

      {/* Who it's for */}
      <section>
        <Container className="py-20 sm:py-28">
          <h2 data-reveal className="max-w-4xl text-3xl leading-[1.12] font-bold tracking-[-0.02em] sm:text-[44px]">
            Built for every kind of booking. <span className="text-ink-400">Residencies, weddings and corporate work, all on one desk.</span>
          </h2>
          <div className="mt-12">
            <KindCards />
          </div>
        </Container>
      </section>

      {/* What's in it */}
      <section className="border-t border-ink-200 bg-ink-50">
        <Container className="py-20 sm:py-28">
          <h2 data-reveal className="max-w-4xl text-3xl leading-[1.12] font-bold tracking-[-0.02em] sm:text-[44px]">
            Everything an agency does. <span className="text-ink-400">From the first offer to the last invoice, in one place.</span>
          </h2>
          <div className="mt-12 grid gap-4 lg:grid-cols-5">
            <FeatureCard
              label="Offers"
              title="Acts say yes with one tap. No more chasing."
              href="/features#offers"
              className="lg:col-span-3"
              wash="bg-volt-300"
            >
              <OffersSketch />
            </FeatureCard>
            <FeatureCard
              label="Arrivals"
              title="Know they're there before the venue does."
              href="/features#arrivals"
              className="lg:col-span-2"
              wash="bg-cue-400"
            >
              <LiveSketch />
            </FeatureCard>
            <FeatureCard
              label="Money"
              title="Sale, cost and what you make, on every booking."
              href="/features#money"
              className="lg:col-span-2"
              wash="bg-volt-400"
            >
              <MoneySketch />
            </FeatureCard>
            <FeatureCard label="Weddings" title="One booking, every act, one invoice." href="/features#weddings" className="lg:col-span-3" wash="bg-cue-400">
              <WeddingSketch />
            </FeatureCard>
          </div>
          <div data-reveal className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
            {HIGHLIGHTS.filter((h) => ["bookings", "act-app", "imports"].includes(h.id) || h.title.startsWith("Venue")).map((h) => (
              <Link key={h.title} href={`/features#${h.id}`} className="group bg-white p-5 transition-colors hover:bg-ink-50">
                <h3 className="flex items-center justify-between gap-3 font-semibold">
                  {h.title}
                  <ArrowRight className="h-3.5 w-3.5 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-950" />
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{h.body}</p>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* The problem */}
      <section>
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div data-reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="mt-4 text-3xl leading-[1.08] font-bold tracking-[-0.02em] sm:text-[44px]">Running an agency shouldn&apos;t feel like juggling.</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-600">
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
            {PAINS.map((p, i) => (
              <li
                key={p}
                data-reveal
                style={{ transitionDelay: `${i * 80}ms` }}
                className="flex gap-4 rounded-xl border border-ink-200 bg-white p-5 text-[17px] leading-snug text-ink-800"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cue-100 text-cue-700">
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
          <h2 className="mt-4 max-w-3xl text-4xl leading-[1.04] font-bold tracking-[-0.02em] sm:text-5xl">From empty slot to paid booking, in four steps.</h2>
          <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} data-reveal style={{ transitionDelay: `${i * 100}ms` }}>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink-950 font-mono text-base font-semibold text-volt-300">
                  0{i + 1}
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-ink-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Moving from Overture */}
      <section>
        <Container className="py-20 sm:py-28">
          <div className="grid gap-10 rounded-3xl border border-ink-200 p-6 sm:p-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <div>
              <Eyebrow>Moving from Overture?</Eyebrow>
              <h2 className="mt-4 text-3xl leading-[1.08] font-bold tracking-[-0.02em] sm:text-4xl">Bring your contacts with you.</h2>
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
          <h2 className="mt-4 max-w-3xl text-4xl leading-[1.04] font-bold tracking-[-0.02em] sm:text-5xl">
            Pay for the bookings you make. Your acts are free.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-700">
            Pick a plan by how many bookings you make in a month. Acts, venue managers and customers never cost anything, however many you have.
          </p>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.key} className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-7">
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="mt-4">
                  <span className="text-4xl font-semibold tracking-tight">{price(p.monthlyMinor)}</span>
                  <span className="text-ink-500"> a month</span>
                </p>
                <p className="mt-3 text-ink-600">{p.gigsPerMonth === null ? "Unlimited bookings" : `Up to ${p.gigsPerMonth} bookings a month`}</p>
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
