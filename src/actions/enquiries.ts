"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { createBookingWithReference } from "@/lib/bookings";
import { logActivity, prisma } from "@/lib/db";
import {
  checkFormStamp,
  ENQUIRY_FIELDS,
  enquiryMakes,
  enquiryNote,
  enquiryTitle,
  formatDay,
  enquiryTypeLabel,
  isHttpsUrl,
  parseEnquiry,
  readEnquiryConfig,
  SLUG,
  slugify,
  type EnquiryConfig,
} from "@/lib/enquiries";
import { clientIp, enquiryAttempts, enquirySecret, ipHash, MAX_PER_IP_PER_HOUR, notifyTeam, replyToCustomer } from "@/lib/enquiry-server";
import { defaultTasks } from "@/lib/event-plan";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { defaultBookingFee } from "@/lib/money";
import { buildSchedule } from "@/lib/schedule";
import { localDateKey } from "@/lib/time";

// The enquiry form on a business's own website (/enquire/<slug>), and dealing with what comes in.

const TOO_MANY = "We've had a few enquiries from you already. Please try again later, or contact us directly.";

/** Someone sends the enquiry form. Spam is dropped quietly; real enquiries make a customer and a booking or wedding. */
export async function submitEnquiry(slug: string, _: FormState, form: FormData): Promise<FormState> {
  let sent = false;
  const res = await handleForm(async () => {
    const settings = await prisma.settings.findUnique({ where: { enquirySlug: slug }, include: { agency: { select: { name: true, status: true } } } });
    if (!settings || !settings.enquiryOn || settings.agency.status !== "ACTIVE") {
      throw new FormError("This form isn't taking enquiries at the moment. Please contact us directly.");
    }
    const agencyId = settings.agencyId;
    const secret = await enquirySecret();
    const ip = ipHash(clientIp(await headers()), secret);
    if (!enquiryAttempts.hit(ip)) throw new FormError(TOO_MANY);

    // A hidden box people never see or fill in: bots do. Bots (and forged time stamps) are told it
    // went, so they don't try again, but nothing is saved.
    const stamp = checkFormStamp(str(form, "t"), secret, Date.now());
    if (str(form, "company_site") || stamp === "bad") {
      sent = true;
      return;
    }
    if (stamp === "fast") throw new FormError("That was quick! Please check your details, then press Send again.");
    if (stamp === "old") throw new FormError("This page has been open a long time. Please copy your message, reload the page and send it again.");

    const config = readEnquiryConfig(settings.enquiryForm);
    const acts = config.fields.acts
      ? await prisma.artist.findMany({ where: { agencyId, demo: false }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];
    const tz = settings.defaultTimezone;
    const d = parseEnquiry(form, config, { today: localDateKey(new Date(), tz), acts });

    const [fromIp, fromEmail] = await Promise.all([
      prisma.enquiry.count({ where: { ipHash: ip, createdAt: { gt: new Date(Date.now() - 3_600_000) } } }),
      prisma.enquiry.count({ where: { agencyId, email: d.email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } }),
    ]);
    if (fromIp >= MAX_PER_IP_PER_HOUR) throw new FormError(TOO_MANY);
    // Pressed Send twice, or sent the same thing again straight away: we've already got it.
    if (fromEmail >= 2) {
      sent = true;
      return;
    }

    const source = str(form, "source")
      .replace(/[^\w.\-/~%]/g, "")
      .slice(0, 200);
    const note = enquiryNote(d, source);
    // The person looking after enquiries (if one is chosen) looks after what they make.
    const agentId = config.notify.startsWith("USER:")
      ? ((await prisma.user.findFirst({ where: { id: config.notify.slice(5), agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true } }))?.id ?? null)
      : null;

    // The customer: the one already on file with this email, or a new private customer.
    let contact = await prisma.contact.findFirst({ where: { agencyId, email: { equals: d.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
    const contactCreated = !contact;
    if (!contact) {
      contact = await prisma.contact.create({
        data: { agencyId, type: "CLIENT", name: d.name, email: d.email, phone: d.phone, tags: d.eventType === "WEDDING" ? "wedding" : "" },
      });
    } else if (!contact.phone && d.phone) {
      await prisma.contact.update({ where: { id: contact.id }, data: { phone: d.phone } });
    }
    await prisma.contactNote.create({ data: { contactId: contact.id, body: note } });

    let bookingId: string | null = null;
    let eventId: string | null = null;
    const makes = enquiryMakes(d);
    if (makes === "EVENT") {
      // A wedding: the agency adds the acts later. No automatic emails to the couple until they switch them on.
      const e = await prisma.event.create({
        data: {
          agencyId,
          name: enquiryTitle(d),
          type: "WEDDING",
          date: d.date,
          timezone: tz,
          customerId: contact.id,
          venueText: d.venue,
          guestCount: d.guests,
          agentId,
          notes: note,
          autoEmails: false,
          plannerToken: randomBytes(18).toString("base64url"),
          tasks: { create: defaultTasks("WEDDING", d.date) },
        },
      });
      eventId = e.id;
    } else if (makes === "BOOKING") {
      const eventType = d.eventType || "OTHER";
      // Bookings need a time: with none given, 19:00 holds the place until it's agreed.
      const time = d.startTime || "19:00";
      const b = await createBookingWithReference(agencyId, {
        ...buildSchedule(d.date, { arrive: time, setStart: time }, tz),
        status: "ENQUIRY",
        eventType,
        eventName: enquiryTitle(d),
        timezone: tz,
        currency: settings.defaultCurrency,
        commissionPct: settings.defaultCommission,
        bookingFeeMinor: defaultBookingFee(settings, { eventType }),
        promoterId: contact.id,
        agentId,
        tags: "website",
        notes: d.startTime ? note : `${note}\n\nNo start time given: 19:00 is a placeholder.`,
      });
      bookingId = b.id;
    }

    const enquiry = await prisma.enquiry.create({
      data: { agencyId, ...d, contactId: contact.id, contactCreated, bookingId, eventId, source, ipHash: ip },
    });
    const what = [d.name, d.eventType ? enquiryTypeLabel(d.eventType).toLowerCase() : "", d.date ? formatDay(d.date) : ""].filter(Boolean).join(", ");
    await prisma.activity.create({
      data: {
        agencyId,
        entity: bookingId ? "BOOKING" : eventId ? "EVENT" : "ENQUIRY",
        entityId: bookingId ?? eventId ?? enquiry.id,
        action: "sent an enquiry from your website",
        detail: what,
      },
    });

    // Emails and phone notifications go once the customer has seen the thank-you.
    after(async () => {
      try {
        await replyToCustomer(enquiry.id);
        await notifyTeam(enquiry.id);
      } catch (e) {
        console.error("Couldn't send the enquiry emails", e);
      }
    });
    revalidatePath("/", "layout");
    sent = true;
  });
  if (res?.error || !sent) return res;
  const embed = str(form, "embed") === "1";
  redirect(`/enquire/${slug}?sent=1${embed ? "&embed=1" : ""}`);
}

/** Settings → Enquiry form. */
export async function saveEnquiryForm(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId: user.agencyId! } });

    const typed = str(form, "slug").toLowerCase();
    let slug = typed || settings.enquirySlug || slugify(settings.agencyName);
    if (!SLUG.test(slug)) throw new FormError("The web address can only use small letters, numbers and dashes (3 to 40 of them)");
    const taken = await prisma.settings.findFirst({ where: { enquirySlug: slug, NOT: { agencyId: user.agencyId! } }, select: { agencyId: true } });
    if (taken) {
      // Our own suggestion (the business name) is taken: add a number. One they typed themselves: ask for another.
      const suggested = !typed || (!settings.enquirySlug && typed === slugify(settings.agencyName));
      if (!suggested) throw new FormError("That web address is already taken. Try another.");
      for (let n = 2; ; n++) {
        const next = `${slug.slice(0, 36)}-${n}`;
        if (!(await prisma.settings.findFirst({ where: { enquirySlug: next }, select: { agencyId: true } }))) {
          slug = next;
          break;
        }
      }
    }

    const logoUrl = str(form, "logoUrl");
    if (logoUrl && !isHttpsUrl(logoUrl)) throw new FormError("The logo link must start with https://");
    const notify = str(form, "notify");
    if (notify.startsWith("USER:")) {
      const ok = await prisma.user.findFirst({
        where: { id: notify.slice(5), agencyId: user.agencyId!, role: { in: ["ADMIN", "AGENT"] } },
        select: { id: true },
      });
      if (!ok) throw new FormError("Choose who hears about new enquiries");
    }
    const config: EnquiryConfig = {
      fields: Object.fromEntries(ENQUIRY_FIELDS.map(({ key }) => [key, str(form, `field:${key}`) === "on"])) as EnquiryConfig["fields"],
      intro: str(form, "intro").slice(0, 300),
      thanks: str(form, "thanks").slice(0, 1000),
      notify: readEnquiryConfig({ notify }).notify,
      logoUrl,
    };
    if (!config.fields.date) config.fields.time = false;
    const on = str(form, "enquiryOn") === "on";

    await prisma.settings.update({ where: { agencyId: user.agencyId! }, data: { enquiryOn: on, enquirySlug: slug, enquiryForm: config } });
    await logActivity(user, "SETTINGS", user.agencyId!, on ? "updated the enquiry form" : "switched off the enquiry form");
    revalidatePath("/", "layout");
    return { ok: on && !settings.enquiryOn ? "Saved. Your enquiry form is live." : "Saved." };
  });
}

