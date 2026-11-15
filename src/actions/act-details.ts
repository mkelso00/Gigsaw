"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bankChanged, completedAt, formatNi, readPayFields } from "@/lib/act-details";
import { notifyBankChange, payActsFor } from "@/lib/act-details-server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, type FormState } from "@/lib/forms";

/** The act saves their own pay details from Your details in the act app. */
export async function saveMyDetails(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(["ARTIST"]);
  let first = false;
  const res = await handleForm(async () => {
    // Only an act this login speaks for (see payActsFor), in its own agency.
    const act = (await payActsFor(user)).find((a) => a.id === artistId);
    if (!act) throw new FormError("You can't change these details. Ask your agency.");
    const after = readPayFields(form, act, { required: true });
    first = !act.detailsCompletedAt;
    await prisma.artist.updateMany({
      where: { id: act.id, agencyId: user.agencyId },
      data: {
        bankAccountName: after.bankAccountName,
        bankSortCode: after.bankSortCode,
        bankAccountNumber: after.bankAccountNumber,
        address: after.address,
        niNumber: after.niNumber,
        phone: after.phone,
        vatRegistered: after.vatRegistered,
        vatNumber: after.vatNumber,
        detailsCompletedAt: completedAt(after, act.detailsCompletedAt),
      },
    });
    // Never the numbers themselves: the activity log is seen by every member of staff.
    await logActivity(user, "ARTIST", act.id, first ? "added their pay details in the app" : "updated their pay details in the app");
    if (bankChanged(act, after)) {
      await logActivity(user, "ARTIST", act.id, "changed their bank details in the app");
      await notifyBankChange({ agencyId: user.agencyId, act, before: act, after, by: user.email });
    }
  });
  if (res?.error) return res;
  revalidatePath("/app", "layout");
  // The first time, straight on to their gigs; after a change, back to their details to see it.
  redirect(first ? "/app" : "/app/details?saved=1");
}

/** Show an act's full National Insurance number to an admin, once, and note who looked. */
export async function revealNiNumber(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const act = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId }, select: { id: true, niNumber: true } });
    if (!act?.niNumber) throw new FormError("No National Insurance number on file");
    await logActivity(user, "ARTIST", act.id, "viewed the National Insurance number");
    return { ok: formatNi(act.niNumber) };
  });
}
