"use server";
import { checkSignature } from "@/lib/contract-doc";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { endOtherSessions, hashPassword, requireAdmin, requireSignedIn, requireStaff, verifyPassword } from "@/lib/auth";
import { removeCalendarsOfLogins } from "@/lib/calendar-sync";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { INVOICE_MODES } from "@/lib/act-invoices";
import { CURRENCIES } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { setStaffRole, type StaffRole } from "@/lib/staff-role";
import { handOverWork, teamMember } from "@/lib/lead-agent";
import { addDemoData, hasDemoData, removeDemoData } from "@/lib/demo";
import { FormError, handleForm, int, num, oneOf, required, str, type FormState } from "@/lib/forms";
import { emailConfigured, isEmail, sendEmail, sendSms, smsConfigured } from "@/lib/messaging";
import { isHhmm } from "@/lib/reminder-time";
import { sendWelcome } from "@/lib/welcome";
import { toMinor } from "@/lib/money";
import { TEMPLATES } from "@/lib/message-templates";
import { prefsFromForm } from "@/lib/notify-prefs";
import { routingFromForm } from "@/lib/team-alert-routing";
import { syncExtraUsers } from "@/lib/subscription-sync";

/** Keep a subscription's extra-user charge in step; a Stripe hiccup mustn't stop adding a user. */
async function syncExtraUsersQuietly(agencyId: string) {
  try {
    await syncExtraUsers(agencyId);
  } catch (e) {
    log.warn("Couldn't update extra users in Stripe", { agencyId, err: e });
  }
}
import { isValidTimeZone } from "@/lib/time";
import { log } from "@/server/log";
import { extraFieldsFromText, parseExtraFields } from "@/lib/event-plan";
import { randomBytes } from "node:crypto";

/**
 * Save one settings page. Each page only sends its own fields, so only the fields present are
 * changed. A switch sends "<name>__shown" alongside it, so a switch turned off still counts.
 */