/** Mark an enquiry dealt with, or back to new. */
export async function setEnquiryStatus(id: string, status: "NEW" | "DONE") {
  const user = await requireStaff();
  const e = await prisma.enquiry.findFirst({ where: { id, agencyId: user.agencyId } });
  if (!e) return;
  await prisma.enquiry.update({ where: { id }, data: { status, doneAt: status === "DONE" ? new Date() : null } });
  await logActivity(user, "ENQUIRY", id, status === "DONE" ? "marked an enquiry dealt with" : "moved an enquiry back to new", e.name);
  revalidatePath("/", "layout");
}

/**
 * Delete an enquiry that's spam, with what it made: its booking (if still an enquiry with no act),
 * its wedding (if no acts have been added) and the customer (if they were new with nothing else).
 */
export async function deleteEnquiry(id: string) {
  const user = await requireStaff();
  const e = await prisma.enquiry.findFirst({ where: { id, agencyId: user.agencyId } });
  if (!e) return;
  await prisma.enquiry.delete({ where: { id } });
  if (e.bookingId) {
    await prisma.booking.deleteMany({ where: { id: e.bookingId, agencyId: user.agencyId, status: "ENQUIRY", artistId: null, payments: { none: {} } } });
  }
  if (e.eventId) await prisma.event.deleteMany({ where: { id: e.eventId, agencyId: user.agencyId, bookings: { none: {} } } });
  if (e.contactId && e.contactCreated) {
    await prisma.contact.deleteMany({
      where: {
        id: e.contactId,
        agencyId: user.agencyId,
        bookings: { none: {} },
        events: { none: {} },
        enquiries: { none: {} },
        people: { none: {} },
      },
    });
  }
  await logActivity(user, "ENQUIRY", id, "deleted an enquiry as spam", e.name);
  revalidatePath("/", "layout");
}
