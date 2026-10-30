import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { onboardingLink } from "@/lib/card-payments";
import { appUrl } from "@/lib/messaging";

// Stripe sends the admin here when an onboarding link has expired or was already used: make a
// fresh one and carry on.
export async function GET() {
  const user = await requireAdmin();
  const back = `${appUrl()}/settings/card-payments`;
  if (!user.agency?.stripeAccountId) return NextResponse.redirect(back);
  try {
    return NextResponse.redirect(await onboardingLink(user.agency.stripeAccountId));
  } catch {
    return NextResponse.redirect(`${back}?error=1`);
  }
}

export const dynamic = "force-dynamic";