export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const has = (k: string) => form.has(k);
    const toggle = (k: string) => (form.has(`${k}__shown`) ? { [k]: str(form, k) === "on" } : {});
    const data: Prisma.SettingsUpdateInput = {};

    if (has("agencyName")) {
      const agencyName = required(form, "agencyName", "Business name");
      await prisma.agency.update({ where: { id: user.agencyId }, data: { name: agencyName } });
      data.agencyName = agencyName;
    }
    if (has("agencyEmail")) data.agencyEmail = str(form, "agencyEmail");
    if (has("agencyAddress")) data.agencyAddress = str(form, "agencyAddress");
    if (has("actInvoiceMode")) data.actInvoiceMode = oneOf(str(form, "actInvoiceMode"), INVOICE_MODES, "SIGN_OFF");
    if (has("accountsEmail")) {
      const accountsEmail = str(form, "accountsEmail").toLowerCase();
      if (accountsEmail && !isEmail(accountsEmail)) throw new FormError("Check the accounts email address");
      data.accountsEmail = accountsEmail;
    }
    // Where team alerts go (Settings, Notifications): the two shared inboxes and the table of choices.
    for (const [key, what] of [
      ["eventsEmail", "weddings and events email"],
      ["gigsEmail", "venue gigs email"],
    ] as const) {
      if (!has(key)) continue;
      const address = str(form, key).toLowerCase();
      if (address && !isEmail(address)) throw new FormError(`Check the ${what} address`);
      data[key] = address;
    }
    if (has("alertRouting__shown")) {
      const current = await prisma.settings.findUnique({ where: { agencyId: user.agencyId }, select: { alertRouting: true } });
      data.alertRouting = routingFromForm((k) => (form.has(k) ? str(form, k) : null), current?.alertRouting);
    }
    if (has("actContactName")) data.actContactName = str(form, "actContactName").slice(0, 80);
    if (has("actContactPhone")) {
      const phone = str(form, "actContactPhone").slice(0, 40);
      if (phone && !/^[0-9+()\-. ]{7,}$/.test(phone)) throw new FormError("Check the contact's phone number");
      data.actContactPhone = phone;
    }
    if (has("defaultTimezone")) {
      const tz = str(form, "defaultTimezone");
      if (!isValidTimeZone(tz)) throw new FormError("Unknown time zone");
      data.defaultTimezone = tz;
    }
    if (has("defaultCurrency")) data.defaultCurrency = oneOf(str(form, "defaultCurrency"), CURRENCIES, "GBP");
    if (has("lateGraceMinutes")) {
      const grace = int(form, "lateGraceMinutes") ?? 5;
      if (grace < 0 || grace > 240) throw new FormError("Grace period must be between 0 and 240 minutes");
      data.lateGraceMinutes = grace;
    }
    if (has("changeoverMinutes")) {
      const changeover = int(form, "changeoverMinutes") ?? 15;
      if (changeover < 0 || changeover > 240) throw new FormError("Changeover time must be between 0 and 240 minutes");
      data.changeoverMinutes = changeover;
    }
    if (has("geofenceMetres")) {
      const geofence = int(form, "geofenceMetres") ?? 500;
      if (geofence < 25 || geofence > 50_000) throw new FormError("Venue radius must be between 25 m and 50 km");
      data.geofenceMetres = geofence;
    }
    if (has("alertEmail")) data.alertEmail = str(form, "alertEmail").toLowerCase();
    if (has("alertPhone")) data.alertPhone = str(form, "alertPhone");
    if (has("weeklyReminderTime") || has("dayReminderTime")) {
      const weeklyReminderTime = str(form, "weeklyReminderTime") || "18:00";
      const dayReminderTime = str(form, "dayReminderTime") || "12:00";
      if (!isHhmm(weeklyReminderTime) || !isHhmm(dayReminderTime)) throw new FormError("Enter reminder times like 18:00");
      data.weeklyReminderTime = weeklyReminderTime;
      data.dayReminderTime = dayReminderTime;
    }
    if (has("weeklyReminderDay")) {
      const day = int(form, "weeklyReminderDay") ?? 7;
      if (day < 1 || day > 7) throw new FormError("Choose a day for the weekly reminder");
      data.weeklyReminderDay = day;
    }
    if (has("customerConfirmations")) data.customerConfirmations = oneOf(str(form, "customerConfirmations"), ["EVENTS", "ALL", "OFF"] as const, "EVENTS");
    if (has("planExtraFields")) {
      const current = await prisma.settings.findUnique({ where: { agencyId: user.agencyId }, select: { planExtraFields: true } });
      data.planExtraFields = extraFieldsFromText(str(form, "planExtraFields"), parseExtraFields(current?.planExtraFields), () =>
        randomBytes(5).toString("hex"),
      );
    }
    if (has("reviewLink")) data.reviewLink = /^https?:\/\//.test(str(form, "reviewLink")) ? str(form, "reviewLink") : "";
    if (has("bookingFee")) {
      const settings = await prisma.settings.findUnique({ where: { agencyId: user.agencyId }, select: { defaultCurrency: true } });
      let fee: number;
      try {
        fee = toMinor(str(form, "bookingFee"), settings?.defaultCurrency ?? "GBP");
      } catch {
        throw new FormError("Booking fee: use numbers only, like 50.00");
      }
      if (fee < 0) throw new FormError("The booking fee can't be negative");
      data.bookingFeeMinor = fee;
    }
    if (has("bookingFeeFor")) data.bookingFeeFor = oneOf(str(form, "bookingFeeFor"), ["EVENTS", "ALL"] as const, "EVENTS");
    if (has("defaultVatPct")) {
      const vat = Number(str(form, "defaultVatPct").replace("%", "") || 0);
      if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new FormError("VAT must be between 0 and 100%");
      data.defaultVatPct = vat;
    }
    if (has("invoiceTerms")) data.invoiceTerms = str(form, "invoiceTerms");
    // Weddings: where a cash balance is brought, and the note under the ways to pay on every wedding proposal.
    if (has("cashAddress")) data.cashAddress = str(form, "cashAddress").replace(/\r\n?/g, "\n").slice(0, 300);
    if (has("payNote")) data.payNote = str(form, "payNote").replace(/\r\n?/g, "\n").slice(0, 2000);
    if (has("proposalWelcome")) data.proposalWelcome = str(form, "proposalWelcome").replace(/\r\n?/g, "\n").slice(0, 2000);
    if (has("selfBillingAgreementText")) data.selfBillingAgreementText = str(form, "selfBillingAgreementText").replace(/\r\n?/g, "\n").slice(0, 2000);
    // The agency's signature: a new drawing replaces the old one, an empty box keeps it, and Remove clears it.
    if (has("signatureName")) data.signatureName = str(form, "signatureName").slice(0, 120);
    if (has("signatureRole")) data.signatureRole = str(form, "signatureRole").slice(0, 120);
    if (form.get("signatureRemove")) data.signatureImage = "";
    else if (str(form, "signatureImage")) {
      const image = checkSignature(str(form, "signatureImage"));
      if (!image) throw new FormError("That signature didn't come through. Please draw it again.");
      data.signatureImage = image;
    }
    Object.assign(
      data,
      toggle("overdueAlerts"),
      toggle("clientArrivalMessages"),
      toggle("weeklyReminders"),
      toggle("dayReminders"),
      toggle("eventEmails"),
      toggle("bookOnlySignedUp"),
    );

    await prisma.settings.upsert({ where: { agencyId: user.agencyId }, create: { agencyId: user.agencyId }, update: data });
    await logActivity(user, "SETTINGS", user.agencyId, "updated settings");
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

