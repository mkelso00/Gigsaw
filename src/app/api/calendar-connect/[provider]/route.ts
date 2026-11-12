import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  calendarAuthorizeUrl,
  calendarProviders,
  calendarRedirectUri,
  canConnectCalendar,
  FLOW_COOKIE,
  FLOW_PATH,
  newCalendarFlow,
} from "@/lib/calendar-connect";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { parseProvider, PROVIDERS, providerCredentials } from "@/lib/oauth";
import { saveSignedCookie } from "@/lib/oauth-flow";

export const dynamic = "force-dynamic";

/** Starts connecting an act's Google or Outlook calendar: remembers state, PKCE verifier, nonce and who started it, then off to the provider. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  // Signed in, in an active business that isn't locked, and an act's login.
  const user = await requireUser(["ARTIST"]);
  if (!canConnectCalendar(user)) redirect("/app?calendar=not_act#calendar");
  const provider = parseProvider((await params).provider);
  const creds = provider && calendarProviders().includes(provider) ? providerCredentials(provider) : null;
  if (!provider || !creds) redirect(`/app?calendar=off${provider ? `&p=${provider}` : ""}#calendar`);

  // Reconnecting: suggest the account that's connected now, so the act doesn't pick another by mistake.
  const existing = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: PROVIDERS[provider].db } },
    select: { accountEmail: true },
  });
  const flow = newCalendarFlow(provider, user.id);
  await saveSignedCookie(FLOW_COOKIE, flow, FLOW_PATH);
  redirect(
    calendarAuthorizeUrl(flow, {
      clientId: creds.clientId,
      redirectUri: calendarRedirectUri(provider, appUrl()),
      loginHint: existing?.accountEmail || undefined,
    }),
  );
}
