import Link from "next/link";
import { markPaidDirect, setPayPlan } from "@/actions/pay-plan";
import { ActionForm, SubmitButton } from "@/components/forms";
import { actName } from "@/lib/constants";
import type { FullEvent } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { directSplit, directTotals, isDirectPlan, PAY_PLAN_HINTS, PAY_PLAN_LABELS, PAY_PLANS, type PayPlan } from "@/lib/pay-plan";

type BankOnFile = { name: string; hasBank: boolean };

/**
 * "How the couple pays": all to us, or the deposit to us and each act's fee straight to the act (cash on the
 * day or bank transfer). With the latter, each act's part is listed with a Mark paid button.
 */
export function PayPlanSection({ event: e, payees }: { event: FullEvent; payees: Map<string, BankOnFile | null> }) {
  const plan = (PAY_PLANS as readonly string[]).includes(e.payPlan) ? (e.payPlan as PayPlan) : "FULL";
  const live = e.bookings.filter((b) => b.status !== "CANCELLED" && b.status !== "ENQUIRY");
  const currency = live[0]?.currency ?? "GBP";
  const m = (x: number) => formatMoney(x, currency);
  const t = directTotals(live);
  return (
    <section className="card card-pad" id="pay-plan">
      <h2 className="section-title mb-3">How the couple pays</h2>
      <ActionForm action={setPayPlan.bind(null, e.id)} className="space-y-2">
        {PAY_PLANS.map((p) => (
          <label
            key={p}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 has-[:checked]:border-ink-950 has-[:checked]:bg-ink-50"
          >
            <input type="radio" name="payPlan" value={p} defaultChecked={plan === p} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-medium">{PAY_PLAN_LABELS[p]}</span>
              <span className="block text-xs text-ink-500">{PAY_PLAN_HINTS[p]}</span>
            </span>
          </label>
        ))}
        <SubmitButton className="btn btn-sm" pendingText="Saving…">
          Save
        </SubmitButton>
      </ActionForm>

      {isDirectPlan(plan) && live.length > 0 && (
        <div className="mt-5 border-t border-ink-100 pt-4">
          <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
            <span>
              Deposit to you: <strong>{m(t.toUs)}</strong>
              {t.usLeft > 0 ? <span className="text-amber-700"> ({m(t.usLeft)} still to come)</span> : <span className="text-emerald-700"> (paid)</span>}
            </span>
            <span>
              Straight to the acts: <strong>{m(t.toAct)}</strong>
            </span>
          </div>
          <ul className="divide-y divide-ink-100">
            {live.map((b) => {
              const s = directSplit(b);
              const payee = b.artistId ? payees.get(b.artistId) : null;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                      {actName(b)}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {m(s.toAct)} {plan === "DEPOSIT_CASH" ? "in cash on the day" : "by bank transfer"}
                      {plan === "DEPOSIT_TRANSFER" && payee && (payee.hasBank ? ` to ${payee.name}` : "")}
                    </span>
                    {plan === "DEPOSIT_TRANSFER" && b.artistId && !payee?.hasBank && (
                      <span className="block text-xs font-medium text-amber-700">
                        No bank details on file: the couple&apos;s page asks them to get in touch.
                      </span>
                    )}
                  </span>
                  {s.actLeft <= 0 ? (
                    <span className="text-xs font-medium text-emerald-700">Paid</span>
                  ) : b.artistId ? (
                    <ActionForm action={markPaidDirect.bind(null, b.id)}>
                      <SubmitButton className="btn btn-sm" pendingText="Saving…">
                        Mark {m(s.actLeft)} paid
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <span className="text-xs text-ink-500">No act yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