export async function createStaffUser(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    // No password: they set their own from the welcome email.
    const password = str(form, "password");
    if (password && password.length < 8) throw new FormError("Password must be at least 8 characters");
    if (await prisma.user.findUnique({ where: { email } })) throw new FormError("That email already has a login");
    const role = str(form, "role") === "ADMIN" ? "ADMIN" : "AGENT";
    const u = await prisma.user.create({
      data: {
        email,
        name: required(form, "name", "Name"),
        phone: str(form, "phone"),
        role,
        agencyId: admin.agencyId,
        passwordHash: password ? await hashPassword(password) : "",
      },
    });
    await logActivity(admin, "USER", u.id, "added team member", `${u.name} (${role.toLowerCase()})`);
    await syncExtraUsersQuietly(admin.agencyId!);
    const welcome = !password || !!form.get("welcome");
    if (welcome) {
      const s = await prisma.settings.findUnique({ where: { agencyId: admin.agencyId! }, select: { agencyName: true } });
      await sendWelcome({ user: u, business: s?.agencyName || "your business", invitedBy: admin.name });
    }
    revalidatePath("/settings");
    return { ok: welcome ? `Welcome email sent to ${u.email}. They'll set their own password.` : `${u.name} can now sign in.` };
  });
}

/** Make someone on the team an admin or an agent (Settings, Internal users). Not yourself: another admin does that. */
export async function changeStaffRole(userId: string, role: StaffRole) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const r = await setStaffRole(admin.agencyId!, userId, role);
  if ("why" in r) return;
  await logActivity(admin, "USER", userId, role === "ADMIN" ? "made an admin" : "made an agent", r.name);
  revalidatePath("/settings");
}

