"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { appUrl, sendEmail, sendPush } from "@/lib/messaging";
import { personName } from "@/lib/person-name";
import { formatDate, localTime } from "@/lib/time";
import { log } from "@/server/log";

// One booking's line-up (BookingLineup, src/lib/lineup.ts): take a member off this gig, put them back, or bring
// someone in to stand in. On a confirmed gig the person affected is told; calendars catch up either way.

async function ownBooking(agencyId: string, bookingId: string) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, agencyId },
    include: {
      artist: { select: { name: true } },
      venue: { select: { name: true, city: true } },
      event: { select: { name: true } },
      agent: true,
      agency: { include: { settings: true } },
    },
  });
  if (!b?.artistId) throw new FormError("Choose an act for this booking first");
  return b;
}

type Booking = Awaited<ReturnType<typeof ownBooking>>;

/** Tell someone they're now on (a stand-in) or off this gig. Only for a confirmed gig; never the act's fee. */
async function tell(b: Booking, personId: string, change: "IN" | "OUT") {
  if (b.status !== "CONFIRMED" || b.demo) return;
  try {
    const p = await prisma.person.findUnique({ where: { id: personId }, include: { login: { select: { id: true, email: true } } } });
    if (!p) return;
    const brand = b.agency.settings?.agencyName || b.agency.name;
    const act = b.artist?.name ?? "the act";
    const where = b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : (b.event?.name ?? "Venue to be confirmed");
    const date = formatDate(b.arriveBy, b.timezone);
    const first = p.alias?.trim() || p.firstName;
    const base = { kind: "BOOKING_CHANGE" as const, agencyId: b.agencyId, bookingId: b.id };
    const title = change === "IN" ? `You're standing in with ${act}: ${where}, ${date}` : `You're not needed for ${act} at ${where}, ${date}`;
    if (p.login) {
      await sendPush({
        ...base,
        userId: p.login.id,
        payload: { title, body: change === "IN" ? `Arrive ${localTime(b.arriveBy, b.timezone)}.` : "Cover's arranged for this one.", url: `/app` },
      });
    }
    for (const to of [...new Set([p.email, p.login?.email].filter((e): e is string => !!e?.trim()))]) {
      await sendEmail({
        ...base,
        to,
        replyTo: b.agent?.email || b.agency.settings?.agencyEmail,
        subject: title,
        email: {
          brand,
          title: change === "IN" ? `You're standing in with ${act}` : "You're not needed for this one",
          intro:
            change === "IN"
              ? `Hi ${first}, ${brand} has you standing in with ${act} for this gig.${p.login ? " It's in your Gigsaw app and your calendar." : ""}`
              : `Hi ${first}, cover has been arranged for you on this gig, so you're not needed. Your other gigs with ${act} are as they were.`,
          rows: [
            ["Act", act],
            ["Where", where],
            ["Date", date],
            ...(change === "IN"
              ? ([
                  ["Arrive by", localTime(b.arriveBy, b.timezone)],
                  ["On", `${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`],
                ] as [string, string][])
              : []),
          ],
          cta: change === "IN" && p.login ? { label: "Open in Gigsaw", url: `${appUrl()}/app/gigs/${b.id}` } : undefined,
          outro: `Questions? Reply to this email to reach ${b.agent?.name ?? brand}.`,
        },
      });
    }
  } catch (e) {
    log.error("Couldn't tell someone about a line-up change", { bookingId: b.id, err: e });
  }
}

const done = (bookingId: string) => {
  queueCalendarSync(bookingId);
  revalidatePath(`/bookings/${bookingId}`);
};

/** A member is off this gig (e.g. ill), or back on it. */
export async function setOffGig(bookingId: string, personId: string, off: boolean, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await ownBooking(user.agencyId, bookingId);
    const p = await prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId } });
    if (!p) throw new FormError("Not found");
    if (off) {
      await prisma.bookingLineup.upsert({
        where: { bookingId_personId: { bookingId, personId } },
        create: { bookingId, personId, change: "OUT" },
        update: { change: "OUT" },
      });
    } else {
      await prisma.bookingLineup.deleteMany({ where: { bookingId, personId, change: "OUT" } });
    }
    await logActivity(user, "BOOKING", bookingId, off ? "took off this gig" : "put back on this gig", personName(p));
    done(bookingId);
    await tell(b, personId, off ? "OUT" : "IN");
    return { ok: off ? `${personName(p)} is off this gig.` : `${personName(p)} is back on this gig.` };
  });
}

/** Bring someone in for this gig: someone already in Gigsaw, or a new person by name, email and phone. */
export async function addStandIn(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await ownBooking(user.agencyId, bookingId);
    let personId = str(form, "personId");
    if (personId) {
      if (!(await prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId }, select: { id: true } }))) throw new FormError("Not found");
    } else {
      const firstName = str(form, "firstName").replace(/\s+/g, " ").slice(0, 60);
      if (!firstName) throw new FormError("Choose someone, or type the stand-in's name");
      const email = str(form, "email").toLowerCase().slice(0, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FormError("Check the email address");
      const phone = str(form, "phone").slice(0, 40);
      // The same person again if they're already on file by email.
      const existing = email ? await prisma.person.findFirst({ where: { agencyId: user.agencyId, email }, select: { id: true } }) : null;
      personId =
        existing?.id ??
        (await prisma.person.create({ data: { agencyId: user.agencyId, firstName, surname: str(form, "surname").slice(0, 60), email, phone } })).id;
    }
    // Already in the act and only marked off: putting them back is the same thing.
    const row = await prisma.bookingLineup.findUnique({ where: { bookingId_personId: { bookingId, personId } } });
    if (row?.change === "OUT") await prisma.bookingLineup.delete({ where: { id: row.id } });
    else
      await prisma.bookingLineup.upsert({ where: { bookingId_personId: { bookingId, personId } }, create: { bookingId, personId, change: "IN" }, update: {} });
    const p = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    await logActivity(user, "BOOKING", bookingId, "brought in a stand-in", personName(p));
    done(bookingId);
    await tell(b, personId, "IN");
    return { ok: `${personName(p)} is standing in on this gig.` };
  });
}

/** Take a stand-in off this gig again. */
export async function removeStandIn(bookingId: string, personId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await ownBooking(user.agencyId, bookingId);
    const row = await prisma.bookingLineup.findFirst({
      where: { bookingId, personId, change: "IN", person: { agencyId: user.agencyId } },
      include: { person: true },
    });
    if (!row) return { ok: "Done." };
    await prisma.bookingLineup.delete({ where: { id: row.id } });
    await logActivity(user, "BOOKING", bookingId, "took a stand-in off this gig", personName(row.person));
    done(bookingId);
    await tell(b, personId, "OUT");
    return { ok: `${personName(row.person)} is off this gig.` };
  });
}
