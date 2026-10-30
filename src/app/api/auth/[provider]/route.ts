import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { appUrl } from "@/lib/messaging";
import { authorizeUrl, newFlow, parseProvider, providerCredentials, redirectUri, type OAuthIntent } from "@/lib/oauth";
import { saveFlow } from "@/lib/oauth-flow";

export const dynamic = "force-dynamic";

const INTENTS: OAuthIntent[] = ["login", "signup", "link"];

/** Starts "Sign in with Google/Microsoft": remembers state, PKCE verifier and nonce, then off to the provider. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = parseProvider((await params).provider);
  const raw = new URL(req.url).searchParams.get("intent") ?? "login";
  const intent = INTENTS.includes(raw as OAuthIntent) ? (raw as OAuthIntent) : "login";
  const back = intent === "signup" ? "/signup" : intent === "link" ? "/profile" : "/login";
  const creds = provider ? providerCredentials(provider) : null;
  if (!provider || !creds) redirect(`${back}?oauth=off`);
  // Connecting an account is for someone already signed in.
  if (intent === "link" && !(await currentUser())) redirect("/login");

  const flow = newFlow(provider, intent);
  await saveFlow(flow);
  redirect(authorizeUrl(flow, { clientId: creds.clientId, redirectUri: redirectUri(provider, appUrl()) }));
}
