"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { CLAIM_ANSWER, claimLockedMessage, claimLockedUntil, recordClaimAttempt, sendClaimLink } from "@/lib/act-claim";
import { clientIp } from "@/lib/client-ip";
import { FormError, handleForm, required, type FormState } from "@/lib/forms";
import { isEmail } from "@/lib/messaging";
import { log } from "@/server/log";

/** "First time? Set up your login": email a link to set a password. Same answer whether or not the email is on file. */
export async function requestClaimLink(_: FormState, form: FormData): Promise<FormState> {
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    if (!isEmail(email) || email.length > 254) throw new FormError("Check your email address, like name@example.com");
    const ip = clientIp(await headers());
    // Counted whether or not the email is on file, so the limit says nothing about it either.
    const until = await claimLockedUntil(email, ip);
    if (until) throw new FormError(claimLockedMessage(until));
    await recordClaimAttempt(email, ip);
    // Looked up and sent once the answer has gone, so the time it takes doesn't give anything away.
    after(async () => {
      try {
        await sendClaimLink(email);
      } catch (e) {
        log.error("Couldn't send a login set-up link", { err: e });
      }
    });
    return { ok: CLAIM_ANSWER };
  });
}
