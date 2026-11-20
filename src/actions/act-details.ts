"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bankChanged, completedAt, formatNi, readPayFields } from "@/lib/act-details";
import { notifyBankChange } from "@/lib/act-details-server";
import { requireAdmin, requireStaff, requireUser } from "@/lib/auth";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { hasBank, leadOf, legalName, peopleOf } from "@/lib/payee";
import { loadPayActs, PERSON_PAY_SELECT, payHoldersFor } from "@/lib/payee-server";
import { personName } from "@/lib/person-name";
import { agreementCurrent, selfBillingWording } from "@/lib/self-billing";

type Kind = "act" | "person";

/** The columns a save writes, the same on an act and a person. */
function payColumns(after: ReturnType<typeof readPayFields>, before: Date | null) {
  return {
    bankAccountName: after.bankAccountName,
    bankSortCode: after.bankSortCode,
    bankAccountNumber: after.bankAccountNumber,
    address: after.address,
    niNumber: after.niNumber,
    vatRegistered: after.vatRegistered,
    vatNumber: after.vatNumber,
    detailsCompletedAt: completedAt(after, before),
  };
}

/** Someone saves their own pay details from Your details in the act app: a person their own, or an act login its act's. */
export async function saveMyDetails(kind: Kind, id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(["ARTIST"]);
  let first = false;
  const res = await handleForm(async () => {
    // Only details this login fills in (see payHoldersFor), in its own agency.
    const holder = (await payHoldersFor(user)).find((h) => h.kind === kind && h.id === id);
    if (!holder) throw new FormError("You can't change these details. Ask your agency.");
    const after = readPayFields(form, holder, { required: true });
    first = !holder.detailsCompletedAt;
    // The self-billing agreement: ticked with the details whenever there's no current one (first time, or after 12
    // months). Only ever from the act's own login, never by staff. The wording kept is the wording they were shown.
    let agreement: { selfBillingAgreedAt: Date; selfBillingAgreedText: string } | null = null;
    if (!agreementCurrent(holder.selfBillingAgreedAt)) {
      const settings = await getSettings(user.agencyId);
      const wording = selfBillingWording(settings.selfBillingAgreementText, settings.agencyName);
      if (str(form, "selfBilling") !== "on") throw new FormError(`Tick to agree to ${settings.agencyName} making out your invoices for you (self-billing)`);
      if (str(form, "selfBillingText").replace(/\r\n?/g, "\n") !== wording)
        throw new FormError("The self-billing agreement has just been reworded. Read it again and tick to agree.");
      agreement = { selfBillingAgreedAt: new Date(), selfBillingAgreedText: wording };
    }
    const data = { ...payColumns(after, holder.detailsCompletedAt), phone: after.phone, ...agreement };
    if (kind === "person") await prisma.person.updateMany({ where: { id, agencyId: user.agencyId }, data });
    else await prisma.artist.updateMany({ where: { id, agencyId: user.agencyId }, data });
    const entity = kind === "person" ? "PERSON" : "ARTIST";
    // Never the numbers themselves: the activity log is seen by every member of staff.
    await logActivity(user, entity, id, first ? "added their pay details in the app" : "updated their pay details in the app");
    if (agreement) await logActivity(user, entity, id, "agreed to self-billing in the app");
    if (bankChanged(holder, after)) {
      await logActivity(user, entity, id, "changed their bank details in the app");
      await notifyBankChange({ agencyId: user.agencyId, holder: { kind, id, name: holder.name }, before: holder, after, by: user.email });
    }
  });
  if (res?.error) return res;
  revalidatePath("/app", "layout");
  // The first time, straight on to their gigs; after a change, back to their details to see it.
  redirect(first ? "/app" : "/app/details?saved=1");
}

