import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { takeSignedCookie } from "@/lib/oauth-flow";
import { finishXeroConnect, XERO_FLOW_COOKIE, XERO_FLOW_PATH, xeroRedirectUri, type XeroFlow } from "@/lib/xero";

export const dynamic = "force-dynamic";

/**
 * Where Xero sends the admin back after they allow (or refuse) access. The checks and saving are in
 * finishXeroConnect (src/lib/xero.ts); this reads the cookie and sends them back to Settings, Xero.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  // Used up on reading, so the same answer can't be replayed.
  const flow = await takeSignedCookie<XeroFlow>(XERO_FLOW_COOKIE, XERO_FLOW_PATH);
  const user = await requireAdmin();
  const { result } = await finishXeroConnect(
    user,
    flow,
    { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") },
    { redirectUri: xeroRedirectUri(appUrl()) },
  );
  if (result === "connected" || result === "choose") await logActivity(user, "SETTINGS", user.agencyId, "connected Xero");
  redirect(`/settings/xero?xero=${result}`);
}
