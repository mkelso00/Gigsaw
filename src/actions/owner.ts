"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireOwner } from "@/lib/auth";
import { isMonthKey, monthIsOver } from "@/lib/billing";
import { CURRENCIES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { addDemoData } from "@/lib/demo";
import { FormError, handleForm, oneOf, required, str, type FormState } from "@/lib/forms";
import { toMinor } from "@/lib/money";
import { usageForMonth } from "@/lib/usage";

function priceFrom(form: FormData, currency: string) {
  try {
    const minor = toMinor(required(form, "pricePerGig", "Price per gig"), currency);
    if (minor < 0) throw new FormError("Price can't be negative");
    return minor;
  } catch (e) {
    if (e instanceof FormError) throw e;
    throw new FormError("Enter the price per gig as a number, like 2.50");
  }
}

async function newPasswordHash(form: FormData) {
  const password = required(form, "password", "Password");
  if (password.length < 8) throw new FormError("Password must be at least 8 characters");
  return hashPassword(password);
}

async function emailFree(email: string) {
  if (await prisma.user.findUnique({ where: { email } })) throw new FormError(`${email} already has a Gigsaw login`);
}

/** Create a new customer agency with its first admin login. */
export async function createAgency(_: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  let id = "";
  const res = await handleForm(async () => {
    const name = required(form, "name", "Agency name");
    const currency = oneOf(str(form, "billingCurrency"), CURRENCIES, "GBP");
    const pricePerGigMinor = priceFrom(form, currency);
    const adminName = required(form, "adminName", "Admin name");
    const adminEmail = required(form, "adminEmail", "Admin email").toLowerCase();
    await emailFree(adminEmail);
    const passwordHash = await newPasswordHash(form);

    const { agency, admin } = await prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: { name, pricePerGigMinor, billingCurrency: currency, billingEmail: str(form, "billingEmail") || adminEmail, ownerNotes: str(form, "ownerNotes") },
      });
      await tx.settings.create({ data: { agencyId: agency.id, agencyName: name, agencyEmail: adminEmail, defaultCurrency: currency } });
      const admin = await tx.user.create({ data: { email: adminEmail, name: adminName, role: "ADMIN", agencyId: agency.id, passwordHash } });
      return { agency, admin };
    });
    if (str(form, "demo") === "on") await addDemoData(prisma, { agencyId: agency.id, leadAgentId: admin.id });
    await logActivity({ id: owner.id, agencyId: agency.id }, "AGENCY", agency.id, "agency created by Gigsaw", name);
    id = agency.id;
  });
  if (res?.error) return res;
  revalidatePath("/owner", "layout");
  redirect(`/owner/agencies/${id}?created=1`);
}

export async function updateAgency(agencyId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  return handleForm(async () => {
    const currency = oneOf(str(form, "billingCurrency"), CURRENCIES, "GBP");
    const name = required(form, "name", "Agency name");
    await prisma.agency.update({
      where: { id: agencyId },
      data: {
        name,
        status: str(form, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
        pricePerGigMinor: priceFrom(form, currency),
        billingCurrency: currency,
        billingEmail: str(form, "billingEmail"),
        ownerNotes: str(form, "ownerNotes"),
      },
    });
    await prisma.settings.upsert({ where: { agencyId }, update: { agencyName: name }, create: { agencyId, agencyName: name } });
    revalidatePath("/owner", "layout");
    return { ok: "Agency saved." };
  });
}

/** Add another admin to an agency, e.g. a second manager. */
export async function addAgencyAdmin(agencyId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    await emailFree(email);
    await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
    await prisma.user.create({
      data: { email, name: required(form, "name", "Name"), role: "ADMIN", agencyId, passwordHash: await newPasswordHash(form) },
    });
    revalidatePath(`/owner/agencies/${agencyId}`);
    return { ok: `${email} can now sign in as an admin of this agency.` };
  });
}

/** Set a new password for someone who's locked out. Signs them out everywhere. */
export async function resetUserPassword(userId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  return handleForm(async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await newPasswordHash(form) } });
    await prisma.session.deleteMany({ where: { userId } });
    return { ok: `New password set for ${user.email}.` };
  });
}

/**
 * Freeze a finished month's bill for every agency that had billable gigs.
 * Statements already marked paid are left alone; unpaid ones are recalculated.
 */
export async function issueStatements(month: string, _: FormState): Promise<FormState> {
  await requireOwner();
  if (!isMonthKey(month)) return { error: "Unknown month" };
  if (!monthIsOver(month)) return { error: "You can issue statements once the month is over." };
  const usage = await usageForMonth(month);
  const agencies = await prisma.agency.findMany({ where: { id: { in: [...usage.keys()] } } });
  let issued = 0;
  let skipped = 0;
  for (const a of agencies) {
    const u = usage.get(a.id)!;
    const existing = await prisma.billingStatement.findUnique({ where: { agencyId_month: { agencyId: a.id, month } } });
    if (existing?.status === "PAID") {
      skipped++;
      continue;
    }
    const data = {
      gigCount: u.count,
      pricePerGigMinor: a.pricePerGigMinor,
      amountMinor: u.count * a.pricePerGigMinor,
      currency: a.billingCurrency,
      references: u.references.join(", "),
      issuedAt: new Date(),
    };
    await prisma.billingStatement.upsert({
      where: { agencyId_month: { agencyId: a.id, month } },
      update: data,
      create: { ...data, agencyId: a.id, month },
    });
    issued++;
  }
  revalidatePath("/owner", "layout");
  if (!issued && !skipped) return { ok: "No agency had billable gigs that month, so there's nothing to bill." };
  return { ok: `Issued ${issued} statement(s).${skipped ? ` ${skipped} already paid, left as they were.` : ""}` };
}

export async function setStatementPaid(statementId: string, paid: boolean) {
  await requireOwner();
  await prisma.billingStatement.update({ where: { id: statementId }, data: { status: paid ? "PAID" : "ISSUED", paidAt: paid ? new Date() : null } });
  revalidatePath("/owner", "layout");
}

