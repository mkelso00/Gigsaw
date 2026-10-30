import { redirect } from "next/navigation";
import { createSession, currentUser, homePath } from "@/lib/auth";
import { appUrl } from "@/lib/messaging";
import { checkCallback, exchangeCode, OAuthError, parseProvider, providerCredentials, redirectUri, verifyIdToken, type Identity } from "@/lib/oauth";
import { findUserForIdentity, linkToUser, savePendingSignup, takeFlow } from "@/lib/oauth-flow";

export const dynamic = "force-dynamic";

/**
 * Where Google or Microsoft send the browser back. Checks state, swaps the code (with the PKCE
 * verifier) for an id_token, checks the token, then signs in, starts a sign-up, or connects the
 * account to the person signed in, depending on what was started.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = parseProvider((await params).provider);
  const sp = new URL(req.url).searchParams;
  const flow = await takeFlow();
  const back = (intent: string | undefined, code: string, extra = "") =>
    `${intent === "signup" ? "/signup" : intent === "link" ? "/profile" : "/login"}?oauth=${code}${provider ? `&p=${provider}` : ""}${extra}${intent === "link" ? "#sign-in" : ""}`;

  const creds = provider ? providerCredentials(provider) : null;
  if (!provider || !creds) redirect(back(flow?.intent, "off"));
  const checked = checkCallback(flow, provider, { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") });
  if (!checked.ok) redirect(back(flow?.intent, checked.problem));
  const { intent } = checked.flow;

  let identity: Identity;
  try {
    const uri = redirectUri(provider, appUrl());
    const idToken = await exchangeCode(provider, { code: checked.code, verifier: checked.flow.verifier, ...creds, redirectUri: uri });
    identity = await verifyIdToken(provider, idToken, { clientId: creds.clientId, nonce: checked.flow.nonce });
  } catch (e) {
    console.error(`[oauth] ${provider} sign in failed:`, e instanceof OAuthError ? e.message : e);
    redirect(back(intent, "failed"));
  }

  if (intent === "link") {
    const me = await currentUser();
    if (!me) redirect("/login");
    redirect(back("link", await linkToUser(me.id, identity)));
  }

  const found = await findUserForIdentity(identity);
  if (found.user) {
    await createSession(found.user.id);
    redirect(homePath(found.user));
  }
  if (intent === "signup" && found.problem === "no_account" && identity.email) {
    // A new business: fill in the sign-up form with their name and email, no password needed.
    await savePendingSignup(identity);
    redirect(`/signup?with=${provider}`);
  }
  redirect(back(intent, found.problem ?? "failed", found.problem === "no_account" && identity.email ? `&email=${encodeURIComponent(identity.email)}` : ""));
}
