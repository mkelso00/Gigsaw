import type { Metadata } from "next";
import Link from "next/link";
import { ActDetailsForm } from "@/components/pay-details";
import { needsDetails, PAY_REASON } from "@/lib/act-details";
import { payActsFor } from "@/lib/act-details-server";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "Your details" };
export const dynamic = "force-dynamic";

// Your details: bank account, address and National Insurance number. Every other page of the act
// app sends the act here until these are in (requireActApp), and they can come back to change them.
export default async function YourDetailsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser(["ARTIST"]);
  const [acts, settings, sp] = await Promise.all([payActsFor(user), getSettings(user.agencyId), searchParams]);
  const agency = settings.agencyName || "Your agency";
  const gate = acts.some(needsDetails);

  return (
    <div className="space-y-6">
      <div>
        {!gate && (
          <Link href="/app" className="mb-3 inline-block text-sm text-ink-400 hover:text-white">
            ← My bookings
          </Link>
        )}
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Your details</h1>
        <p className="mt-2 text-[15px] text-ink-300">
          {PAY_REASON} {agency} uses these to pay you after each gig and to make your invoices for you.
        </p>
        {gate && <p className="mt-2 text-sm text-ink-400">It takes a minute, and you only do it once.</p>}
      </div>
      {sp.saved === "1" && !gate && (
        <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          Saved. Thanks, your details are up to date.
        </p>
      )}
      {acts.length ? (
        acts.map((a) => <ActDetailsForm key={a.id} act={a} showName={acts.length > 1} />)
      ) : (
        <p className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5 text-sm text-ink-400">
          {agency} looks after the pay details for your acts. Ask them if anything needs changing.
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-500">
        Only you and {agency}&apos;s admins can see these. They&apos;re never shown to venues or customers.
      </p>
    </div>
  );
}
