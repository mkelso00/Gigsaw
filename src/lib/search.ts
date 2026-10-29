import "server-only";
import { prisma } from "./db";
import { venueColour } from "./rota";
import { formatDate, localTime } from "./time";

// Search across everything an agency has: acts, venues, contacts and bookings (any date),
// plus the pages of the app. Used by the live search box at the top of every page.

export type SearchHit = { kind: "act" | "venue" | "contact" | "booking" | "page"; href: string; title: string; sub: string; colour?: string };

const PAGES: [string, string, string][] = [
  ["Dashboard", "/dashboard", "home overview"],
  ["Arrivals", "/arrivals", "live check-ins late overdue"],
  ["Rota", "/rota", "weekly slots schedule unfilled"],
  ["Calendar", "/calendar", "diary month week day"],
  ["Bookings", "/bookings", "gigs list"],
  ["New booking", "/bookings/new", "add create gig"],
  ["Acts", "/artists", "artists singers bands roster"],
  ["Add an act", "/artists/new", "new artist singer band"],
  ["Contacts", "/contacts", "promoters customers clients"],
  ["Add a private customer", "/contacts/new?type=CLIENT", "wedding client new contact"],
  ["Venues", "/venues", "pubs bars places"],
  ["Add a venue", "/venues/new", "new venue"],
  ["Reports", "/reports", "money earnings commission"],
  ["Settings", "/settings", "account team reminders alerts messages demo"],
];

export async function globalSearch(agencyId: string, raw: string, opts: { isOwner: boolean }): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 100);
  if (!q) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const now = new Date();
  const bookingWhere = {
    agencyId,
    OR: [
      { reference: contains },
      { eventName: contains },
      { artist: { name: contains } },
      { venue: { name: contains } },
      { venue: { city: contains } },
      { promoter: { name: contains } },
      { promoter: { company: contains } },
    ],
  };
  const bookingInclude = { artist: { select: { name: true } }, venue: { select: { id: true, name: true, city: true, colour: true } } } as const;
  const [acts, venues, contacts, upcoming, past] = await Promise.all([
    prisma.artist.findMany({
      where: { agencyId, OR: [{ name: contains }, { email: contains }, { phone: contains }, { genre: contains }] },
      take: 4,
      orderBy: { name: "asc" },
      select: { id: true, name: true, genre: true, phone: true, colour: true },
    }),
    prisma.venue.findMany({
      where: { agencyId, OR: [{ name: contains }, { city: contains }, { address: contains }] },
      take: 5,
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, colour: true },
    }),
    prisma.contact.findMany({
      where: { agencyId, OR: [{ name: contains }, { company: contains }, { email: contains }, { phone: contains }] },
      take: 5,
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true, email: true },
    }),
    prisma.booking.findMany({ where: { ...bookingWhere, setStart: { gte: now } }, include: bookingInclude, orderBy: { setStart: "asc" }, take: 5 }),
    prisma.booking.findMany({ where: { ...bookingWhere, setStart: { lt: now } }, include: bookingInclude, orderBy: { setStart: "desc" }, take: 3 }),
  ]);

  const lower = q.toLowerCase();
  const pages = [...PAGES, ...(opts.isOwner ? ([["Owner area", "/owner", "agencies billing outbox"]] as [string, string, string][]) : [])]
    .filter(([title, href, words]) => `${title} ${words} ${href}`.toLowerCase().includes(lower))
    .slice(0, 3);

  // People and places first, then gigs (soonest first), then pages.
  return [
    ...acts.map<SearchHit>((a) => ({
      kind: "act",
      href: `/artists/${a.id}`,
      title: a.name,
      sub: [a.genre, a.phone].filter(Boolean).join(" · ") || "Act",
      colour: a.colour,
    })),
    ...venues.map<SearchHit>((v) => ({ kind: "venue", href: `/venues/${v.id}`, title: v.name, sub: v.city || "Venue", colour: venueColour(v) })),
    ...contacts.map<SearchHit>((c) => ({ kind: "contact", href: `/contacts/${c.id}`, title: c.name, sub: c.company || c.email || "Contact" })),
    ...[...upcoming, ...past].map<SearchHit>((b) => ({
      kind: "booking",
      href: `/bookings/${b.id}`,
      title: `${b.artist.name} · ${b.venue?.name ?? "No venue"}`,
      sub: `${formatDate(b.arriveBy, b.timezone)}, ${localTime(b.setStart, b.timezone)} · ${b.reference}${b.status === "CANCELLED" ? " · cancelled" : ""}`,
      colour: b.venue ? venueColour(b.venue) : undefined,
    })),
    ...pages.map<SearchHit>(([title, href]) => ({ kind: "page", href, title, sub: "Go to page" })),
  ];
}
