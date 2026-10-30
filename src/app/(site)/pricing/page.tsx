import type { Metadata } from "next";
import Link from "next/link";
import { loadCatalogue } from "@/lib/plan-store";
import { choosablePlans, featuredPlan, type Catalogue } from "@/lib/plans";
import { price } from "../format";
import { Check, Container, Cross, Eyebrow, FinalCta } from "../site-ui";
import { PricingTable } from "./pricing-table";

// Prices come from the Owner area → Plans: the page is rebuilt at most every five minutes, and straight away when they change.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { trialDays } = await loadCatalogue();
  return {
    title: "Pricing",
    description: `Gigsaw plans are based on how many bookings you make in a month. Acts, venue managers and customers are free. Try free for ${trialDays} days.`,
  };
}

// Mirrors isBillable in src/lib/billing.ts. Keep the two in step if the rules change.
const COUNTS = [
  "It's confirmed, or settled.",
  "The act checked in at the booking, whatever its status.",
  "It was left on hold, pending or awaiting confirmation with an act on it, and its date has passed.",
];
const NEVER = [
  "Cancelled bookings.",
  "Enquiries, unless the act checks in.",
  "Pending bookings that never got an act.",
  "Demo data, which you can load and remove to try Gigsaw out.",
];

function faq(c: Catalogue, plans: Catalogue["plans"]): [string, React.ReactNode][] {
  const limited = plans.filter((p) => p.gigsPerMonth !== null);
  const largest = limited.sort((a, b) => (a.gigsPerMonth ?? 0) - (b.gigsPerMonth ?? 0)).slice(-1)[0];
  const unlimited = plans.find((p) => p.gigsPerMonth === null);
  return [
    [
      "What's an internal user?",
      <>
        Internal users are the people in your agency who sign in to run things: your admins and agents. Each plan includes some, and each extra one is{" "}
        {price(c.extraUserMonthlyMinor)} a month, or {price(c.extraUserYearlyMinor)} a year on a yearly plan.
      </>,
    ],
    [
      "Do acts, venue managers and customers cost anything?",
      <>
        No. They&apos;re external users, and they&apos;re always free, however many you have. Acts get their own app login, venues get their line-up link and
        couples get their planner link at no extra cost.
      </>,
    ],
    ["Can I change plan?", <>Yes. Move up or down a plan whenever you like.</>],
    [
      "What happens if I go over my bookings?",
      <>
        Nothing stops working. Bookings keep booking, acts keep checking in. If you go over your plan&apos;s bookings, we&apos;ll suggest the plan that fits
        {largest && unlimited ? (
          <>
            , and above {largest.gigsPerMonth} bookings a month the {unlimited.name} plan has no limit
          </>
        ) : null}
        .
      </>,
    ],
    [
      "How does the free trial work?",
      <>Try Gigsaw free for {c.trialDays} days. Load the demo data to look around, or start with your own venues and acts straight away.</>,
    ],
    ["Can I cancel?", <>Yes, any time. If you want a copy of your data first, export it to CSV.</>],
    ["Can I get my data out?", <>Yes. Export your bookings, arrivals and reports to CSV whenever you like. Your data is yours.</>],
    [
      "I'm moving from Overture. Can you help?",
      <>
        Export your contacts from Overture as a CSV file and import it into Gigsaw: acts, members, venues, staff, companies and customers all come across. The
        Agency plan includes help moving across.{" "}
        <Link href="/features#imports" className="link">
          More about importing
        </Link>
        .
      </>,
    ],
    ["Where is Gigsaw made?", <>In the UK. Prices are in pounds.</>],
  ];
}

export default async function PricingPage() {
  const catalogue = await loadCatalogue();
  const plans = choosablePlans(catalogue.plans);
  const FAQ = faq(catalogue, plans);
  const featured = featuredPlan(catalogue.plans)?.key ?? null;
  const trialDays = catalogue.trialDays;
  return (
    <>
      <section>
        <Container className="pt-14 pb-16 sm:pt-24 sm:pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mt-5 text-[42px] text-balance leading-[0.98] font-semibold tracking-[-0.045em] sm:text-7xl">Priced by the bookings you make.</h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-ink-700 sm:text-xl">
              Pick a plan by how many bookings you make in a month. Your acts, venue managers and customers are always free. Try free for {trialDays} days.
            </p>
          </div>
          <div className="mt-14">
            <PricingTable
              plans={plans}
              featured={featured}
              extraUserMonthlyMinor={catalogue.extraUserMonthlyMinor}
              extraUserYearlyMinor={catalogue.extraUserYearlyMinor}
              trialDays={trialDays}
            />
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-200/70 bg-ink-50">
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
          <div>
            <Eyebrow>What counts as a booking</Eyebrow>
            <h2 className="mt-4 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Only bookings that happen.</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-700">
              <p>
                A booking is one act playing one booking. A wedding with a ceremony singer, a band and a DJ is three bookings, because each act has its own
                booking.
              </p>
              <p>
                Bookings are counted in the month they take place, not the month you booked them. Archiving a booking that happened doesn&apos;t stop it
                counting.
              </p>
            </div>
          </div>
          <div className="grid gap-4 self-center sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-ink-200/80 bg-white p-6">
              <p className="font-semibold">A booking counts if any of these is true</p>
              <ul className="mt-4 space-y-3">
                {COUNTS.map((c) => (
                  <li key={c} className="flex gap-3 leading-snug text-ink-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-volt-400 text-ink-950">
                      <Check className="h-3 w-3" />
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-ink-200/80 bg-white p-6">
              <p className="font-semibold">These never count</p>
              <ul className="mt-4 space-y-3">
                {NEVER.map((c) => (
                  <li key={c} className="flex gap-3 leading-snug text-ink-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                      <Cross className="h-3 w-3" />
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section>
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
          <div>
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-4 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-5xl">Good questions.</h2>
          </div>
          <div className="divide-y divide-ink-200 border-y border-ink-200">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                  {q}
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xl leading-none transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 text-[17px] leading-relaxed text-ink-700">{a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      <FinalCta title={`Try Gigsaw free for ${trialDays} days.`} pricingLink={false} trialDays={trialDays} />
    </>
  );
}
