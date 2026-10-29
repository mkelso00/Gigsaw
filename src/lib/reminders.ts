import "server-only";
import { Prisma } from "@prisma/client";
import { LIVE_STATUSES } from "./constants";
import { prisma } from "./db";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { recipientsForActs, type Recipient } from "./people";
import { dayReminderAt, partOfDay, weeklyReminderWeek } from "./reminder-time";
import { addDaysToKey, formatDate, localDateKey, localTime, zonedToUtc } from "./time";

// Gig reminders, run by the scheduler every minute:
//  - Weekly: the coming week's gigs, on the agency's chosen day and time.
//  - On the day: "don't forget your gig this evening".
// They go to each act's members (one message per person, covering all their acts), or to the
// act itself when it has no members. Each goes by phone notification (where turned on) and
// email; texts go only to people without phone notifications, to keep text costs down.
// Every reminder is claimed in the Reminder table before sending, so it only ever goes once.
// Demo data, enquiries and cancelled gigs never send anything. Reminders never mention money.

const HOUR = 3_600_000;

const gigInclude = {
  artist: { select: { name: true } },
  venue: { select: { name: true, city: true } },
  agent: { select: { email: true } },
} satisfies Prisma.BookingInclude;
type Gig = Prisma.BookingGetPayload<{ include: typeof gigInclude }>;

