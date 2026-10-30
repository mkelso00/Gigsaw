import Link from "next/link";
import type { PayLink } from "@prisma/client";
import { emailPayLink, makePayLink } from "@/actions/card-payments";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { payUrl } from "@/lib/card-payments";
import { formatMoney } from "@/lib/money";
import { amountDue, PAY_KIND_LABELS, PAY_KINDS, type PayGig } from "@/lib/pay-links";
import { formatDateTime } from "@/lib/time";

// "Pay by card" on a booking or a wedding: a link for the deposit and one for the balance, to
// copy or email to whoever pays. Staff only.

export function PayLinksCard({
  target,
  id,
  gigs,
  links,
  currency,
  ready,
  isAdmin,
  email,
  timezone,
}: {
  target: "booking" | "event";
  id: string;
  /** The gigs being paid for, soonest first. */
  gigs: PayGig[];
  links: PayLink[];
  currency: string;
  /** The agency has connected Stripe and can take cards. */
  ready: boolean;
  isAdmin: boolean;
  /** Who usually pays: filled in as the address to send to. */
  email: string;
  timezone: string;
}) {
  const payer = target === "booking" ? "the venue or client" : "the customer";
  const rows = PAY_KINDS.map((kind) => ({ kind, due: amountDue(kind, gigs), link: links.find((l) => l.kind === kind) })).filter((r) => r.due > 0);
  const noDeposit = target === "event" && gigs.length > 0 && gigs.every((g) => g.depositMinor <= 0);
  return (
    <section className="card card-pad">
      <h2 className="section-title">Pay by card</h2>
      {!ready ? (
        <p className="mt-1 text-sm text-ink-500">
          Send {payer} a link to pay by card, straight into your Stripe account.{" "}
          {isAdmin ? (
            <Link href="/settings/card-payments" className="link">
              Connect Stripe
            </Link>
          ) : (
            "Ask an admin to connect Stripe in Settings."
          )}
        </p>
      ) : !rows.length ? (
        <p className="mt-1 text-sm text-ink-500">{gigs.length ? "Nothing left to pay." : "Add an act first."}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-500">A private link for {payer} to pay by card. It always asks for what&apos;s still due.</p>
          <div className="mt-3 divide-y divide-ink-100">
            {rows.map(({ kind, due, link }) => (
              <div key={kind} className="space-y-2 py-3 last:pb-0">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-medium">{kind === "DEPOSIT" ? "Deposit" : "Balance"}</span>
                  <span className="tabular-nums">{formatMoney(due, currency)}</span>
                </div>
                {link ? (
                  <>
                    <CopyField value={payUrl(link.token)} />
                    <ActionForm action={emailPayLink.bind(null, link.id)} className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        name="to"
                        type="email"
                        defaultValue={email}
                        placeholder="Email address"
                        aria-label={`Email the ${PAY_KIND_LABELS[kind].toLowerCase()} link to`}
                        className="input min-w-0 flex-1"
                      />
                      <SubmitButton className="btn" pendingText="Sending…">
                        Email
                      </SubmitButton>
                    </ActionForm>
                    {link.sentAt && <p className="text-xs text-ink-500">Last emailed {formatDateTime(link.sentAt, timezone)}</p>}
                  </>
                ) : (
                  <ActionForm action={makePayLink.bind(null, target, id, kind)}>
                    <SubmitButton className="btn w-full" pendingText="Making…">
                      Make a {kind === "DEPOSIT" ? "deposit" : "balance"} link
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {ready && noDeposit && <p className="hint">To ask for a deposit by card, set a deposit on the acts&apos; bookings.</p>}
    </section>
  );
}
