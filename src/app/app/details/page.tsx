import type { Metadata } from "next";
import Link from "next/link";
import { ActDetailsForm } from "@/components/pay-details";
import { needsDetails, PAY_REASON } from "@/lib/act-details";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { leadOf } from "@/lib/payee";
import { loadPayActs, payHoldersFor } from "@/lib/payee-server";
import { personName } from "@/lib/person-name";
import { agreementState, selfBillingWording } from "@/lib/self-billing";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Your details" };
export const dynamic = "force-dynamic";

// Your details: bank account, address and National Insurance number. Every other page of the act app
// sends the login here until these are in (requireActApp), and they can come back to change them. A
// person fills in their own, even in a band: the band's invoices go to its lead (src/lib/payee.ts).
export default async function YourDetailsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser(["ARTIST"]);
  const [holders, settings, sp] = await Promise.all([payHoldersFor(user), getSettings(user.agencyId), searchParams]);
  const agency = settings.agencyName || "Your agency";
  const wording = selfBillingWording(settings.selfBillingAgreementText, settings.agencyName);
  const gate = holders.some(needsDetails);
  // A band's own login when its lead gives their own details: say who that is.
  const lead = !holders.length && user.artistId ? leadOf((await loadPayActs(user.agencyId, [user.artistId])).get(user.artistId) ?? noAct) : null;

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
      {holders.length ? (
        holders.map((h) => {
          const state = agreementState(h.selfBillingAgreedAt);
          const selfBilling = {
            wording: state === "current" ? h.selfBillingAgreedText || wording : wording,
            agreedOn: state === "current" && h.selfBillingAgreedAt ? formatDate(h.selfBillingAgreedAt, settings.defaultTimezone) : null,
            renewing: state === "expired",
          };
          return <ActDetailsForm key={h.id} holder={h} showName={holders.length > 1} selfBilling={selfBilling} />;
        })
      ) : (
        <p className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5 text-sm text-ink-400">
          {lead
            ? `${agency} makes the band's invoices out to ${personName(lead)}, who adds their own details from their login.`
            : `${agency} looks after the pay details for your acts.`}{" "}
          Ask them if anything needs changing.
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-500">
        Only you and {agency}&apos;s admins can see these. They&apos;re never shown to venues, customers or anyone else in your act.
      </p>
    </div>
  );
}

const noAct = { members: [], partPeople: [], leadPersonId: null };
