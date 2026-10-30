import type { Metadata } from "next";
import Link from "next/link";
import { ArrivalsSketch, Check, Container, Eyebrow, FinalCta, OfferSketch, RotaSketch } from "../site-ui";

export const metadata: Metadata = {
  title: "Features",
  description:
    "A tour of Gigsaw: the rota for weekly bar slots, offers acts accept by link, live arrivals, weddings and events, money and reports, the act app and importing from Overture.",
};

type Area = {
  id: string;
  nav: string;
  title: string;
  lead: string[];
  points: [string, string][];
  sketch?: React.ReactNode;
};

const AREAS: Area[] = [
  {
    id: "bookings",
    nav: "Bookings & rota",
    title: "Bookings and the rota",
    lead: [
      "Most agency work is the same venues, week after week. Gigsaw is built around that. Each venue has its own weekly music schedule, and the rota shows every venue's week on one screen.",
      "Booked slots show the act. Empty slots show in amber, so you can see the gaps at a glance and fill them before anyone notices.",
    ],
    sketch: <RotaSketch />,
    points: [
      [
        "Weekly slots on each venue",
        "Monday to Thursday 7pm to 9pm solo, Friday two sets: set each slot's times, fee, who pays, act type and regular act. Add the same slot to several days at once.",
      ],
      ["Book regulars", "Book every slot's regular act for 1 to 12 weeks in one go. Anything already booked is skipped, and nobody is ever double-booked."],
      [
        "Add a booking anywhere",
        "Add a one-off booking on any day of the rota, or tick “Every Thursday” to turn it into a weekly slot. Jump to any week with the date picker.",
      ],
      [
        "New booking from any page",
        "Press N, or use the button at the top. Act, date, venue, times, type, status, fee and who booked it. Venue is optional, for weddings and parties.",
      ],
      [
        "A warning before a double-booking",
        "If times overlap, or there isn't enough time to pack down and travel between venues, Gigsaw explains why and lets you save anyway or go back. It even checks across bands that share a member.",
      ],
      ["Change a slot, change its bookings", "New times or a new fee on a slot can be applied to every upcoming booking in it. Each act is told what changed."],
      [
        "Change or copy lots at once",
        "Tick several bookings to move their times or set a new fee. Copy a booking to as many dates as you like from a mini calendar.",
      ],
      [
        "Bookings without an act stand out",
        "A count in the menu, a banner on the dashboard and a “Needs an act” list on the rota, soonest first, each filled in one step.",
      ],
      ["Calendar and search", "Day, week and month views, coloured by venue or act. Search acts, venues, contacts and bookings from any page as you type."],
      [
        "Line-up links for venues",
        "Give each venue a private link showing who's playing and when, and who has arrived on the night. It never shows fees, contacts or other venues.",
      ],
    ],
  },
  {
    id: "offers",
    nav: "Offers",
    title: "Offers and confirmations",
    lead: [
      "Create the booking first and add the act when you have one. A pending booking sits in the calendar with its venue, date, times and money, marked “Needs an act” until it's filled.",
      "When you choose an act, send them an offer. They get the booking with their own fee only, and a private link to accept or decline. No login needed.",
    ],
    sketch: <OfferSketch />,
    points: [
      [
        "By email, text or phone notification",
        "Each act, or each member of a band, is offered the booking in the way that reaches them. Offers also show at the top of the act app.",
      ],
      ["Accept confirms the booking", "When an act accepts, the booking is confirmed and you get an email. They can accept several offers at once."],
      ["Declines don't get lost", "A decline sends you an email and a text. The booking stays as it is, ready to offer to someone else."],
      ["A clear list on the dashboard", "See every offer still waiting for an answer, and every one that's been turned down."],
      [
        "Straight from the rota",
        "Put every slot in the calendar as pending, offer each slot to its regular act, or book the regulars in as confirmed. Each empty slot has its own Offer and Confirm buttons.",
      ],
      [
        "Everyone told when it's confirmed",
        "The act is told they're booked. For weddings and private events, the customer is told too. Bar venues aren't sent these messages unless you want them.",
      ],
    ],
  },
  {
    id: "arrivals",
    nav: "Arrivals",
    title: "Arrivals, live",
    lead: [
      "This is the part of Gigsaw that's new. Every booking has an arrive-by time, the call or load-in time in the venue's own time zone. When the act gets there, they tap I've arrived on their phone.",
      "You see it on a live board. If the call time passes and nobody has checked in, Gigsaw tells you. You don't have to wait for the venue to ring.",
    ],
    sketch: <ArrivalsSketch tone="light" />,
    points: [
      [
        "Checked against the venue",
        "The phone shares its location, and Gigsaw measures the distance to the venue's map pin. Within 500 metres is verified at the venue. You can change the distance.",
      ],
      ["On time or late", "An arrival is on time if it's within a grace period of the call time, five minutes unless you change it. After that it's late."],
      [
        "A live board",
        "Every booking with a call time in the last 12 hours or the next 24: overdue, on the way with an arrival time, arrived on time, arrived late. It refreshes every 30 seconds.",
      ],
      [
        "Late alerts",
        "Gigsaw checks every minute. If an act is past their call time and the grace period with no check-in, the booking's agent gets an email and a text, plus an on-call number if you set one.",
      ],
      [
        "Customers kept in the loop",
        "When an act checks in, the booking's client gets a short email and text. Turn this off for the agency or for one booking.",
      ],
      ["Punctuality over time", "A punctuality table for every act over the last 12 months, and a feed of the latest check-ins. Export it all to CSV."],
      ["When the app isn't an option", "If an act can't use the app, an agent can log the arrival for them. It's clearly marked as logged by the agency."],
    ],
  },
  {
    id: "weddings",
    nav: "Weddings & events",
    title: "Weddings and private events",
    lead: [
      "A wedding is rarely one act. There's the ceremony singer, the band and the DJ, each with their own times and fees. In Gigsaw, the couple have one booking with every act on it.",
      "Each act gets its own booking, with what the customer pays for it and what the act is paid. The customer's total, payments and balance are added up across all of them, on one combined invoice.",
    ],
    points: [
      [
        "A planner link for the couple",
        "A private page, no login needed, for the running order, contact on the day, parking and load-in, dress code, food for the acts and song requests.",
      ],
      ["Shared with the acts, without the prices", "Acts see the planner on their booking page, along with who else is performing. They never see any prices."],
      [
        "Automatic emails on the right days",
        "The planner link eight weeks before, a reminder at three weeks if it's not filled in, a balance reminder in the last two weeks, final details to the acts a week before, and a thank-you with your review link the day after.",
      ],
      ["Sent at sensible times", "Every automatic email goes between 9am and 8pm, and only once. Change them for the agency or for one event."],
      [
        "A checklist for every event",
        "Contract, deposit, details from the couple, balance, final details to the acts, thank-you. Several tick themselves as things happen.",
      ],
      ["Payments shared out for you", "Take one payment from the couple and it's shared across the acts automatically."],
    ],
  },
  {
    id: "money",
    nav: "Money & reports",
    title: "Money and reports",
    lead: [
      "Every booking has three numbers: the sale (what the venue or client pays), the cost (what the act is paid) and the difference (what you make). Gigsaw works them out as you type.",
      "Your team sees everything. Acts only ever see their own pay.",
    ],
    points: [
      [
        "A booking fee you keep",
        "Add a fee on top of the act's fee, paid by the venue or client and kept in full by you. Set a default for weddings and events, or for every booking.",
      ],
      [
        "Who owes what",
        "See what venues and clients still owe, and what's still to pay each act, grouped by venue, client or act. Mark a whole group paid with one button.",
      ],
      [
        "Venue statements",
        "Pick a venue and a month. See every booking played there, what the venue owes and has paid, what each act was paid, and your margin.",
      ],
      ["Invoices that stay private", "Print an invoice for the venue's confirmed bookings in the period. It never shows what the acts are paid."],
      [
        "Reports for any dates",
        "What venues and clients paid, what each act earned and what you made, by day, week or month. A table per act, per venue and per private client.",
      ],
      ["Contracts and day sheets", "Printable contract, invoice and day sheet for every booking. Print them or save them as a PDF."],
      ["Deposits and VAT", "Record deposits and VAT on a booking. Overdue deposits are flagged on the booking and the dashboard."],
      ["Your data out, any time", "Export bookings, arrivals and reports to CSV."],
    ],
  },
  {
    id: "people",
    nav: "Acts & people",
    title: "Acts, people and venues",
    lead: [
      "Gigsaw keeps people, companies and acts together, the way they work in real life. A venue manager is simply a person at that venue. A musician can be in a duo, a band and their own solo act.",
      "Reminders and booking changes go to each member of an act, and double-booking checks follow the people, not just the act name.",
    ],
    points: [
      [
        "One person, several acts",
        "Each person can belong to any number of acts. With their own login, they see the bookings for every act they're in, labelled by act.",
      ],
      ["Bands made of acts", "Build a band from your existing solo acts. The solo acts see the band's bookings, and clashes are checked both ways."],
      ["Venues with the details that matter", "Address, capacity, time zone, weekly music schedule and the map pin used to check arrivals."],
      ["Contacts and notes", "Promoters, private customers, venue staff and anyone else, with tags, search and conversation notes."],
      [
        "New acts sign up with a link",
        "Send a private link to acts you'd like to take on. They fill in their details, video, a photo, their set list, usual fee and bank details. You approve or decline.",
      ],
      ["Your team", "Admins and agents, with an activity log on every booking so you can see who changed what."],
    ],
  },
  {
    id: "notifications",
    nav: "Notifications",
    title: "Emails, texts and reminders",
    lead: [
      "Gigsaw sends the messages you'd otherwise send by hand, in your agency's name. Replies go to you, not to a no-reply address.",
      "You decide what goes out. Switch any message off, or change its subject and wording.",
    ],
    points: [
      ["Acts told about changes", "If a date, time, venue or fee changes, the act gets an email and a text showing what it was and what it is now."],
      [
        "Booking reminders",
        "Each act gets a list of the coming week's bookings, on Sunday evening by default, and a reminder on the day. Change the days and times, or turn them off.",
      ],
      [
        "The right way to reach each act",
        "Reminders go as phone notifications once an act turns them on, and by email. Acts without phone notifications get a text instead.",
      ],
      [
        "Your words, your placeholders",
        "Edit any automatic message with placeholders like {first_name}, {act}, {venue} and {date}. The booking details and links are always added underneath.",
      ],
      ["Your own settings", "Each person on your team can switch emails or texts off for late acts, declined offers, accepted offers and planners coming in."],
      ["A full message log", "A log of every message Gigsaw has sent. Cancellations always go out, even if other messages are off."],
    ],
  },
  {
    id: "act-app",
    nav: "Act app",
    title: "The act app",
    lead: [
      "Your acts get their own app. It runs in the phone's browser and can be added to the home screen, so there's nothing to download from an app store.",
      "It shows them what they need for the booking and nothing they don't: their own fee, never what the venue pays.",
    ],
    points: [
      ["Their bookings and their pay", "Every upcoming booking, with times, venue directions, the itinerary and their own fee."],
      ["Offers at the top", "New offers sit at the top of the app, ready to accept or decline."],
      ["On the way, arrived, left", "Three buttons on the night: I'm on the way, I've arrived and I've left the venue."],
      ["Phone reminders", "One tap turns on phone notifications. On iPhone, the app shows how to add Gigsaw to the home screen first."],
      ["In their own calendar", "Acts add their bookings to Apple, Google or Outlook calendar once, and it keeps itself up to date."],
      ["Wedding details", "For weddings and events, acts see the couple's planner and who else is performing."],
    ],
  },
  {
    id: "imports",
    nav: "Imports",
    title: "Importing from Overture",
    lead: [
      "If you're moving from Overture, export your contacts as a CSV file and upload it in Gigsaw. It reads the file and puts everything where it belongs.",
      "Right now the import covers contacts. Bookings don't come across yet, but with your venues' weekly slots set up, Book regulars fills the weeks ahead in a few clicks.",
    ],
    points: [
      ["Acts with their members", "Acts come across with their people linked as members. Someone in two acts is linked to both."],
      ["Venues with their staff", "Companies with an address or a venue tag become venues, with their staff linked to them."],
      ["Companies and customers", "Other companies go under Companies and customers. People tagged as customers become private customers."],
      [
        "Safe to run again",
        "Anything already in Gigsaw with the same name is matched, and only blank details are filled in. Nothing you've typed is overwritten.",
      ],
      [
        "Try it with demo data",
        "Load a sample bar-circuit agency with acts, venues, bookings and live arrivals, look around, then remove it in one click. Demo data never sends messages.",
      ],
    ],
  },
];

