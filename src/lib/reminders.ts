import "server-only";
import { Prisma } from "@prisma/client";
import { LIVE_STATUSES } from "./constants";
import { prisma } from "./db";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dayReminderAt, partOfDay, weeklyReminderWeek } from "./reminder-time";
import { addDaysToKey, formatDate, localDateKey, localTime, zonedToUtc } from "./time";

// Gig reminders for artists, run by the scheduler every minute:
//  - Weekly: the coming week's gigs, on the agency's chosen day and time.
//  - On the day: "don't forget your gig this evening".
// Each goes by phone notification (where the artist has turned them on) and email. Texts go
// only to artists without phone notifications, to keep text costs down.
// Every reminder is claimed in the Reminder table before sending, so it only ever goes once.
// Demo data, enquiries and cancelled gigs never send anything.

const HOUR = 3_600_000;

const gigInclude = {
  venue: { select: { name: true, city: true } },
  artist: { include: { login: { select: { id: true, email: true } } } },
  agent: { select: { email: true } },
} satisfies Prisma.BookingInclude;
type Gig = Prisma.BookingGetPayload<{ include: typeof gigInclude }>;

/** Claim a reminder. False if it has already been sent (or another server just claimed it). */
async function claim(kind: "WEEK" | "DAY", artistId: string, key: string) {
  try {
    await prisma.reminder.create({ data: { kind, artistId, key } });
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

type Delivery = {
  kind: "WEEK" | "DAY";
  gigs: Gig[];
  agencyName: string;
  agencyEmail: string;
  title: string;
  intro: string;
  pushBody: string;
  smsText: string;
  url: string;
  ttlSeconds: number;
};

async function deliver(d: Delivery) {
  const first = d.gigs[0];
  const artist = first.artist;
  const base = {
    kind: "REMINDER" as const,
    agencyId: first.agencyId,
    bookingId: d.gigs.length === 1 ? first.id : null,
  };
  const reached = artist.login
    ? await sendPush({
        ...base,
        userId: artist.login.id,
        payload: {
          title: d.title,
          body: d.pushBody,
          url: d.url,
          tag: `${d.kind}-${first.id}`,
        },
        ttlSeconds: d.ttlSeconds,
      })
    : 0;

  const emails = new Set([artist.email, artist.login?.email].filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()));
  for (const to of emails) {
    await sendEmail({
      ...base,
      to,
      replyTo: first.agent?.email || d.agencyEmail,
      subject: d.title,
      email: {
        brand: d.agencyName,
        preheader: d.pushBody,
        title: d.title,
        intro: d.intro,
        rows: d.gigs.map((b) => [formatDate(b.arriveBy, b.timezone), `${where(b)}${b.venue?.city ? `, ${b.venue.city}` : ""}${held(b)}\n${times(b)}`]),
        cta: artist.login ? { label: "Open my gigs", url: `${appUrl()}${d.url}` } : undefined,
        outro: `Can't make one? Reply to this email to let ${d.agencyName} know.`,
      },
    });
  }
  if (!reached && artist.phone) await sendSms({ ...base, to: artist.phone, text: d.smsText });
}

/** Send any weekly or on-the-day reminders that are due. Safe to run as often as you like. */
export async function runReminders(now = new Date()) {
  const agencies = await prisma.agency.findMany({
    where: {
      status: "ACTIVE",
      settings: { OR: [{ weeklyReminders: true }, { dayReminders: true }] },
    },
    include: { settings: true },
  });
  let weekly = 0;
  let daily = 0;

  for (const agency of agencies) {
    const s = agency.settings!;
    const agencyName = s.agencyName || agency.name;
    const base = {
      agencyId: agency.id,
      demo: false,
      status: { in: LIVE_STATUSES },
      artist: { demo: false },
    };

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
      const byArtist = new Map<string, Gig[]>();
      for (const g of gigs) byArtist.set(g.artistId, [...(byArtist.get(g.artistId) ?? []), g]);
      for (const [artistId, list] of byArtist) {
        if (!(await claim("WEEK", artistId, week))) continue;
        const n = list.length;
        const thisWeek = week === localDateKey(now, s.defaultTimezone);
        const title = `Your ${n === 1 ? "gig" : `${n} gigs`} ${thisWeek ? "this" : "next"} week`;
        const short = list.map((b) => `${formatDate(b.arriveBy, b.timezone).split(" ")[0]} ${where(b)} ${localTime(b.arriveBy, b.timezone)}`);
        await deliver({
          kind: "WEEK",
          gigs: list,
          agencyName,
          agencyEmail: s.agencyEmail,
          title,
          intro: `Hi ${list[0].artist.name}, here are your gigs for the week starting ${formatDate(from, s.defaultTimezone)}. Times are when to arrive and when you're on.`,
          pushBody: short.join(" · "),
          smsText: `${agencyName}: ${title}. ${short.join("; ")}.${list[0].artist.login ? ` ${appUrl()}/app` : ""}`,
          url: "/app",
          ttlSeconds: 24 * 3600,
        });
        weekly++;
      }
    }

    // ---- On the day ----
    if (s.dayReminders) {
      const soon = await prisma.booking.findMany({
        where: {
          ...base,
          arriveBy: { gt: now, lte: new Date(now.getTime() + 20 * HOUR) },
          checkIns: { none: { kind: "ARRIVED" } },
        },
        include: gigInclude,
        orderBy: { arriveBy: "asc" },
      });
      const sent = new Set<string>();
      for (const g of soon) {
        const day = localDateKey(g.arriveBy, g.timezone);
        const key = `${g.artistId}|${day}`;
        if (sent.has(key)) continue;
        const at = dayReminderAt(g.arriveBy, g.timezone, s.dayReminderTime);
        // Not yet, or booked after the reminder time (they've just been told about it).
        if (at > now || g.createdAt > at) continue;
        sent.add(key);
        if (!(await claim("DAY", g.artistId, day))) continue;
        const list = soon.filter((b) => b.artistId === g.artistId && localDateKey(b.arriveBy, b.timezone) === day);
        const when = partOfDay(g.arriveBy, g.timezone);
        const title = list.length > 1 ? `Don't forget: ${list.length} gigs today` : `Don't forget your gig ${when}`;
        const lines = list.map((b) => `${where(b)}: ${times(b)}${held(b)}`);
        await deliver({
          kind: "DAY",
          gigs: list,
          agencyName,
          agencyEmail: s.agencyEmail,
          title,
          intro: `Hi ${g.artist.name}, a reminder about ${list.length > 1 ? "your gigs" : "your gig"} today. Remember to tap "I've arrived" in the app when you get there.`,
          pushBody: `${lines.join(". ")}. Tap "I've arrived" when you get there.`,
          smsText: `${agencyName}: ${title}. ${lines.join(". ")}.${g.artist.login ? ` ${appUrl()}/app/gigs/${g.id}` : ""}`,
          url: list.length > 1 ? "/app" : `/app/gigs/${g.id}`,
          ttlSeconds: Math.max(600, Math.round((g.arriveBy.getTime() - now.getTime()) / 1000)),
        });
        daily++;
      }
    }
  }
  return { weekly, daily };
}