export async function removeStaffUser(userId: string) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const u = await prisma.user.findFirst({
    where: {
      id: userId,
      agencyId: admin.agencyId,
      role: { in: ["ADMIN", "AGENT"] },
      isOwner: false,
    },
  });
  if (!u) return;
  // A connected calendar goes with the login: take Gigsaw's events out of it first.
  await removeCalendarsOfLogins({ id: u.id });
  await prisma.user.delete({ where: { id: u.id } });
  await logActivity(admin, "USER", userId, "removed team member", u.name);
  await syncExtraUsersQuietly(admin.agencyId!);
  revalidatePath("/settings");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireSignedIn();
  return handleForm(async () => {
    // Someone who signed up with Google or Microsoft has no password yet, so there's none to check.
    const hadPassword = !!user.passwordHash;
    const current = hadPassword ? required(form, "current", "Current password") : "";
    const next = required(form, "next", "New password");
    if (next.length < 8) throw new FormError("New password must be at least 8 characters");
    if (hadPassword && !(await verifyPassword(current, user.passwordHash))) throw new FormError("Your current password is wrong");
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next) },
    });
    // Anyone signed in elsewhere (perhaps with the old password) is signed out; this browser stays in.
    await endOtherSessions(user.id);
    revalidatePath("/profile");
    return {
      ok: hadPassword
        ? "Password changed. You've been signed out on your other devices."
        : "Password set. You can now sign in with your email and password too.",
    };
  });
}

export async function loadDemoData(_: FormState): Promise<FormState> {
  const admin = await requireAdmin();
  if (await hasDemoData(prisma, admin.agencyId)) return { error: "Demo data is already loaded." };
  const res = await addDemoData(prisma, {
    agencyId: admin.agencyId,
    leadAgentId: admin.id,
  });
  await logActivity(admin, "SETTINGS", admin.agencyId, "loaded demo data", `${res.bookings} bookings`);
  revalidatePath("/", "layout");
  return {
    ok: `Added ${res.artists.length} artists, ${res.venues} venues and ${res.bookings} bookings. Have a look at the Calendar and the Dashboard.`,
  };
}

export async function clearDemoData(_: FormState): Promise<FormState> {
  const admin = await requireAdmin();
  // The demo logins removeDemoData deletes take their connected calendars with them: empty those first.
  await removeCalendarsOfLogins({ agencyId: admin.agencyId, OR: [{ demo: true }, { artist: { demo: true } }, { person: { demo: true } }] });
  const res = await removeDemoData(prisma, admin.agencyId);
  queueCalendarSync(res.bookingIds);
  await logActivity(admin, "SETTINGS", admin.agencyId, "removed demo data", `${res.bookings} bookings`);
  revalidatePath("/", "layout");
  return {
    ok: `Removed ${res.artists} demo artists and ${res.bookings} bookings. Your own data is untouched.`,
  };
}

/** Your own name and mobile number (used for overdue alert texts). */
/** Switch an automatic message on or off, or change its wording (Settings > Notifications). */
export async function saveMessageTemplate(key: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    if (!TEMPLATES.some((t) => t.key === key)) throw new FormError("Unknown message");
    const settings = await prisma.settings.findUnique({ where: { agencyId: user.agencyId }, select: { messageTemplates: true } });
    const all = { ...((settings?.messageTemplates as Record<string, unknown>) ?? {}) };
    const reset = form.get("useDefault") === "1";
    all[key] = reset
      ? {}
      : {
          off: str(form, "on") !== "on",
          subject: str(form, "subject").slice(0, 200),
          intro: str(form, "intro").slice(0, 2000),
          text: str(form, "text").slice(0, 320),
        };
    await prisma.settings.update({ where: { agencyId: user.agencyId }, data: { messageTemplates: all as Prisma.InputJsonValue } });
    await logActivity(user, "SETTINGS", user.agencyId, reset ? "reset a message to Gigsaw's wording" : "updated a message", key);
    revalidatePath("/settings/notifications", "layout");
    return { ok: reset ? "Back to Gigsaw's wording." : "Saved." };
  });
}

