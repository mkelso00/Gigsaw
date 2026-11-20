"use server";

import { requireStaff } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import type { FormState } from "@/lib/forms";
import { remindPayeeNow } from "@/lib/pay-details-chase";

/** "Remind now" on Pay acts: emails and notifies the act's payee to add their pay details or agree to self-billing. */
export async function remindPayDetailsNow(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  const r = await remindPayeeNow(user.agencyId, artistId);
  if ("error" in r) return { error: r.error };
  await logActivity(user, "ARTIST", artistId, "reminded them to add their pay details");
  return { ok: r.ok };
}
