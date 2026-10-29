"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { defaultBookingFee, formatMoney, minorToInput, toMinor } from "@/lib/money";

/**
 * Sale (what the venue or client pays) and cost (what the act is paid), plus any booking fee on
 * top, with what the agency makes worked out as you type. On a new booking the agency's default
 * booking fee fills in to match the booking type, until it's typed over.
 */
export function MoneyFields({
  currency,
  currencies,
  sale,
  cost,
  vatPct,
  bookingFee,
  feeDefaults,
}: {
  currency: string;
  currencies: readonly string[];
  sale: string;
  cost: string;
  vatPct: number;
  bookingFee: string;
  /** New bookings only: the agency's default booking fee and what it's added to. */
  feeDefaults?: { bookingFeeMinor: number; bookingFeeFor: string };
}) {
  const [cur, setCur] = useState(currency);
  const [saleIn, setSale] = useState(sale);
  const [costIn, setCost] = useState(cost);
  const [vatIn, setVat] = useState(String(vatPct));
  const [feeIn, setFee] = useState(bookingFee);
  const feeTouched = useRef(false);
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Venue or client pays" hint="Before VAT">
          <input name="fee" inputMode="decimal" value={saleIn} onChange={(e) => setSale(e.target.value)} placeholder="0.00" className="input" />
        </Field>
        <Field label="We pay the act" hint="The act only ever sees this">
          <input name="artistFee" inputMode="decimal" value={costIn} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className="input" />
        </Field>
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
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-ink-200 p-4 text-sm">
        <div>
          <div className="text-ink-600">Venue or client pays</div>
          <div className="text-lg font-semibold">{saleMinor !== null ? formatMoney(saleMinor + feeMinor, cur) : "-"}</div>
          {feeMinor > 0 && <div className="text-xs text-ink-600">incl. {formatMoney(feeMinor, cur)} booking fee</div>}
          {vatMinor > 0 && <div className="text-xs text-ink-600">+ {formatMoney(vatMinor, cur)} VAT</div>}
        </div>
        <div>
          <div className="text-ink-600">Act is paid</div>
          <div className="text-lg font-semibold">{costMinor !== null ? formatMoney(costMinor, cur) : "-"}</div>
        </div>
        <div>
          <div className="text-ink-600">We make</div>
          <div className={`text-lg font-semibold ${profit !== null && profit < 0 ? "text-rose-500" : "text-emerald-500"}`}>
            {profit !== null ? formatMoney(profit, cur) : "-"}
          </div>
        </div>
      </div>
    </div>
  );
}