/** Save which alerts the signed-in user wants, from their profile. */
export async function saveMyNotifications(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireSignedIn();
  return handleForm(async () => {
    await prisma.user.update({ where: { id: user.id }, data: { notifyPrefs: prefsFromForm(form) } });
    revalidatePath("/profile");
    return { ok: "Saved." };
  });
}

/**
 * "Who looks after what I book" on the Profile page: someone else becomes lead agent on the bookings, weddings,
 * leads and proposals you make (you stay as "Booked by"), so their alerts go to them. Optionally hands over what
 * you're lead agent on now (upcoming only).
 */
export async function saveMyHandOff(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const picked = str(form, "handOffToId");
    const to = picked && picked !== user.id ? await teamMember(user.agencyId, picked) : null;
    if (picked && picked !== user.id && !to) throw new FormError("Choose someone on your team");
    await prisma.user.update({ where: { id: user.id }, data: { handOffToId: to?.id ?? null } });
    await logActivity(user, "USER", user.id, to ? "hands their bookings to" : "looks after their own bookings", to?.name ?? "");
    let moved = "";
    if (to && form.get("moveExisting")) {
      const settings = await getSettings(user.agencyId);
      const n = await handOverWork(user.agencyId, user.id, to.id, settings.defaultTimezone);
      const parts = [
        n.bookings && `${n.bookings} upcoming booking${n.bookings === 1 ? "" : "s"}`,
        n.events && `${n.events} wedding${n.events === 1 ? "" : "s"} or event${n.events === 1 ? "" : "s"}`,
        n.proposals && `${n.proposals} open proposal${n.proposals === 1 ? "" : "s"}`,
        n.acts && `${n.acts} act${n.acts === 1 ? "" : "s"}`,
      ].filter(Boolean);
      moved = parts.length ? ` Moved to ${to.name}: ${parts.join(", ")}.` : ` You weren't lead agent on anything upcoming.`;
      if (parts.length) await logActivity(user, "USER", user.id, "handed over their work", `${to.name}: ${parts.join(", ")}`);
    }
    revalidatePath("/", "layout");
    return { ok: (to ? `Saved. ${to.name} is now lead agent on what you book.` : "Saved. You're lead agent on what you book.") + moved };
  });
}

export async function updateMyDetails(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireSignedIn();
  return handleForm(async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { name: required(form, "name", "Name"), phone: str(form, "phone") },
    });
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

/** Send a test email (and text, if you have a phone number) to yourself to check messages work. */
export async function sendTestMessage(_: FormState): Promise<FormState> {
  const user = await requireAdmin();
  const text = `This is a test message from Gigsaw. If you can read this, ${user.phone ? "emails and texts are" : "emails are"} working.`;
  const settings = await prisma.settings.findUnique({
    where: { agencyId: user.agencyId },
  });
  const email = await sendEmail({
    kind: "TEST",
    agencyId: user.agencyId,
    to: user.email,
    replyTo: settings?.agencyEmail,
    subject: "Gigsaw test message",
    email: {
      brand: settings?.agencyName || user.agency?.name,
      title: "It works",
      intro: text,
      rows: [
        ["Sent to", user.email],
        ["Replies go to", settings?.agencyEmail || "the sending address (set your agency email in Settings)"],
      ],
    },
  });
  const sms = user.phone
    ? await sendSms({
        kind: "TEST",
        agencyId: user.agencyId,
        to: user.phone,
        text,
      })
    : "SKIPPED";
  revalidatePath("/settings");
  const word = (s: string, configured: boolean) =>
    s === "SENT"
      ? "sent"
      : s === "FAILED"
        ? "failed (see Recent messages)"
        : !configured
          ? "not sent: no provider set up yet, so it's saved in Recent messages"
          : "skipped";
  return {
    ok: `Email to ${user.email}: ${word(email, emailConfigured())}.${user.phone ? ` Text to ${user.phone}: ${word(sms, smsConfigured())}.` : " Add your mobile number above to test texts."}`,
  };
}
