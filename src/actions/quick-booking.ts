"use server";

import { requireStaff } from "@/lib/auth";
import { awayBetween } from "@/lib/away";
import { getSettings, prisma } from "@/lib/db";
import { localDateKey } from "@/lib/time";

export type QuickBookingOption = { id: string; name: string; detail?: string };

export type QuickBookingLists = {
  acts: QuickBookingOption[];
  venues: QuickBookingOption[];
  contacts: QuickBookingOption[];
  /** Days acts have blocked out, from today on (a band's list includes its acts' days). */
  away: { artistId: string; startDate: string; endDate: string; note: string; actName: string; own: boolean }[];
};

/**
 * What the "New booking" pop-up picks from: the business's acts, venues and contacts, and the days
 * acts are away. Loaded when the pop-up first opens, not by the agency layout on every page, as a
 * business with thousands of contacts made every page slower and heavier for a form rarely opened.
 */
export async function loadQuickBookingLists(): Promise<QuickBookingLists> {
  // Open while locked, as the layout that used to load these was: the lists are the business's own
  // names, and booking itself (addRotaGig) is still refused with a message until a plan is chosen.
  const user = await requireStaff({ allowLocked: true });
  const settings = await getSettings(user.agencyId);
  const pick = { where: { agencyId: user.agencyId }, orderBy: { name: "asc" as const } };
  const [acts, venues, contacts, away] = await Promise.all([
    prisma.artist.findMany({ ...pick, select: { id: true, name: true } }),
    prisma.venue.findMany({ ...pick, select: { id: true, name: true, city: true } }),
    prisma.contact.findMany({ ...pick, select: { id: true, name: true, company: true } }),
    awayBetween(user.agencyId, localDateKey(new Date(), settings.defaultTimezone), "9999-12-31"),
  ]);
  return {
    acts,
    venues: venues.map((v) => ({ id: v.id, name: v.name, detail: v.city })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, detail: c.company })),
    away: away.map(({ artistId, startDate, endDate, note, actName, own }) => ({ artistId, startDate, endDate, note, actName, own })),
  };
}
