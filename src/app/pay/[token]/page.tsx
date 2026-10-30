import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { startCardPayment } from "@/actions/card-payments";
import { ActionForm, SubmitButton } from "@/components/forms";
import { cardPaymentsReady, loadPayLink } from "@/lib/card-payments";
import { formatMoney } from "@/lib/money";
import { PAY_KIND_LABELS } from "@/lib/pay-links";

// "Pay now": a private link (no login) where a venue or customer pays a deposit or balance by
// card, into the agency's own Stripe account. Shows what they pay, as on their invoice: never
// what the acts are paid.

export const metadata: Metadata = { title: "Pay by card", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  if (!token || token.length < 20) notFound();
  const t = await loadPayLink({ token });
  if (!t) notFound();
  const m = (x: number) => formatMoney(x, t.currency);
  const label = PAY_KIND_LABELS[t.kind];
  const justPaid = paid === "1";
  const canPay = t.open && cardPaymentsReady(t.agency) && t.dueMinor > 0 && !justPaid;

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <div className="text-sm font-medium text-ink-500">{t.brand}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t.kind === "DEPOSIT" ? "Pay your deposit" : "Pay your balance"}</h1>
          <p className="mt-1 text-ink-600">{t.what}</p>
        </div>

        {justPaid && (
          <div role="status" className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-emerald-900">
            <div className="font-semibold">Thank you, your payment has gone through.</div>
            <div className="mt-1 text-sm">Stripe will email you a receipt. It can take a minute to show below.</div>
          </div>
        )}

        {!t.open ? (
          <section className="card card-pad text-sm text-ink-700">This link isn&apos;t valid any more. Please get in touch with {t.brand}.</section>
        ) : (
          <>
            <section className="card card-pad">
              <table className="w-full text-sm">
                <tbody>
                  {t.lines.map(([what, amount], i) => (
                    <tr key={i} className="border-b border-ink-100">
                      <td className="py-2.5 pr-4">{what}</td>
                      <td className="py-2.5 text-right whitespace-nowrap tabular-nums">{m(amount)}</td>
                    </tr>
                  ))}
                  {t.vatMinor > 0 && (
                    <tr className="border-b border-ink-100">
                      <td className="py-2.5 pr-4 text-ink-500">{t.vatLabel}</td>
                      <td className="py-2.5 text-right tabular-nums">{m(t.vatMinor)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="pt-3 pb-1 font-semibold">Total</td>
                    <td className="pt-3 pb-1 text-right font-semibold tabular-nums">{m(t.totalMinor)}</td>
                  </tr>
                  {t.paidMinor > 0 && (
                    <tr>
                      <td className="py-1 text-ink-500">Paid so far</td>
                      <td className="py-1 text-right tabular-nums">−{m(t.paidMinor)}</td>
                    </tr>
                  )}
                  {t.kind === "DEPOSIT" && t.depositMinor > 0 && (
                    <tr>
                      <td className="py-1 text-ink-500">Deposit</td>
                      <td className="py-1 text-right tabular-nums">{m(t.depositMinor)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-4 flex items-end justify-between gap-4 rounded-xl bg-ink-50 px-4 py-3">
                <div>
                  <div className="text-sm text-ink-500">{t.dueMinor > 0 ? `${label} due now` : "Due now"}</div>
                  <div className="text-2xl font-semibold tracking-tight tabular-nums">{m(t.dueMinor)}</div>
                </div>
                {t.reference && <div className="text-right text-xs text-ink-500">Ref {t.reference}</div>}
              </div>
            </section>

            <div className="mt-6">
              {canPay ? (
                <ActionForm action={startCardPayment.bind(null, token)}>
                  <SubmitButton className="btn btn-primary h-12 w-full text-base" pendingText="Opening secure payment…">
                    Pay {m(t.dueMinor)} by card
                  </SubmitButton>
                </ActionForm>
              ) : (
                !justPaid && (
                  <p className="card card-pad text-sm text-ink-700">
                    {t.dueMinor <= 0
                      ? t.kind === "DEPOSIT"
                        ? "Your deposit is paid. Thank you!"
                        : "Nothing left to pay. Thank you!"
                      : `Card payments aren't available right now. Please get in touch with ${t.brand}.`}
                  </p>
                )
              )}
            </div>
          </>
        )}
        <p className="mt-6 text-center text-xs text-ink-400">Payments are taken securely by Stripe for {t.brand}. This page is private to you.</p>
      </div>
    </div>
  );
}
