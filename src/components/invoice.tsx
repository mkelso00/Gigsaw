import { DocumentShell } from "@/components/document";
import { payUrl } from "@/lib/card-payments";
import { formatMoney } from "@/lib/money";
import type { receivedOnInvoice } from "@/lib/pay-links";
import { formatDate } from "@/lib/time";

type InvoiceSettings = React.ComponentProps<typeof DocumentShell>["settings"] & { defaultTimezone: string; invoiceTerms: string };

/**
 * The customer invoice, shared by the booking print and the wedding or event print. The pages
 * work out who's billed and what for; this keeps the layout, the sums, the payments already
 * taken off and the card link the same on both.
 */
export function Invoice({
  reference,
  settings,
  currency,
  timeZone,
  billTo,
  details,
  lines,
  bookingFeeMinor,
  subtotalMinor,
  vat,
  totalMinor,
  received,
  balanceMinor,
  payLinkToken,
}: {
  reference: string;
  settings: InvoiceSettings;
  currency: string;
  /** For the dates of card payments. */
  timeZone: string;
  /** The lines under "Bill to". */
  billTo: React.ReactNode;
  /** The lines under the invoice date, e.g. the booking reference. */
  details: React.ReactNode;
  lines: { key: string; description: React.ReactNode; amountMinor: number }[];
  bookingFeeMinor: number;
  /** Shown as its own line when given; the VAT then sits with the sums rather than the items. */
  subtotalMinor?: number;
  vat: { label: React.ReactNode; amountMinor: number };
  totalMinor: number;
  received: ReturnType<typeof receivedOnInvoice>;
  balanceMinor: number;
  /** The card payment link, if one's been made and there's something to pay. */
  payLinkToken?: string | null;
}) {
  const money = (m: number) => formatMoney(m, currency);
  return (
    <DocumentShell title="Invoice" reference={reference} settings={settings}>
      <div className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="font-medium text-slate-500">Bill to</div>
          {billTo}
        </div>
        <div className="text-right">
          <div>
            <span className="text-slate-500">Invoice date</span> {formatDate(new Date(), settings.defaultTimezone)}
          </div>
          {details}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b border-slate-100">
              <td className="py-3">{l.description}</td>
              <td className="py-3 text-right">{money(l.amountMinor)}</td>
            </tr>
          ))}
          {bookingFeeMinor > 0 && (
            <tr className="border-b border-slate-100">
              <td className="py-3">Booking fee</td>
              <td className="py-3 text-right">{money(bookingFeeMinor)}</td>
            </tr>
          )}
          {subtotalMinor !== undefined && (
            <tr>
              <td className="py-2 text-right text-slate-500">Subtotal</td>
              <td className="py-2 text-right">{money(subtotalMinor)}</td>
            </tr>
          )}
          {vat.amountMinor > 0 && (
            <tr className={subtotalMinor === undefined ? "border-b border-slate-100" : undefined}>
              <td className="py-2 text-right text-slate-500">{vat.label}</td>
              <td className="py-2 text-right">{money(vat.amountMinor)}</td>
            </tr>
          )}
          <tr>
            <td className="py-2 text-right font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{money(totalMinor)}</td>
          </tr>
          {received.card.map((c, i) => (
            <tr key={i}>
              <td className="py-1 text-right text-slate-500">Paid by card, {formatDate(c.paidAt, timeZone)}</td>
              <td className="py-1 text-right">−{money(c.amountMinor)}</td>
            </tr>
          ))}
          {received.otherMinor > 0 && (
            <tr>
              <td className="py-1 text-right text-slate-500">{received.card.length ? "Other payments" : "Paid so far"}</td>
              <td className="py-1 text-right">−{money(received.otherMinor)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-300">
            <td className="py-3 text-right text-lg font-bold">Balance due</td>
            <td className="py-3 text-right text-lg font-bold">{money(balanceMinor)}</td>
          </tr>
        </tbody>
      </table>
      {payLinkToken && (
        <p className="mt-6 text-sm">
          <span className="font-medium">Pay by card:</span> <span className="break-all">{payUrl(payLinkToken)}</span>
        </p>
      )}
      {settings.invoiceTerms && <p className="mt-8 text-sm whitespace-pre-line text-slate-600">{settings.invoiceTerms}</p>}
    </DocumentShell>
  );
}
