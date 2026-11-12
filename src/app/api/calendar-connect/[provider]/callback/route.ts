import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { calendarRedirectUri, finishConnect, FLOW_COOKIE, FLOW_PATH, type CalendarFlow } from "@/lib/calendar-connect";
import { appUrl } from "@/lib/messaging";
import { parseProvider } from "@/lib/oauth";
import { takeSignedCookie } from "@/lib/oauth-flow";

export const dynamic = "force-dynamic";

/**
 * Where Google or Microsoft send the act back after they allow (or refuse) calendar access. The checks and
 * saving are in finishConnect (src/lib/calendar-connect.ts); this reads the cookie and sends them back to the app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = parseProvider((await params).provider);
  const sp = new URL(req.url).searchParams;
  // Used up on reading, so the same answer can't be replayed.
  const flow = await takeSignedCookie<CalendarFlow>(FLOW_COOKIE, FLOW_PATH);
  // Signed in, in an active business that isn't locked, and an act's login (finishConnect also checks it's an act's own).
  const user = await requireUser(["ARTIST"]);
  const { result } = await finishConnect(
    user,
    provider,
    flow,
    { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") },
    { redirectUri: provider ? calendarRedirectUri(provider, appUrl()) : "" },
  );
  redirect(`/app?calendar=${result}${provider ? `&p=${provider}` : ""}#calendar`);
}