/** Claim a reminder. False if it has already been sent (or another server just claimed it). */
async function claim(kind: "WEEK" | "DAY", recipient: string, key: string) {
  try {
    await prisma.reminder.create({ data: { kind, recipient, key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

const where = (b: Gig) => b.venue?.name ?? "Venue to be confirmed";
const times = (b: Gig) =>
  `arrive ${localTime(b.arriveBy, b.timezone)}, on ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`;
const held = (b: Gig) => (b.status === "HOLD" || b.status === "PENDING" ? " (not confirmed yet)" : "");

/** Group gigs by who should hear about them. */
async function byRecipient(gigs: Gig[]) {
  const recipients = await recipientsForActs(gigs.map((g) => g.artistId));
  const out = new Map<string, { to: Recipient; gigs: Gig[] }>();
  for (const g of gigs) {
    for (const r of recipients.get(g.artistId) ?? []) {
      const entry = out.get(r.key) ?? { to: r, gigs: [] };
      entry.gigs.push(g);
      out.set(r.key, entry);
    }
  }
  return [...out.values()];
}

type Delivery = {
  to: Recipient;
  kind: "WEEK" | "DAY";
  gigs: Gig[];
  agencyName: string;
  agencyEmail: string;
  title: string;
  intro: string;
  url: string;
  ttlSeconds: number;
};

async function deliver(d: Delivery) {
  const first = d.gigs[0];
  // Members (and anyone in more than one act) need to know which act each gig is for.
  const named = d.to.isMember || new Set(d.gigs.map((g) => g.artistId)).size > 1;
  const label = (b: Gig) => `${named ? `${b.artist.name} at ` : ""}${where(b)}`;
  const lines = d.gigs.map((b) =>
    d.kind === "WEEK"
      ? `${formatDate(b.arriveBy, b.timezone).split(" ")[0]} ${label(b)} ${localTime(b.arriveBy, b.timezone)}`
      : `${label(b)}: ${times(b)}${held(b)}`,
  );
  const base = { kind: "REMINDER" as const, agencyId: first.agencyId, bookingId: d.gigs.length === 1 ? first.id : null };

  const reached = d.to.userId
    ? await sendPush({
        ...base,
        userId: d.to.userId,
        payload: { title: d.title, body: lines.join(d.kind === "WEEK" ? " · " : ". "), url: d.url, tag: `${d.kind}-${first.id}` },
        ttlSeconds: d.ttlSeconds,
      })
    : 0;

  for (const to of d.to.emails) {
    await sendEmail({
      ...base,
      to,
      replyTo: first.agent?.email || d.agencyEmail,
      subject: d.title,
      email: {
        brand: d.agencyName,
        preheader: lines.join(" · "),
        title: d.title,
        intro: d.intro,
        rows: d.gigs.map((b) => [formatDate(b.arriveBy, b.timezone), `${label(b)}${b.venue?.city ? `, ${b.venue.city}` : ""}${held(b)}\n${times(b)}`]),
        cta: d.to.userId ? { label: "Open my gigs", url: `${appUrl()}${d.url}` } : undefined,
        outro: `Can't make one? Reply to this email to let ${d.agencyName} know.`,
      },
    });
  }
  if (!reached && d.to.phone) {
    const link = d.to.userId ? ` ${appUrl()}${d.url}` : "";
    await sendSms({ ...base, to: d.to.phone, text: `${d.agencyName}: ${d.title}. ${lines.join("; ")}.${link}` });
  }
}

/** Send any weekly or on-the-day reminders that are due. Safe to run as often as you like. */
export async function runReminders(now = new Date()) {
  const agencies = await prisma.agency.findMany({
    where: { status: "ACTIVE", settings: { OR: [{ weeklyReminders: true }, { dayReminders: true }] } },
    include: { settings: true },
  });
  let weekly = 0;
  let daily = 0;

  for (const agency of agencies) {
    const s = agency.settings!;
    const agencyName = s.agencyName || agency.name;
    const base = { agencyId: agency.id, demo: false, status: { in: LIVE_STATUSES }, artist: { demo: false } };

    // ---- Weekly ----
    const week = s.weeklyReminders ? weeklyReminderWeek(now, s.defaultTimezone, s.weeklyReminderDay, s.weeklyReminderTime) : null;
    if (week) {
      const from = zonedToUtc(week, "00:00", s.defaultTimezone);
      const to = zonedToUtc(addDaysToKey(week, 7), "00:00", s.defaultTimezone);
      const gigs = await prisma.booking.findMany({
        where: { ...base, arriveBy: { gte: from > now ? from : now, lt: to } },
        include: gigInclude,
        orderBy: { arriveBy: "asc" },
      });
      for (const { to: who, gigs: list } of await byRecipient(gigs)) {
        if (!(await claim("WEEK", who.key, week))) continue;
        const n = list.length;
        const thisWeek = week === localDateKey(now, s.defaultTimezone);
        await deliver({
          to: who,
          kind: "WEEK",
          gigs: list,
          agencyName,
          agencyEmail: s.agencyEmail,
          title: `Your ${n === 1 ? "gig" : `${n} gigs`} ${thisWeek ? "this" : "next"} week`,
          intro: `Hi ${who.firstName}, here are your gigs for the week starting ${formatDate(from, s.defaultTimezone)}. Times are when to arrive and when you're on.`,
          url: "/app",
          ttlSeconds: 24 * 3600,
        });
        weekly++;
      }
    }

    // ---- On the day ----
    if (s.dayReminders) {
      const soon = await prisma.booking.findMany({
        where: { ...base, arriveBy: { gt: now, lte: new Date(now.getTime() + 20 * HOUR) }, checkIns: { none: { kind: "ARRIVED" } } },
        include: gigInclude,
        orderBy: { arriveBy: "asc" },
      });
      for (const { to: who, gigs } of await byRecipient(soon)) {
        const days = new Map<string, Gig[]>();
        for (const g of gigs) {
          const day = localDateKey(g.arriveBy, g.timezone);
          days.set(day, [...(days.get(day) ?? []), g]);
        }
        for (const [day, list] of days) {
          // Due once the first gig's reminder time has passed, unless it was booked after that
          // time (they've just been told about it).
          const due = list.some((g) => {
            const at = dayReminderAt(g.arriveBy, g.timezone, s.dayReminderTime);
            return at <= now && g.createdAt <= at;
          });
          if (!due || !(await claim("DAY", who.key, day))) continue;
          const first = list[0];
          await deliver({
            to: who,
            kind: "DAY",
            gigs: list,
            agencyName,
            agencyEmail: s.agencyEmail,
            title: list.length > 1 ? `Don't forget: ${list.length} gigs today` : `Don't forget your gig ${partOfDay(first.arriveBy, first.timezone)}`,
            intro: `Hi ${who.firstName}, a reminder about ${list.length > 1 ? "your gigs" : "your gig"} today. Remember to tap "I've arrived" in the app when you get there.`,
            url: list.length > 1 ? "/app" : `/app/gigs/${first.id}`,
            ttlSeconds: Math.max(600, Math.round((first.arriveBy.getTime() - now.getTime()) / 1000)),
          });
          daily++;
        }
      }
    }
  }
  return { weekly, daily };
}