/** Show an act's or a person's full National Insurance number to an admin, once, and note who looked. */
export async function revealNiNumber(kind: Kind, id: string, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const where = { id, agencyId: user.agencyId };
    const found =
      kind === "person"
        ? await prisma.person.findFirst({ where, select: { id: true, niNumber: true } })
        : await prisma.artist.findFirst({ where, select: { id: true, niNumber: true } });
    if (!found?.niNumber) throw new FormError("No National Insurance number on file");
    await logActivity(user, kind === "person" ? "PERSON" : "ARTIST", found.id, "viewed the National Insurance number");
    return { ok: formatNi(found.niNumber) };
  });
}

/** An admin changes a person's bank, VAT and NI number from their page. Their address is in the main person form. */
export async function updatePersonPay(personId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const before = await prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId }, select: PERSON_PAY_SELECT });
    if (!before) throw new FormError("Person not found");
    const after = readPayFields(form, before, { required: false });
    await prisma.person.update({ where: { id: personId }, data: payColumns(after, before.detailsCompletedAt) });
    await logActivity(user, "PERSON", personId, "updated pay details");
    if (bankChanged(before, after)) await logActivity(user, "PERSON", personId, "changed bank details");
    revalidatePath("/", "layout");
    return { ok: "Pay details saved." };
  });
}

/** Choose who a band's invoices go to ("Invoices go to"), from the people in it. Blank clears it. */
export async function setActLead(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const act = (await loadPayActs(user.agencyId, [artistId])).get(artistId);
    if (!act) throw new FormError("Act not found");
    const personId = str(form, "leadPersonId");
    const lead = personId ? peopleOf(act).find((p) => p.id === personId) : null;
    if (personId && !lead) throw new FormError("Choose someone in the act");
    if ((lead?.id ?? null) === act.leadPersonId) return { ok: "Saved." };
    await prisma.artist.update({ where: { id: artistId }, data: { leadPersonId: lead?.id ?? null } });
    // Who gets paid is worth seeing on its own in the log.
    await logActivity(user, "ARTIST", artistId, lead ? "chose who invoices go to" : "cleared who invoices go to", lead ? legalName(lead) : "");
    revalidatePath("/", "layout");
    return { ok: lead ? `Invoices for ${act.name} now go to ${personName(lead)}.` : "Saved." };
  });
}

/**
 * Pay details still on an act from before people had their own (see src/lib/payee.ts): an admin moves them
 * to the person the act's invoices go to (when that person has no bank details yet), or clears them.
 */
export async function sortActPayDetails(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const act = (await loadPayActs(user.agencyId, [artistId])).get(artistId);
    if (!act) throw new FormError("Act not found");
    const clear = {
      bankAccountName: "",
      bankSortCode: "",
      bankAccountNumber: "",
      address: "",
      niNumber: "",
      vatRegistered: false,
      vatNumber: "",
      detailsCompletedAt: null,
    };
    if (str(form, "do") === "clear") {
      await prisma.artist.update({ where: { id: artistId }, data: clear });
      await logActivity(user, "ARTIST", artistId, "cleared the act's own pay details");
      revalidatePath("/", "layout");
      return { ok: "The act's own pay details are cleared." };
    }
    const to = leadOf(act);
    if (!to) throw new FormError("Choose who the band's invoices go to first");
    if (hasBank(to)) throw new FormError(`${personName(to)} has their own bank details already. Clear the act's instead.`);
    const moved = {
      bankAccountName: act.bankAccountName,
      bankSortCode: act.bankSortCode,
      bankAccountNumber: act.bankAccountNumber,
      address: act.address || to.address,
      niNumber: act.niNumber || to.niNumber,
      vatRegistered: act.vatRegistered,
      vatNumber: act.vatNumber,
    };
    const after = { ...moved, phone: to.phone };
    await prisma.$transaction([
      prisma.person.update({ where: { id: to.id }, data: { ...moved, detailsCompletedAt: completedAt(after, act.detailsCompletedAt) } }),
      prisma.artist.update({ where: { id: artistId }, data: clear }),
    ]);
    await logActivity(user, "ARTIST", artistId, "pay details moved to a person", legalName(to));
    revalidatePath("/", "layout");
    return { ok: `Moved to ${personName(to)}.` };
  });
}
