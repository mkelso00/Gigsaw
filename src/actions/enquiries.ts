"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { getSettings, logActivity, prisma } from "@/lib/db";
import {
  BY_HAND_CONFIG,
  ENQUIRY_CHANNELS,
  ENQUIRY_FIELDS,
  isHttpsUrl,
  parseEnquiry,
  readEnquiryConfig,
  SLUG,
  slugify,
  type EnquiryChannel,
  type EnquiryConfig,
} from "@/lib/enquiries";
import { replyToCustomer, recordEnquiry } from "@/lib/enquiry-server";
import { CLOSE_REASONS, closeLead } from "@/lib/lapsed-leads";
import { receiveWebsiteEnquiry } from "@/lib/enquiry-intake";
import { FormError, handleForm, oneOf, str, type FormState } from "@/lib/forms";
import { localDateKey } from "@/lib/time";
import { log } from "@/server/log";
import { leadAgentFor } from "@/lib/lead-agent";

// The enquiry form on a business's own website (/enquire/<slug>), enquiries staff add by hand,
// and dealing with what comes in.

/** Someone sends the enquiry form. Spam is dropped quietly; real enquiries make a customer and a booking or wedding. */
export async function submitEnquiry(slug: string, _: FormState, form: FormData): Promise<FormState> {
  const res = await receiveWebsiteEnquiry(slug, form, await headers());
  if ("error" in res) return { error: res.error };
  const embed = str(form, "embed") === "1";
  redirect(`/enquire/${slug}?sent=1${embed ? "&embed=1" : ""}`);
}

const BY_HAND_CHANNELS = ENQUIRY_CHANNELS.map((c) => c.value).filter((c): c is Exclude<EnquiryChannel, "WEBSITE"> => c !== "WEBSITE");

/**
 * Staff add an enquiry that came by email or phone. It makes the customer (or finds them by email)
 * and a wedding or Enquiry booking exactly as the website form does. The customer only gets the
 * automatic "Thanks for your enquiry" reply if it's ticked.
 */
export async function addEnquiry(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    const settings = await getSettings(user.agencyId);
    const d = parseEnquiry(form, BY_HAND_CONFIG, { today: localDateKey(new Date(), settings.defaultTimezone), acts: [], byHand: true });
    const channel = oneOf(str(form, "channel"), BY_HAND_CHANNELS, "EMAIL");
    const enquiry = await recordEnquiry({ settings, d, channel, agentId: leadAgentFor(user), addedBy: { id: user.id, name: user.name } });
    if (str(form, "autoReply") === "on" && d.email) {
      after(async () => {
        try {
          await replyToCustomer(enquiry.id);
        } catch (e) {
          log.error("Couldn't send the enquiry reply", { err: e });
        }
      });
    }
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  // The newest enquiry is at the top of the list. (A server action's redirect to a #fragment
  // doesn't always finish navigating in Next 15, so it goes to the list itself.)
  redirect("/enquiries");
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

/** Move a lead along: contacted (spoken to, no proposal yet), dealt with, or back to new. */
export async function setEnquiryStatus(id: string, status: "NEW" | "CONTACTED" | "DONE") {
  const user = await requireStaff();
  const e = await prisma.enquiry.findFirst({ where: { id, agencyId: user.agencyId } });
  if (!e) return;
  await prisma.enquiry.update({
    where: { id },
    data: {
      status,
      doneAt: status === "DONE" ? new Date() : null,
      ...(status === "CONTACTED" ? { contactedAt: e.contactedAt ?? new Date() } : {}),
      ...(status === "NEW" ? { closedReason: "" } : {}),
    },
  });
  const action = status === "DONE" ? "marked an enquiry dealt with" : status === "CONTACTED" ? "contacted the customer" : "moved an enquiry back to new";
  await logActivity(user, "ENQUIRY", id, action, e.name);
  revalidatePath("/", "layout");
}

/** "Not going ahead": the lead is set aside with a reason, and the dates it holds are freed (src/lib/lapsed-leads.ts closeLead). */
export async function setLeadAside(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const pick = str(form, "reason");
    const note = str(form, "note").slice(0, 300);
    if (!(CLOSE_REASONS as readonly string[]).includes(pick)) throw new FormError("Choose why it isn't going ahead");
    const reason = pick === "Other" ? note || "Other" : note ? `${pick}: ${note}` : pick;
    const r = await closeLead(user.agencyId, id, reason);
    if (!r.ok) throw new FormError(r.why);
    await logActivity(user, "ENQUIRY", id, "set a lead aside", reason);
    revalidatePath("/", "layout");
    const freed = [...r.cancelled, ...(r.eventCancelled ? ["the wedding"] : [])];
    return {
      ok: [
        "Moved to Not going ahead.",
        freed.length ? ` Its date is freed (${freed.join(", ")} cancelled).` : "",
        r.withdrawn.length ? ` Proposal ${r.withdrawn.join(", ")} withdrawn.` : "",
      ].join(""),
    };
  });
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
