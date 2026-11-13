"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { defaultBookingFee, formatMoney, minorToInput, toMinor } from "@/lib/money";

/**
 * Cost (what the act is paid) and sale (what the venue or customer pays), with what the agency makes
 * worked out as you type. Booking fee, VAT, currency and anything passed as `more` (deposit, notes)
 * sit under "More money options", which starts open when any of them is already in use. On a new
 * booking the agency's default booking fee fills in to match the booking type, until it's typed over.
 */
export function MoneyFields({
  currency,
  currencies,
  sale,
  cost,
  vatPct,
  bookingFee,
  feeDefaults,
  more,
  moreInUse = false,
}: {
  currency: string;
  currencies: readonly string[];
  sale: string;
  cost: string;
  vatPct: number;
  bookingFee: string;
  /** New bookings only: the agency's default booking fee and what it's added to. */
  feeDefaults?: { bookingFeeMinor: number; bookingFeeFor: string };
  /** Extra fields for the "More money options" section. */
  more?: React.ReactNode;
  /** Open "More money options" from the start, because something in `more` is already filled in. */
  moreInUse?: boolean;
}) {
  const [cur, setCur] = useState(currency);
  const [saleIn, setSale] = useState(sale);
  const [costIn, setCost] = useState(cost);
  const [vatIn, setVat] = useState(String(vatPct));
  const [feeIn, setFee] = useState(bookingFee);
  const feeTouched = useRef(false);
  // Decided once, from what the booking already has: a default booking fee filling in on a new booking
  // doesn't unfold it, and opening or closing it by hand sticks.
  const [startOpen] = useState(() => moreInUse || !!bookingFee || vatPct > 0);
  const box = useRef<HTMLDivElement>(null);

  // Follow the booking type chosen elsewhere in the form until the fee is typed over.
  useEffect(() => {
    if (!feeDefaults) return;
    const select = box.current?.closest("form")?.querySelector<HTMLSelectElement>('select[name="eventType"]');
    if (!select) return;
    const apply = () => {
      if (feeTouched.current) return;
      const f = defaultBookingFee(feeDefaults, { eventType: select.value });
      setFee(f ? minorToInput(f, cur) : "");
    };
    apply();
    select.addEventListener("change", apply);
    return () => select.removeEventListener("change", apply);
  }, [feeDefaults, cur]);

  const read = (s: string) => {
    try {
      return toMinor(s, cur);
    } catch {
      return null;
    }
  };
  const saleMinor = read(saleIn);
  const costMinor = read(costIn);
  const feeMinor = read(feeIn) ?? 0;
  const vat = Number(vatIn) || 0;
  const profit = saleMinor !== null && costMinor !== null ? saleMinor - costMinor + feeMinor : null;
  const vatMinor = saleMinor !== null ? Math.round(((saleMinor + feeMinor) * vat) / 100) : 0;

  return (
    <div ref={box} className="space-y-4">
      <input type="hidden" name="dealType" value="BUY_SELL" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cost: we pay the act" hint="Only the act sees this">
          <input name="artistFee" inputMode="decimal" value={costIn} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className="input" />
        </Field>
        <Field label="Sale: the venue or customer pays" hint="Only the venue or customer sees this">
          <input name="fee" inputMode="decimal" value={saleIn} onChange={(e) => setSale(e.target.value)} placeholder="0.00" className="input" />
        </Field>
      </div>
      <SummaryRow saleMinor={saleMinor} costMinor={costMinor} feeMinor={feeMinor} vatMinor={vatMinor} profit={profit} cur={cur} />
      {/* Closed details still send their fields with the form, so nothing here is lost when it's folded away. */}
      <details open={startOpen || undefined} className="group rounded-xl border border-ink-200">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-700 select-none hover:text-ink-950">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
          More money options
          <span className="ml-2 font-normal text-ink-500">Booking fee, VAT, currency, deposit, notes</span>
        </summary>
        <div className="space-y-4 border-t border-ink-100 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Booking fee" hint="On top, paid by the venue or client. All ours; acts never see it">
              <input
                name="bookingFee"
                inputMode="decimal"
                value={feeIn}
                onChange={(e) => {
                  feeTouched.current = true;
                  setFee(e.target.value);
                }}
                placeholder="0.00"
                className="input"
              />
            </Field>
            <Field label="VAT %" hint="On what the venue or client pays">
              <input name="vatPct" inputMode="decimal" value={vatIn} onChange={(e) => setVat(e.target.value)} className="input" />
            </Field>
            <Field label="Currency">
              <select name="currency" value={cur} onChange={(e) => setCur(e.target.value)} className="input">
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          {more}
        </div>
      </details>
    </div>
  );
}

function SummaryRow({
  saleMinor,
  costMinor,
  feeMinor,
  vatMinor,
  profit,
  cur,
}: {
  saleMinor: number | null;
  costMinor: number | null;
  feeMinor: number;
  vatMinor: number;
  profit: number | null;
  cur: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl border border-ink-200 p-4 text-sm">
      <div>
        <div className="text-ink-600">Act is paid</div>
        <div className="text-lg font-semibold">{costMinor !== null ? formatMoney(costMinor, cur) : "-"}</div>
      </div>
      <div>
        <div className="text-ink-600">Venue or customer pays</div>
        <div className="text-lg font-semibold">{saleMinor !== null ? formatMoney(saleMinor + feeMinor, cur) : "-"}</div>
        {feeMinor > 0 && <div className="text-xs text-ink-600">incl. {formatMoney(feeMinor, cur)} booking fee</div>}
        {vatMinor > 0 && <div className="text-xs text-ink-600">+ {formatMoney(vatMinor, cur)} VAT</div>}
      </div>
      <div>
        <div className="text-ink-600">We make</div>
        <div className={`text-lg font-semibold ${profit !== null && profit < 0 ? "text-rose-500" : "text-emerald-500"}`}>
          {profit !== null ? formatMoney(profit, cur) : "-"}
        </div>
      </div>
    </div>
  );
}
