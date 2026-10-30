"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseProvider, PROVIDERS } from "@/lib/oauth";
import { clearPendingSignup, signInMethods } from "@/lib/oauth-flow";

/** Disconnect Google or Microsoft from your login, as long as there's another way left to sign in. */
export async function disconnectSignIn(provider: string) {
  const user = await requireSignedIn();
  const p = parseProvider(provider);
  if (!p) return;
  const methods = await signInMethods(user);
  const target = methods.linked.find((l) => l.provider === PROVIDERS[p].db);
  if (!target) redirect("/profile#sign-in");
  // Never leave someone with no way back in.
  if (methods.count <= 1) redirect(`/profile?oauth=last&p=${p}#sign-in`);
  await prisma.linkedAccount.deleteMany({ where: { id: target.id, userId: user.id } });
  revalidatePath("/profile");
  redirect(`/profile?oauth=disconnected&p=${p}#sign-in`);
}

/** Sign up with an email and password instead of the Google or Microsoft account just chosen. */
export async function forgetPendingSignup() {
  await clearPendingSignup();
  redirect("/signup");
}
