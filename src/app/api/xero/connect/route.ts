import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { appUrl } from "@/lib/messaging";
import { saveSignedCookie } from "@/lib/oauth-flow";
import { newXeroFlow, XERO_FLOW_COOKIE, XERO_FLOW_PATH, xeroAuthorizeUrl, xeroRedirectUri, xeroSetup } from "@/lib/xero";

export const dynamic = "force-dynamic";

/**
 * Starts connecting the business's Xero (Settings, Xero): remembers a random state and who started it in a signed
 * cookie only /api/xero sees, then sends the admin to Xero to sign in and choose the organisation.
 */
export async function GET() {
  const user = await requireAdmin();
  if (xeroSetup() !== "ready") redirect("/settings/xero?xero=off");
  const flow = newXeroFlow(user);
  await saveSignedCookie(XERO_FLOW_COOKIE, flow, XERO_FLOW_PATH);
  redirect(xeroAuthorizeUrl(flow, { redirectUri: xeroRedirectUri(appUrl()) }));
}
