"use client";

import { useMemo, useRef, useState } from "react";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { BALANCE_OPTION_STAFF, BALANCE_OPTIONS, balancePlan, type BalanceOption } from "@/lib/proposal-pay";
import { draftMoney, MAX_LINES, proposalTotals, type ProposalLineDraft } from "@/lib/proposals";

// The proposal editor: the lines (act, what they do, when, where, price and the act's fee), the
// booking fee, deposit, dates and wording, with the totals worked out as you type. The cost and
// what the agency makes are for staff: the customer's page never shows them.

type Line = ProposalLineDraft & { key: string };

export type ProposalEditorValues = {
  title: string;
  eventType: string;
  bookingFee: string;
  deposit: string;
  depositDue: string;
  validUntil: string;
  tellActs: boolean;
  message: string;
  /** The contract type picked, or "" for none. */
  contractTemplateId: string;
  terms: string;
  /** A wedding's ways to pay the balance offered (src/lib/proposal-pay.ts). */
  payOptions: string[];
  /** This proposal's own note under the ways to pay ("" for the one in Settings). */
  payNote: string;
};

/** A contract type to choose from, with its wording (Settings, Contracts and invoices). */
export type ContractTypeOption = { id: string; name: string; terms: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ProposalEditor({
  action,
  values,
  lines: start,
  currency,
  acts,
  venues,
  eventTypes,
  defaultDate,
  defaultFee,
  defaultVat = "",
  contractTypes = [],
  payNotePlaceholder = "",
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values: ProposalEditorValues;
  lines: ProposalLineDraft[];
  currency: string;
  acts: ComboOption[];
  venues: ComboOption[];
  eventTypes: { value: string; label: string }[];
  defaultDate: string;
  /** The booking fee from Settings, to put back if it's been changed. */
  defaultFee: string;
  /** VAT on sales from Settings, for a first line (later lines copy the line above). */
  defaultVat?: string;
  /** The business's contract types, for the Contract select. */
  contractTypes?: ContractTypeOption[];
  /** The note from Settings, shown in the empty note box. */
  payNotePlaceholder?: string;
}) {
  const [lines, setLines] = useState<Line[]>(() => start.map((l) => ({ ...l, key: newKey() })));
  const [fee, setFee] = useState(values.bookingFee);
  const [deposit, setDeposit] = useState(values.deposit);
  const [eventType, setEventType] = useState(values.eventType);
  const wedding = eventType === "WEDDING";
  // A wedding offers both ways to pay the balance unless staff untick one.
  const [offer, setOffer] = useState<BalanceOption[]>(() => {
    const saved = BALANCE_OPTIONS.filter((o) => values.payOptions.includes(o));
    return saved.length ? saved : [...BALANCE_OPTIONS];
  });
  const toggleOffer = (o: BalanceOption, on: boolean) => setOffer((xs) => BALANCE_OPTIONS.filter((x) => (x === o ? on : xs.includes(x))));
  const m = (x: number) => formatMoney(x, currency);

  const money = (s: string) => draftMoney({ sale: s, cost: "", vatPct: "" }, currency).saleMinor;
  const totals = useMemo(
    () =>
      proposalTotals(
        lines.map((l) => draftMoney(l, currency)),
        money(fee),
      ),
    [lines, fee, currency],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const depositMinor = money(deposit);
  // What a wedding asks for: the deposit (the share plus VAT) and each way to pay the balance.
  const plans = useMemo(() => {
    const draft = { bookingFeeMinor: money(fee), lines: lines.map((l) => draftMoney(l, currency)) };
    return BALANCE_OPTIONS.map((o) => balancePlan(draft, o));
  }, [lines, fee, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const feesMissing = lines.some((l) => !l.cost.trim());
  const termsBox = useRef<HTMLTextAreaElement>(null);
  /**
   * Picking a contract puts its wording in the Terms box, which stays an ordinary text box staff can change for
   * this proposal. Set the way typing does (the native setter, then an input event), so the form sees the change.
   */
  const pickContract = (id: string) => {
    const box = termsBox.current;
    if (!box) return;
    const terms = contractTypes.find((t) => t.id === id)?.terms ?? "";
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, terms);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const set = (key: string, patch: Partial<ProposalLineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
          vatPct: last?.vatPct ?? defaultVat,
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
          <span className="label">Name of the proposal</span>
          <input name="title" required maxLength={120} defaultValue={values.title} className="input" placeholder="e.g. Hannah and Sam's wedding" />
          <span className="hint block">The customer sees this at the top of their proposal.</span>
        </label>
        <label className="block">
          <span className="label">Type of event</span>
          <select name="eventType" defaultValue={values.eventType} onChange={(e) => setEventType(e.target.value)} className="input">
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
          <h2 className="text-[17px] font-semibold tracking-tight">What&apos;s proposed</h2>
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
              <li key={l.key} className="card p-4 sm:p-5" data-proposal-line={i + 1}>
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
                    <span className="hint block">What the couple pays for this act, before VAT.</span>
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
                    <span className="hint block">
                      What the band gets. Never shown as a fee.{wedding ? " On a wedding it's the balance the couple pay." : ""}
                    </span>
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
              An extra fee on top. Leave at 0 unless you charge one separately.{" "}
              {fee !== defaultFee && (
                <button type="button" className="link" onClick={() => setFee(defaultFee)}>
                  Use {defaultFee ? m(money(defaultFee)) : "none"}
                </button>
              )}
            </span>
          </label>
          <div />
          {wedding ? (
            <div className="block">
              <span className="label">Deposit</span>
              <div className="input flex items-center bg-ink-50 tabular-nums" data-testid="proposal-deposit">
                {m(plans[0].depositMinor)}
              </div>
              <span className="hint block">Your share (price less the act&apos;s fee, plus any booking fee), plus VAT. It secures the date.</span>
            </div>
          ) : (
            <label className="block">
              <span className="label">Deposit ({currency})</span>
              <input name="deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" placeholder="0.00" className="input" />
              <span className="hint block">
                Leave blank for no deposit.
                {totals.totalMinor > 0 && depositMinor > 0 ? ` ${Math.round((depositMinor / totals.totalMinor) * 100)}% of the total.` : ""}
              </span>
            </label>
          )}
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
          {wedding && (
            <fieldset className="sm:col-span-2" data-testid="pay-options">
              <legend className="label">Ways the couple can pay the balance</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {BALANCE_OPTIONS.map((o, i) => (
                  <label
                    key={o}
                    className="flex items-start gap-2 rounded-xl border border-ink-200 p-3 text-sm has-[:checked]:border-ink-950 has-[:checked]:bg-ink-50"
                  >
                    <input
                      type="checkbox"
                      name="payOptions"
                      value={o}
                      checked={offer.includes(o)}
                      onChange={(e) => toggleOffer(o, e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Offer: {BALANCE_OPTION_STAFF[o].label}
                      <span className="hint block">
                        {BALANCE_OPTION_STAFF[o].hint} Balance {m(plans[i].balanceMinor)}, {m(plans[i].totalMinor)} in all.
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {feesMissing && <p className="mt-1.5 text-xs text-amber-800">Put in each act&apos;s fee: the deposit and the balance are worked out from it.</p>}
              <label className="mt-3 block">
                <span className="label">Note under the ways to pay</span>
                <textarea name="payNote" rows={3} maxLength={2000} defaultValue={values.payNote} placeholder={payNotePlaceholder} className="input" />
                <span className="hint block">Leave it blank for the note in Settings, Contracts and invoices.</span>
              </label>
            </fieldset>
          )}
          <label className="block sm:col-span-2">
            <span className="label">A note to the customer</span>
            <textarea
              name="message"
              rows={3}
              defaultValue={values.message}
              maxLength={3000}
              className="input"
              placeholder="Shown at the top of their proposal"
            />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="label">Contract</span>
              <select name="contractTemplateId" defaultValue={values.contractTemplateId} onChange={(e) => pickContract(e.target.value)} className="input">
                <option value="">None</option>
                {contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              {contractTypes.length ? (
                "Choosing one puts its wording below."
              ) : (
                <>
                  No contract types yet.{" "}
                  <a href="/settings/documents#contract-types" className="link">
                    Add them in Settings
                  </a>
                  .
                </>
              )}
            </p>
          </div>
          <label className="block sm:col-span-2">
            <span className="label">Terms</span>
            <textarea ref={termsBox} name="terms" rows={8} defaultValue={values.terms} maxLength={20000} className="input" />
            <span className="hint block">
              What the customer reads and agrees to. Change the wording for this proposal if you need to: the contract in Settings stays as it is.
            </span>
          </label>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-4">
          <div className="rounded-[var(--radius-card)] bg-ink-950 p-5 text-white">
            <div className="flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-white/70 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" aria-hidden />
              Customer pays
            </div>
            <div className="mt-3 text-[28px] leading-none font-semibold tracking-[-0.03em] text-volt-300 tabular-nums" data-testid="proposal-total">
              {m(totals.totalMinor)}
            </div>
            <dl className="mt-4 space-y-1.5 text-sm text-white/80 tabular-nums">
              <Row k="Acts" v={m(totals.saleMinor)} />
              {totals.bookingFeeMinor > 0 && <Row k="Booking fee" v={m(totals.bookingFeeMinor)} />}
              {totals.vatMinor > 0 && <Row k="VAT" v={m(totals.vatMinor)} />}
              {!wedding && depositMinor > 0 && <Row k="Deposit" v={m(depositMinor)} />}
              {wedding && <Row k="Deposit, with VAT" v={m(plans[0].depositMinor)} />}
              {wedding &&
                BALANCE_OPTIONS.filter((o) => offer.includes(o)).map((o) => (
                  <Row key={o} k={o === "CASH" ? "Balance in cash" : "Balance by transfer"} v={m(plans[BALANCE_OPTIONS.indexOf(o)].balanceMinor)} />
                ))}
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
                  <span className="font-semibold text-ink-950" data-testid="proposal-margin">
                    {m(totals.agencyMinor)}
                  </span>
                }
              />
            </dl>
            {totals.costMissing && <p className="mt-2 text-xs text-amber-800">Some lines have no act&apos;s fee yet, so what we make is a guess.</p>}
            {depositMinor > totals.totalMinor && totals.totalMinor > 0 && <p className="mt-2 text-xs text-rose-700">The deposit is more than the total.</p>}
          </div>
          <SubmitButton className="btn btn-primary w-full">Save proposal</SubmitButton>
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