function Lead({ paragraphs, className = "" }: { paragraphs: string[]; className?: string }) {
  return (
    <div className={`space-y-5 text-lg leading-relaxed text-ink-700 ${className}`}>
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <section>
        <Container className="pt-14 pb-12 sm:pt-24 sm:pb-16">
          <Eyebrow>Features</Eyebrow>
          <h1 className="mt-5 max-w-4xl text-[42px] text-balance leading-[0.98] font-semibold tracking-[-0.045em] sm:text-7xl">
            How Gigsaw works, area by area.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-700 sm:text-xl">
            Gigsaw is built for agencies that book live music: weekly slots at bars and pubs, weddings, and private events. Here&apos;s everything it does, in
            plain words.
          </p>
        </Container>
      </section>

      {/* Sticky jump links. On phones they scroll sideways rather than wrapping into a tall block. */}
      <nav aria-label="Feature areas" className="sticky top-16 z-30 border-y border-ink-200/70 bg-white/90 backdrop-blur-md">
        <Container className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {AREAS.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="shrink-0 rounded-full border border-ink-200 px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
            >
              {a.nav}
            </a>
          ))}
        </Container>
      </nav>

      {AREAS.map((a, i) => (
        <section key={a.id} id={a.id} className={`scroll-mt-32 ${i % 2 ? "bg-ink-50" : "bg-white"} ${i ? "border-t border-ink-200/70" : ""}`}>
          <Container className="py-20 sm:py-24">
            {/* With a sketch, the words sit beside it. Without one, the heading and words sit side by side instead. */}
            <div className={`grid gap-12 lg:gap-20 ${a.sketch ? "lg:grid-cols-[1.15fr_1fr]" : "lg:grid-cols-[1fr_1.2fr]"}`}>
              <div>
                <p className="text-sm font-semibold text-ink-500">{String(i + 1).padStart(2, "0")}</p>
                <h2 className="mt-3 text-4xl leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">{a.title}</h2>
                {a.sketch && <Lead paragraphs={a.lead} className="mt-7" />}
              </div>
              {a.sketch ? (
                <div className={`self-center ${a.id === "bookings" ? "rounded-[1.75rem] bg-ink-950 p-3 sm:p-4" : ""}`}>{a.sketch}</div>
              ) : (
                <Lead paragraphs={a.lead} className="-mt-5 lg:mt-8" />
              )}
            </div>
            <ul className="mt-14 grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {a.points.map(([title, body]) => (
                <li key={title} className="flex gap-3.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-volt-400 text-ink-950">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{title}</h3>
                    <p className="mt-1.5 leading-relaxed text-ink-600">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ))}

      <section className="border-t border-ink-200/70">
        <Container className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">What Gigsaw doesn&apos;t do yet</h2>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-700">
            We&apos;d rather tell you now. There are no e-signatures, no taking card payments from your clients, no public API or Zapier, no two-factor sign-in
            and no native iPhone or Android app yet. The act app works in the phone&apos;s browser instead. See{" "}
            <Link href="/pricing" className="link">
              pricing
            </Link>{" "}
            for what each plan includes.
          </p>
        </Container>
      </section>

      <FinalCta title="See it with your own venues and acts." />
    </>
  );
}
