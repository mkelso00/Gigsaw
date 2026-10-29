"use server";

import { revalidatePath } from "next/cache";
import { hashPassword, requireAdmin, requireSignedIn, verifyPassword } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { addDemoData, hasDemoData, removeDemoData } from "@/lib/demo";
import { FormError, handleForm, int, num, oneOf, required, str, type FormState } from "@/lib/forms";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging";
import { isValidTimeZone } from "@/lib/time";

export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const tz = str(form, "defaultTimezone");
    if (!isValidTimeZone(tz)) throw new FormError("Unknown time zone");
    const commission = num(form, "defaultCommission") ?? 15;
    if (commission < 0 || commission > 100) throw new FormError("Commission must be between 0 and 100%");
    const grace = int(form, "lateGraceMinutes") ?? 5;
    if (grace < 0 || grace > 240) throw new FormError("Grace period must be between 0 and 240 minutes");
    const changeover = int(form, "changeoverMinutes") ?? 15;
    if (changeover < 0 || changeover > 240) throw new FormError("Changeover time must be between 0 and 240 minutes");
    const geofence = int(form, "geofenceMetres") ?? 500;
    if (geofence < 25 || geofence > 50_000) throw new FormError("Venue radius must be between 25 m and 50 km");
    const agencyName = required(form, "agencyName", "Agency name");
    await prisma.agency.update({ where: { id: user.agencyId }, data: { name: agencyName } });
    await prisma.settings.upsert({
      where: { agencyId: user.agencyId },
      create: { agencyId: user.agencyId },
      update: {
        agencyName,
        agencyEmail: str(form, "agencyEmail"),
        agencyAddress: str(form, "agencyAddress"),
        defaultTimezone: tz,
        defaultCurrency: oneOf(str(form, "defaultCurrency"), CURRENCIES, "GBP"),
        defaultCommission: commission,
        lateGraceMinutes: grace,
        changeoverMinutes: changeover,
        geofenceMetres: geofence,
        overdueAlerts: str(form, "overdueAlerts") === "on",
        alertEmail: str(form, "alertEmail").toLowerCase(),
        alertPhone: str(form, "alertPhone"),
        clientArrivalMessages: str(form, "clientArrivalMessages") === "on",
        invoiceTerms: str(form, "invoiceTerms"),
        contractTerms: str(form, "contractTerms"),
      },
    });
    await logActivity(user, "SETTINGS", user.agencyId, "updated agency settings");
    revalidatePath("/", "layout");
    return { ok: "Settings saved." };
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
      data: { email, name: required(form, "name", "Name"), phone: str(form, "phone"), role, agencyId: admin.agencyId, passwordHash: await hashPassword(password) },
    });
    await logActivity(admin, "USER", u.id, "added team member", `${u.name} (${role.toLowerCase()})`);
    revalidatePath("/settings");
    return { ok: `${u.name} can now sign in.` };
  });
}

export async function removeStaffUser(userId: string) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const u = await prisma.user.findFirst({ where: { id: userId, agencyId: admin.agencyId, role: { in: ["ADMIN", "AGENT"] }, isOwner: false } });
  if (!u) return;
  await prisma.user.delete({ where: { id: u.id } });
  await logActivity(admin, "USER", userId, "removed team member", u.name);
  revalidatePath("/settings");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireSignedIn();
  return handleForm(async () => {
    const current = required(form, "current", "Current password");
    const next = required(form, "next", "New password");
    if (next.length < 8) throw new FormError("New password must be at least 8 characters");
    if (!(await verifyPassword(current, user.passwordHash))) throw new FormError("Your current password is wrong");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    return { ok: "Password changed." };
  });
}

export async function loadDemoData(_: FormState): Promise<FormState> {
  const admin = await requireAdmin();
  if (await hasDemoData(prisma, admin.agencyId)) return { error: "Demo data is already loaded." };
  const res = await addDemoData(prisma, { agencyId: admin.agencyId, leadAgentId: admin.id });
  await logActivity(admin, "SETTINGS", admin.agencyId, "loaded demo data", `${res.bookings} bookings`);
  revalidatePath("/", "layout");
  return { ok: `Added ${res.artists.length} artists, ${res.venues} venues and ${res.bookings} bookings. Have a look at Arrivals and the Dashboard.` };
}

export async function clearDemoData(_: FormState): Promise<FormState> {
  const admin = await requireAdmin();
  const res = await removeDemoData(prisma, admin.agencyId);
  await logActivity(admin, "SETTINGS", admin.agencyId, "removed demo data", `${res.bookings} bookings`);
  revalidatePath("/", "layout");
  return { ok: `Removed ${res.artists} demo artists and ${res.bookings} bookings. Your own data is untouched.` };
}

/** Your own name and mobile number (used for overdue alert texts). */
export async function updateMyDetails(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireSignedIn();
  return handleForm(async () => {
    await prisma.user.update({ where: { id: user.id }, data: { name: required(form, "name", "Name"), phone: str(form, "phone") } });
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

/** Send a test email (and text, if you have a phone number) to yourself to check messages work. */
export async function sendTestMessage(_: FormState): Promise<FormState> {
  const user = await requireAdmin();
  const text = `This is a test message from Gigsaw. If you can read this, ${user.phone ? "emails and texts are" : "emails are"} working.`;
  const settings = await prisma.settings.findUnique({ where: { agencyId: user.agencyId } });
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
  const sms = user.phone ? await sendSms({ kind: "TEST", agencyId: user.agencyId, to: user.phone, text }) : "SKIPPED";
  revalidatePath("/settings");
  const word = (s: string, configured: boolean) =>
    s === "SENT" ? "sent" : s === "FAILED" ? "failed (see Recent messages)" : !configured ? "not sent: no provider set up yet, so it's saved in Recent messages" : "skipped";
  return {
    ok: `Email to ${user.email}: ${word(email, emailConfigured())}.${user.phone ? ` Text to ${user.phone}: ${word(sms, smsConfigured())}.` : " Add your mobile number above to test texts."}`,
  };
}
