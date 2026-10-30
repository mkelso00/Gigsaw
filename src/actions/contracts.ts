"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { checkSignature, checkSignerName, clientIp, contractHash } from "@/lib/contract-doc";
import { afterSigned, ContractError, liveContractDoc, sendContract, type ContractTarget } from "@/lib/contracts";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";

// Contracts signed online: staff send and cancel them; the client signs at /c/<token> with no login.

const entityOf = (t: { bookingId: string | null; eventId: string | null }) => (t.bookingId ? "BOOKING" : "EVENT");
const pathOf = (t: { bookingId: string | null; eventId: string | null }) => (t.bookingId ? `/bookings/${t.bookingId}` : `/events/${t.eventId}`);

/** "Send contract to sign" on a booking or a wedding or event. */
export async function sendContractToSign(kind: ContractTarget["kind"], id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const target: ContractTarget = { kind: kind === "event" ? "event" : "booking", id };
    let result;
    try {
      result = await sendContract(user, target, { name: str(form, "signerName"), email: str(form, "signerEmail") });
    } catch (e) {
      if (e instanceof ContractError) throw new FormError(e.message);
      throw e;
    }
    const c = result.contract;
    await logActivity(user, entityOf(c), id, result.resent ? "sent the contract again" : "sent the contract to sign", `${c.signerName} <${c.signerEmail}>`);
    revalidatePath(pathOf(c));
    return {
      ok: result.sent
        ? `Contract ${result.resent ? "sent again" : "sent"} to ${c.signerEmail}.`
        : "Contract ready, but no email went (demo data). Copy the link and send it yourself.",
    };
  });
}

/** Withdraw an unsigned contract: its link stops working. */
export async function cancelContract(contractId: string) {
  const user = await requireStaff();
  const c = await prisma.contract.findFirst({ where: { id: contractId, agencyId: user.agencyId, status: "SENT" } });
  if (!c) return;
  await prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await logActivity(user, entityOf(c), (c.bookingId ?? c.eventId)!, "cancelled the contract sent to sign", c.signerName);
  revalidatePath(pathOf(c));
}

/**
 * The client signs. `hash` is the fingerprint of the contract as their page showed it: if the
 * booking has changed since they opened it, they're asked to read it again rather than signing
 * something they haven't seen.
 */
export async function signContract(token: string, hash: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await handleForm(async () => {
    if (!token || token.length < 20) throw new FormError("This link isn't valid.");
    const c = await prisma.contract.findUnique({ where: { token }, include: { agency: { select: { status: true } } } });
    if (!c || c.agency.status !== "ACTIVE") throw new FormError("This link isn't valid any more. Please contact us.");
    if (c.status === "CANCELLED") throw new FormError("This contract has been withdrawn. Please contact us for a new one.");
    if (c.status === "SIGNED") return { ok: "signed" };
    const live = await liveContractDoc(c);
    if (!live || live.cancelled) throw new FormError("This contract isn't available any more. Please contact us.");
    if (contractHash(live.doc) !== hash) throw new FormError("The contract has just been updated. Please reload the page and read it again before signing.");

    const name = checkSignerName(str(form, "signedName"));
    if (!name) throw new FormError("Type your full name");
    const signature = checkSignature(str(form, "signature"));
    if (!signature) throw new FormError("Draw your signature in the box");
    if (form.get("agree") !== "on") throw new FormError("Tick the box to say you agree to the contract");

    const h = await headers();
    // Only an unsigned contract can be signed, so two taps at once can't sign it twice.
    const done = await prisma.contract.updateMany({
      where: { id: c.id, status: "SENT" },
      data: {
        status: "SIGNED",
        signedAt: new Date(),
        signedName: name,
        signature,
        signedIp: clientIp((k) => h.get(k)),
        signedAgent: (h.get("user-agent") ?? "").slice(0, 500),
        contentHash: hash,
        content: live.doc,
      },
    });
    if (!done.count) return { ok: "signed" };
    await prisma.activity.create({
      data: { agencyId: c.agencyId, entity: entityOf(c), entityId: (c.bookingId ?? c.eventId)!, action: "client signed the contract", detail: name },
    });
    try {
      await afterSigned(c.id);
    } catch (e) {
      // The contract is signed either way; a message that fails is in the Outbox.
      console.error("Contract signed, but the emails after it failed", e);
    }
    return { ok: "signed" };
  });
  if (result?.ok) {
    revalidatePath(`/c/${token}`);
    redirect(`/c/${token}`);
  }
  return result;
}
