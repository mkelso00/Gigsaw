"use server";
import { checkSignature } from "@/lib/contract-doc";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hashPassword, requireAdmin, requireSignedIn, verifyPassword } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { addDemoData, hasDemoData, removeDemoData } from "@/lib/demo";
import { FormError, handleForm, int, num, oneOf, required, str, type FormState } from "@/lib/forms";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging";
import { isHhmm } from "@/lib/reminder-time";
import { toMinor } from "@/lib/money";
import { TEMPLATES } from "@/lib/message-templates";
import { prefsFromForm } from "@/lib/notify-prefs";
import { syncExtraUsers } from "@/lib/subscription-sync";

/** Keep a subscription's extra-user charge in step; a Stripe hiccup mustn't stop adding a user. */
async function syncExtraUsersQuietly(agencyId: string) {
  try {
    await syncExtraUsers(agencyId);
  } catch (e) {
    console.error("Couldn't update extra users in Stripe", e);
  }
}
import { isValidTimeZone } from "@/lib/time";

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
    if (has("invoiceTerms")) data.invoiceTerms = str(form, "invoiceTerms");
    if (has("contractTerms")) data.contractTerms = str(form, "contractTerms");
    // The agency's signature: a new drawing replaces the old one, an empty box keeps it, and Remove clears it.
    if (has("signatureName")) data.signatureName = str(form, "signatureName").slice(0, 120);
    if (has("signatureRole")) data.signatureRole = str(form, "signatureRole").slice(0, 120);
    if (form.get("signatureRemove")) data.signatureImage = "";
    else if (str(form, "signatureImage")) {
      const image = checkSignature(str(form, "signatureImage"));
      if (!image) throw new FormError("That signature didn't come through. Please draw it again.");
      data.signatureImage = image;
    }
    Object.assign(data, toggle("overdueAlerts"), toggle("clientArrivalMessages"), toggle("weeklyReminders"), toggle("dayReminders"), toggle("eventEmails"));

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
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    if (await prisma.user.findUnique({ where: { email } })) throw new FormError("That email already has a login");
    const role = str(form, "role") === "ADMIN" ? "ADMIN" : "AGENT";
    const u = await prisma.user.create({
      data: {
        email,
        name: required(form, "name", "Name"),
        phone: str(form, "phone"),
        role,
        agencyId: admin.agencyId,
        passwordHash: await hashPassword(password),
      },
    });
    await logActivity(admin, "USER", u.id, "added team member", `${u.name} (${role.toLowerCase()})`);
    await syncExtraUsersQuietly(admin.agencyId!);
    revalidatePath("/settings");
    return { ok: `${u.name} can now sign in.` };
  });
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
    revalidatePath("/profile");
    return { ok: hadPassword ? "Password changed." : "Password set. You can now sign in with your email and password too." };
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
    ok: `Added ${res.artists.length} artists, ${res.venues} venues and ${res.bookings} bookings. Have a look at Arrivals and the Dashboard.`,
  };
}

export async function clearDemoData(_: FormState): Promise<FormState> {
  const admin = await requireAdmin();
  const res = await removeDemoData(prisma, admin.agencyId);
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
