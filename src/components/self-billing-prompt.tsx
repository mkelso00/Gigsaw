import Link from "next/link";
import { payHoldersFor } from "@/lib/payee-server";
import { agreementState } from "@/lib/self-billing";

/**
 * The act app's nudge to agree to self-billing (src/lib/self-billing.ts): shown when this login's pay details have
 * no current agreement, which is mostly a year after they last agreed. Their invoices are still made meanwhile.
 */
export async function SelfBillingPrompt({ user, agency }: { user: { agencyId: string; artistId: string | null; personId: string | null }; agency: string }) {
  const states = (await payHoldersFor(user)).map((h) => agreementState(h.selfBillingAgreedAt));
  if (!states.some((s) => s !== "current")) return null;
  const renewing = states.includes("expired");
  return (
    <Link
      href="/app/details#self-billing"
      data-testid="self-billing-prompt"
      className="flex items-center justify-between gap-3 rounded-2xl border border-volt-400/40 bg-ink-900 px-5 py-4 hover:bg-white/[0.03]"
    >
      <span className="min-w-0">
        <span className="block font-medium">{renewing ? "Please confirm self-billing again" : "Please agree to self-billing"}</span>
        <span className="block text-sm text-ink-400">
          {renewing
            ? `It's been a year since you agreed that ${agency} makes out your invoices for you. It takes a moment.`
            : `So ${agency} can make out your invoices for you. It takes a moment.`}
        </span>
      </span>
      <span className="shrink-0 text-volt-400" aria-hidden>
        →
      </span>
    </Link>
  );
}
