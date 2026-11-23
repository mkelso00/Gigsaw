"use server";

import { revalidatePath } from "next/cache";
import { sendClaimLink, CLAIM_HOURS } from "@/lib/act-claim";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { canBookAct } from "@/lib/book-signed-up";
import { loadBookableActs, signupLinkTo } from "@/lib/book-signed-up-server";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, type FormState } from "@/lib/forms";
import { userByEmail } from "@/lib/oauth-flow";

// On an act's page: "Approved to book before signing up" (admins only) and "Send sign-up link", for businesses that
// only book acts who've signed up to Gigsaw (src/lib/book-signed-up.ts).

/** Approve an act to be booked before it signs up, or take that back. Admins only. */
export async function setBookBeforeSignup(artistId: string, approve: boolean, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const act = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId }, select: { id: true, name: true } });
    if (!act) throw new FormError("Act not found");
    await prisma.artist.update({
      where: { id: act.id },
      data: approve ? { bookBeforeSignupAt: new Date(), bookBeforeSignupById: user.id } : { bookBeforeSignupAt: null, bookBeforeSignupById: null },
    });
    await logActivity(user, "ARTIST", act.id, approve ? "approved to book before signing up" : "took back approval to book before signing up", act.name);
    revalidatePath("/", "layout");
    return { ok: approve ? `${act.name} can be booked before signing up.` : `${act.name} can't be booked until they sign up.` };
  });
}

/**
 * Email the act (a band's lead) the link to set up their Gigsaw login: the same link "First time? Set up your
 * login" sends (src/lib/act-claim.ts), so they choose a password and add their pay details.
 */
export async function sendActSignupLink(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const act = (await loadBookableActs(user.agencyId, [artistId])).get(artistId);
    if (!act) throw new FormError("Act not found");
    if (canBookAct({ ...act, bookBeforeSignupAt: null }).ok) return { ok: `${act.name} has already signed up.` };
    const to = signupLinkTo(act);
    if ("error" in to) throw new FormError(to.error);
    if ((await prisma.artist.findUnique({ where: { id: act.id }, select: { demo: true } }))?.demo)
      throw new FormError(`${act.name} is a sample act from the demo data, so it can't sign up.`);
    const email = to.email.trim().toLowerCase();
    // A login with this email that isn't this act's (or its people's) would get a reset link for someone else's account.
    const existing = await userByEmail(email);
    const ours = [act.login?.email, ...act.people.map((p) => p.login?.email)].some((e) => e?.toLowerCase() === email);
    if (existing && !ours) throw new FormError(`${email} is already someone else's Gigsaw login. Give ${to.name} a different email, then send the link.`);
    const sent = await sendClaimLink(email);
    if (sent === "limited") throw new FormError("A link was sent to them a moment ago. Wait a few minutes before sending another.");
    if (sent === "none") throw new FormError(`Couldn't send a link to ${email}. Check it's ${to.name}'s email on file.`);
    await logActivity(user, "ARTIST", act.id, "sent their sign-up link", email);
    revalidatePath(`/artists/${act.id}`);
    return {
      ok:
        sent === "claim"
          ? `Sign-up link sent to ${email}. It works for ${CLAIM_HOURS} hours.`
          : `${email} already has a login, so they've been sent a link to set their password.`,
    };
  });
}
