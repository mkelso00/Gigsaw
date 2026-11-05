"use client";

import { useMemo, useState } from "react";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { draftMoney, MAX_LINES, quoteTotals, type QuoteLineDraft } from "@/lib/quotes";

// The quote editor: the lines (act, what they do, when, where, price and the act's fee), the
// booking fee, deposit, dates and wording, with the totals worked out as you type. The cost and
// what the agency makes are for staff: the customer's page never shows them.

type Line = QuoteLineDraft & { key: string };

export type QuoteEditorValues = {
  title: string;
  eventType: string;
  bookingFee: string;
  deposit: string;
  depositDue: string;
  validUntil: string;
  tellActs: boolean;
  message: string;
  terms: string;
};

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function QuoteEditor({
  action,
  values,
  lines: start,
  currency,
  acts,
  venues,
  eventTypes,
  defaultDate,
  defaultFee,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values: QuoteEditorValues;
  lines: QuoteLineDraft[];
  currency: string;
  acts: ComboOption[];
  venues: ComboOption[];
  eventTypes: { value: string; label: string }[];
  defaultDate: string;
  /** The booking fee from Settings, to put back if it's been changed. */
  defaultFee: string;
}) {
  const [lines, setLines] = useState<Line[]>(() => start.map((l) => ({ ...l, key: newKey() })));
  const [fee, setFee] = useState(values.bookingFee);
  const [deposit, setDeposit] = useState(values.deposit);
  const m = (x: number) => formatMoney(x, currency);

  const money = (s: string) => draftMoney({ sale: s, cost: "", vatPct: "" }, currency).saleMinor;
  const totals = useMemo(
    () =>
      quoteTotals(
        lines.map((l) => draftMoney(l, currency)),
        money(fee),
      ),
    [lines, fee, currency],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const depositMinor = money(deposit);

  const set = (key: string, patch: Partial<QuoteLineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () =>
    setLines((ls) => {
      const last = ls.at(-1);
      return [
        ...ls,
        {
          key: newKey(),
          artistId: "",
          description: "",
          date: last?.date || defaultDate,
          arriveTime: "",
          startTime: "",
          endTime: "",
          venueId: last?.venueId ?? "",
          place: last?.place ?? "",
          sale: "",
          cost: "",
          vatPct: last?.vatPct ?? "",
        },
      ];
    });
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const move = (key: string, by: number) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <ActionForm action={action} className="space-y-8">
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ key: _key, ...l }) => l))} />

      <section className="card card-pad grid gap-4 sm:grid-cols-[1fr_220px]">
        <label className="block">
          <span className="label">Name of the quote</span>
          <input name="title" required maxLength={120} defaultValue={values.title} className="input" placeholder="e.g. Hannah and Sam's wedding" />
          <span className="hint block">The customer sees this at the top of their quote.</span>
        </label>
        <label className="block">
          <span className="label">Type of event</span>
          <select name="eventType" defaultValue={values.eventType} className="input">
            {eventTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">What&apos;s quoted</h2>
          <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </span>
        </div>
        {lines.length === 0 && (
          <p className="mb-3 rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white/50 p-6 text-center text-sm text-ink-500">
            Nothing yet. Add a line for each act, like a ceremony singer and an evening band.
          </p>
        )}
        <ol className="space-y-4">
          {lines.map((l, i) => {
            const d = totals.lines[i];
            return (
              <li key={l.key} className="card p-4 sm:p-5" data-quote-line={i + 1}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-500 uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" aria-hidden />
                    Line {i + 1}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <button type="button" onClick={() => move(l.key, -1)} disabled={i === 0} className="btn btn-sm px-2" aria-label={`Move line ${i + 1} up`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(l.key, 1)}
                      disabled={i === lines.length - 1}
                      className="btn btn-sm px-2"
                      aria-label={`Move line ${i + 1} down`}
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => remove(l.key)} className="btn btn-sm text-rose-700" aria-label={`Remove line ${i + 1}`}>
                      Remove
                    </button>
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="sm:col-span-1 lg:col-span-3">
                    <label htmlFor={`act-${l.key}`} className="label">
                      Act
                    </label>
                    <Combobox
                      id={`act-${l.key}`}
                      name={`act-${l.key}`}
                      options={acts}
                      defaultValue={l.artistId}
                      emptyLabel="Act to be confirmed"
                      placeholder="Type an act's name"
                      onChange={(id) => set(l.key, { artistId: id })}
                    />
                  </div>
                  <label className="block sm:col-span-1 lg:col-span-3">
                    <span className="label">What they do</span>
                    <input
                      value={l.description}
                      onChange={(e) => set(l.key, { description: e.target.value })}
                      maxLength={120}
                      placeholder="e.g. Ceremony singer, Evening band"
                      className="input"
                      aria-label={`What they do, line ${i + 1}`}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="label">Date</span>
                    <input
                      type="date"
                      value={l.date}
                      onChange={(e) => set(l.key, { date: e.target.value })}
                      className="input"
                      aria-label={`Date, line ${i + 1}`}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Arrive</span>
                    <input
                      type="time"
                      value={l.arriveTime}
                      onChange={(e) => set(l.key, { arriveTime: e.target.value })}
                      className="input"
                      aria-label={`Arrive, line ${i + 1}`}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Start</span>
                    <input
                      type="time"
                      value={l.startTime}
                      onChange={(e) => set(l.key, { startTime: e.target.value })}
                      className="input"
                      aria-label={`Start, line ${i + 1}`}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Finish</span>
                    <input
                      type="time"
                      value={l.endTime}
                      onChange={(e) => set(l.key, { endTime: e.target.value })}
                      className="input"
                      aria-label={`Finish, line ${i + 1}`}
                    />
                  </label>
                  <div className="hidden lg:block" />
                  <div className="lg:col-span-3">
                    <label htmlFor={`venue-${l.key}`} className="label">
                      Venue
                    </label>
                    <Combobox
                      id={`venue-${l.key}`}
                      name={`venue-${l.key}`}
                      options={venues}
                      defaultValue={l.venueId}
                      emptyLabel="Not on file: type the place"
                      placeholder="Type a venue's name"
                      onChange={(id) => set(l.key, { venueId: id })}
                    />
                  </div>
                  {!l.venueId && (
                    <label className="block lg:col-span-3">
                      <span className="label">Place</span>
                      <input
                        value={l.place}
                        onChange={(e) => set(l.key, { place: e.target.value })}
                        maxLength={200}
                        placeholder="e.g. Marquee at Home Farm, near York"
                        className="input"
                        aria-label={`Place, line ${i + 1}`}
                      />
                    </label>
                  )}
                  <label className="block lg:col-span-2">
                    <span className="label">Price ({currency})</span>
                    <input
                      value={l.sale}
                      onChange={(e) => set(l.key, { sale: e.target.value })}
                      inputMode="decimal"
                      placeholder="What the customer pays"
                      className="input"
                      aria-label={`Price, line ${i + 1}`}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="label">Act&apos;s fee (staff only)</span>
                    <input
                      value={l.cost}
                      onChange={(e) => set(l.key, { cost: e.target.value })}
                      inputMode="decimal"
                      placeholder="What the act is paid"
                      className="input"
                      aria-label={`Act's fee, line ${i + 1}`}
                    />
                  </label>
                  <label className="block">
                    <span className="label">VAT %</span>
                    <input
                      value={l.vatPct}
                      onChange={(e) => set(l.key, { vatPct: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      className="input"
                      aria-label={`VAT, line ${i + 1}`}
                    />
                  </label>
                  <div className="flex flex-col justify-end text-right text-xs text-ink-500 tabular-nums">
                    {d && (
                      <>
                        <span>Makes {m(d.agencyMinor - d.bookingFeeMinor)}</span>
                        {d.vatMinor > 0 && <span>VAT {m(d.vatMinor)}</span>}
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {lines.length < MAX_LINES && (
          <button type="button" onClick={add} className="btn mt-4">
            + Add a line
          </button>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card card-pad grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Booking fee ({currency})</span>
            <input name="bookingFee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0.00" className="input" />
            <span className="hint block">
              From Settings, all yours.{" "}
              {fee !== defaultFee && (
                <button type="button" className="link" onClick={() => setFee(defaultFee)}>
                  Use {defaultFee ? m(money(defaultFee)) : "none"}
                </button>
              )}
            </span>
          </label>
          <div />
          <label className="block">
            <span className="label">Deposit ({currency})</span>
            <input name="deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" placeholder="0.00" className="input" />
            {totals.totalMinor > 0 && depositMinor > 0 && (
              <span className="hint block">{Math.round((depositMinor / totals.totalMinor) * 100)}% of the total</span>
            )}
          </label>
          <label className="block">
            <span className="label">Deposit due by</span>
            <input name="depositDue" type="date" defaultValue={values.depositDue} className="input" />
          </label>
          <label className="block">
            <span className="label">Valid until</span>
            <input name="validUntil" type="date" defaultValue={values.validUntil} className="input" />
            <span className="hint block">After this day the customer can&apos;t accept it.</span>
          </label>
          <label className="flex items-start gap-2 self-center text-sm">
            <input name="tellActs" type="checkbox" defaultChecked={values.tellActs} className="mt-0.5" />
            <span>
              Email the acts when the customer accepts
              <span className="hint block">Untick to tell them yourself. The bookings are still made.</span>
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="label">A note to the customer</span>
            <textarea name="message" rows={3} defaultValue={values.message} maxLength={3000} className="input" placeholder="Shown at the top of their quote" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Terms</span>
            <textarea name="terms" rows={5} defaultValue={values.terms} maxLength={20000} className="input" />
            <span className="hint block">Filled in from your contract wording in Settings. Change it for this quote if you need to.</span>
          </label>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-4">
          <div className="rounded-[var(--radius-card)] bg-ink-950 p-5 text-white">
            <div className="flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-white/70 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" aria-hidden />
              Customer pays
            </div>
            <div className="mt-3 text-[28px] leading-none font-semibold tracking-[-0.03em] text-volt-300 tabular-nums" data-testid="quote-total">
              {m(totals.totalMinor)}
            </div>
            <dl className="mt-4 space-y-1.5 text-sm text-white/80 tabular-nums">
              <Row k="Acts" v={m(totals.saleMinor)} />
              {totals.bookingFeeMinor > 0 && <Row k="Booking fee" v={m(totals.bookingFeeMinor)} />}
              {totals.vatMinor > 0 && <Row k="VAT" v={m(totals.vatMinor)} />}
              {depositMinor > 0 && <Row k="Deposit" v={m(depositMinor)} />}
            </dl>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-500 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-cue-500" aria-hidden />
              Staff only
            </div>
            <dl className="mt-3 space-y-1.5 text-sm tabular-nums">
              <Row k="Acts are paid" v={m(totals.costMinor)} />
              <Row
                k="We make"
                v={
                  <span className="font-semibold text-ink-950" data-testid="quote-margin">
                    {m(totals.agencyMinor)}
                  </span>
                }
              />
            </dl>
            {totals.costMissing && <p className="mt-2 text-xs text-amber-800">Some lines have no act&apos;s fee yet, so what we make is a guess.</p>}
            {depositMinor > totals.totalMinor && totals.totalMinor > 0 && <p className="mt-2 text-xs text-rose-700">The deposit is more than the total.</p>}
          </div>
          <SubmitButton className="btn btn-primary w-full">Save quote</SubmitButton>
        </aside>
      </section>
    </ActionForm>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
