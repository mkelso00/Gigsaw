import type { Metadata } from "next";
import Link from "next/link";
import { makeActInvoice } from "@/actions/act-invoices";
import { payPayees, payWholeWeek, saveBankFile, sendPayRun, signOffGigs } from "@/actions/pay-run";
import { SelectAll } from "@/components/client-bits";
import { CopyValue } from "@/components/copy-value";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, PageHeader } from "@/components/ui";
import { formatSortCode, maskAccount } from "@/lib/act-invoice-rules";
import { requireStaff } from "@/lib/auth";
import { BANK_FIELDS, BANK_FIELD_LABELS, BANK_PRESETS, CUSTOM_MAX_COLUMNS, DATE_FORMATS, PRESETS, readBankFile, type BankFileSetting } from "@/lib/bank-file";
import { getSettings } from "@/lib/db";
import { formatMoney, minorToInput } from "@/lib/money";
import { lastWeekStart, progressLine, readWeek, weekLabel, type GigState, type RunPayee } from "@/lib/pay-run";
import { payRunWeek, recordsRecipient, type PayRunInvoice, type PayRunView } from "@/lib/pay-run-server";
import { addDaysToKey, formatDate, localTime } from "@/lib/time";
import { PlayedTick, TickedCount } from "./_ticked";

export const metadata: Metadata = { title: "Weekly pay run" };

// Last week's act invoices, as one job: check them, send them to the business for its records, pay everyone from
// the bank and mark them paid here, a payee at a time, ticked, or all at once. The rules are in src/lib/pay-run.ts.
// Staff can look and mark paid (as on Pay acts); only admins see whole account numbers, send the records and
// download the payment list.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Mon 16 Nov 2026 at 09:12". */
const sentWhen = (d: Date, tz: string) => `${formatDate(d, tz)} at ${localTime(d, tz)}`;

export default async function PayRunPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const sp = await searchParams;
  const lastWeek = lastWeekStart(new Date(), tz);
  const week = readWeek(sp.week) ?? lastWeek;
  const v = await payRunWeek(user.agencyId, week, { timeZone: tz, business: settings.agencyName, bankFile: settings.bankFile });
  const signOff = v.mode === "SIGN_OFF";
  const currency = v.invoices[0]?.currency ?? settings.defaultCurrency;
  const m = (x: number) => formatMoney(x, currency);
  const href = (w: string) => `/payments/run?week=${w}`;
  const business = settings.agencyName.trim().split(/\s+/)[0] || "the business";
  const to = recordsRecipient(settings, user.email);
  const p = v.progress;

  return (
    <div>
      <PageHeader
        title="Weekly pay run"
        subtitle="The week's act invoices in one place: check them, send them for your records, then pay everyone from your bank and mark them paid."
        actions={
          <Link href="/payments/acts" className="btn">
            Pay acts
          </Link>
        }
      />

      {/* The week */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={href(addDaysToKey(week, -7))} className="btn btn-sm" aria-label="Week before">
          ‹
        </Link>
        <h2 className="min-w-0 text-center text-lg font-semibold tracking-tight sm:min-w-64" data-testid="run-week">
          {weekLabel(week)}
        </h2>
        <Link href={href(addDaysToKey(week, 7))} className="btn btn-sm" aria-label="Week after">
          ›
        </Link>
        <form action="/payments/run" className="flex items-center gap-2">
          <input type="date" name="week" defaultValue={week} aria-label="Any day in the week" className="input h-9 w-auto py-1" />
          <button className="btn btn-sm">Show</button>
        </form>
        {week !== lastWeek && (
          <Link href={href(lastWeek)} className="link text-sm">
            Last week
          </Link>
        )}
      </div>

      {/* (c) Done */}
      {p.done && (
        <div
          className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-900"
          data-testid="week-paid"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <div className="text-lg font-semibold">Week paid</div>
            <div className="text-sm">
              All {plural(p.payees, "payee")} paid, {m(p.totalMinor)} for {plural(p.invoices, "invoice")}.
              {v.run?.sentAt ? "" : " Not sent for your records yet."}
            </div>
          </div>
        </div>
      )}

      {v.invoices.length === 0 && v.gaps.length === 0 && v.voided.length === 0 && v.gigs.length === 0 ? (
        <Empty>{signOff ? "No gigs with an act to pay in this week." : "No act invoices for gigs in this week."}</Empty>
      ) : (
        <div className="space-y-10">
          {signOff && <SignOffSection v={v} isAdmin={isAdmin} m={m} week={week} tz={tz} />}
          {(!signOff || v.invoices.length > 0 || v.voided.length > 0) && (
            <CheckSection v={v} isAdmin={isAdmin} tz={tz} m={m} week={week} business={business} to={to} step={signOff ? 2 : 1} />
          )}
          {v.payees.length > 0 && <PaySection v={v} isAdmin={isAdmin} m={m} week={week} bank={readBankFile(settings.bankFile)} step={signOff ? 3 : 2} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// (a) Check
// ---------------------------------------------------------------------------------------------------------

function StepTitle({ n, children, aside }: { n: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-950 text-sm font-semibold text-white">{n}</span>
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {aside && <span className="text-sm text-ink-500">{aside}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Sign off the week (when invoices are made at sign-off)
// ---------------------------------------------------------------------------------------------------------

const STATE_BADGES: Record<GigState, [string, string]> = {
  SIGNED_OFF: ["Signed off", "bg-emerald-50 text-emerald-800"],
  LEFT_OUT: ["Left out", "bg-rose-50 text-rose-800"],
  TO_SIGN_OFF: ["To sign off", "bg-amber-50 text-amber-900"],
  NOT_FINISHED: ["Not finished", "bg-ink-100 text-ink-600"],
  CANCELLED: ["Cancelled", "bg-ink-100 text-ink-500"],
};

function SignOffSection({ v, isAdmin, m, week, tz }: { v: PayRunView; isAdmin: boolean; m: (x: number) => string; week: string; tz: string }) {
  const toSign = v.gigs.filter((g) => g.state === "TO_SIGN_OFF");
  const run = v.run?.signedOffAt ? v.run : null;
  const acts = new Set(v.gigs.filter((g) => g.state !== "CANCELLED").map((g) => g.artistId)).size;
  const count = (s: GigState) => v.gigs.filter((g) => g.state === s).length;
  const flagged = (match: (f: string) => boolean) => v.gigs.filter((g) => g.flags.some(match)).length;
  const chips = [
    run && toSign.length && `${plural(toSign.length, "gig")} not signed off yet`,
    flagged((f) => f.startsWith("Still ")) &&
      `${plural(
        flagged((f) => f.startsWith("Still ")),
        "gig",
      )} pending or awaiting confirmation`,
    flagged((f) => f.startsWith("Line-up")) &&
      `${plural(
        flagged((f) => f.startsWith("Line-up")),
        "gig",
      )} with stand-ins or line-up changes`,
    flagged((f) => f.includes("as soon as they're in")) &&
      `${plural(
        flagged((f) => f.includes("as soon as they're in")),
        "act",
      )} missing pay details`,
    count("CANCELLED") && `${plural(count("CANCELLED"), "gig")} cancelled`,
    count("NOT_FINISHED") && `${plural(count("NOT_FINISHED"), "gig")} not finished yet`,
  ].filter(Boolean) as string[];
  // By day, Monday to Sunday.
  const days = new Map<string, typeof v.gigs>();
  for (const g of v.gigs) {
    const d = formatDate(g.setStart, tz);
    days.set(d, [...(days.get(d) ?? []), g]);
  }
  const canSign = isAdmin && toSign.length > 0;
  const list = (
    <div className="divide-y divide-ink-100">
      {[...days.entries()].map(([day, gigs]) => (
        <div key={day}>
          <h3 className="bg-ink-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-ink-600 uppercase">{day}</h3>
          <ul className="divide-y divide-ink-100">
            {gigs.map((g) => {
              const [label, style] = STATE_BADGES[g.state];
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm" data-testid="signoff-gig" data-gig={g.id}>
                  {canSign && g.state === "TO_SIGN_OFF" && <input type="hidden" name="gig" value={g.id} />}
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="font-medium">
                      {g.artistId ? (
                        <Link href={`/artists/${g.artistId}`} className="hover:underline">
                          {g.actName}
                        </Link>
                      ) : (
                        g.actName
                      )}
                      <span className="font-normal text-ink-500">
                        {g.venue ? ` · ${g.venue}` : ""} ·{" "}
                        <Link href={`/bookings/${g.id}`} className="hover:underline">
                          {g.reference}
                        </Link>
                      </span>
                    </div>
                    {g.leftOut && g.state !== "SIGNED_OFF" && (
                      <div className="text-xs font-medium text-rose-700">
                        Left out by {g.leftOut.byName}: {g.leftOut.reason}
                      </div>
                    )}
                    {g.flags.map((f) => (
                      <div key={f} className="text-xs font-medium text-amber-700" data-testid="signoff-flag">
                        {f}
                      </div>
                    ))}
                  </div>
                  <span className="w-20 text-right tabular-nums">{formatMoney(g.feeMinor, g.currency)}</span>
                  <span className="flex min-w-32 justify-end">
                    {canSign && g.state === "TO_SIGN_OFF" ? (
                      <PlayedTick id={g.id} label={`${g.actName}, ${g.reference}`} />
                    ) : g.invoice && g.state === "SIGNED_OFF" ? (
                      <span className="badge bg-emerald-50 text-emerald-800">{g.invoice.number}</span>
                    ) : (
                      <span className={`badge ${style}`}>{label}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <section aria-label="Sign off">
      <StepTitle n={1} aside={`${plural(v.gigs.filter((g) => g.state !== "CANCELLED").length, "gig")}, ${plural(acts, "act")}`}>
        Sign off the week
      </StepTitle>
      <div className="card mb-4 space-y-3 p-4 text-sm">
        {run ? (
          <p data-testid="run-signed-off">
            <span className="font-semibold text-emerald-700">
              Signed off {sentWhen(run.signedOffAt!, tz)} by {run.signedOffByName || "an admin"}
            </span>
            <span className="text-ink-500">
              {" "}
              · {count("SIGNED_OFF")} played{count("LEFT_OUT") ? `, ${count("LEFT_OUT")} left out` : ""}
            </span>
            {v.signOffs.slice(1).map((s) => (
              <span key={s.at} className="block text-ink-500">
                Then {sentWhen(new Date(s.at), tz)} by {s.byName}: {plural(s.bookingIds.length, "more gig")}
                {s.leftOut.length ? `, ${s.leftOut.length} left out` : ""}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-ink-600">
            Check everyone played their gigs. Untick any that didn&apos;t happen (a no-show, say) and say why: no invoice is made for it. Signing off makes the
            invoices for the rest.
          </p>
        )}
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="signoff-warnings">
            {chips.map((c) => (
              <li key={c} className="rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-900">
                {c}
              </li>
            ))}
          </ul>
        )}
        {!isAdmin && toSign.length > 0 && <p className="text-ink-500">An admin signs off the week.</p>}
      </div>
      {canSign ? (
        <ActionForm action={signOffGigs.bind(null, week)} className="card overflow-hidden">
          {list}
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 bg-white p-4">
            <SubmitButton className="btn btn-primary h-12 px-6 text-base" pendingText="Signing off…">
              {run ? `Sign these off (${toSign.length})` : "Sign off the week"}
            </SubmitButton>
            <span className="text-xs text-ink-500">
              Makes the invoices for the gigs ticked Played ({plural(toSign.length, "gig")} listed, {m(toSign.reduce((t, g) => t + g.feeMinor, 0))} in fees
              before VAT). Unticked ones are left out with your reason.
            </span>
          </div>
        </ActionForm>
      ) : (
        <details open={!run} className="card group overflow-hidden" data-testid="signoff-list">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">The week&apos;s gigs ({v.gigs.length})</summary>
          <div className="border-t border-ink-100">{list}</div>
        </details>
      )}
    </section>
  );
}

function CheckSection({
  v,
  isAdmin,
  tz,
  m,
  week,
  business,
  to,
  step,
}: {
  v: PayRunView;
  isAdmin: boolean;
  tz: string;
  m: (x: number) => string;
  week: string;
  business: string;
  to: string;
  step: number;
}) {
  const sent = v.run?.sentAt ? v.run : null;
  const later = v.sends.slice(1);
  const counts = {
    lineup: v.lineupChanged,
    unconfirmed: v.gaps.filter((g) => g.kind === "UNCONFIRMED").length,
    notFinished: v.gaps.filter((g) => g.kind === "NOT_FINISHED").length,
    waiting: v.gaps.filter((g) => g.kind === "WAITING").length,
    due: v.gaps.filter((g) => g.kind === "DUE").length,
  };
  const warnings = [
    v.changes.changed &&
      `Changed since sent: ${[
        v.changes.added.length && `${plural(v.changes.added.length, "new or reissued invoice")}`,
        v.changes.removed.length && `${v.changes.removed.length} voided`,
      ]
        .filter(Boolean)
        .join(", ")}`,
    counts.lineup && `${plural(counts.lineup, "gig")} with stand-ins or line-up changes: may need checking`,
    counts.unconfirmed && `${plural(counts.unconfirmed, "gig")} not confirmed yet`,
    counts.notFinished && `${plural(counts.notFinished, "gig")} not finished yet`,
    counts.waiting && `${plural(counts.waiting, "gig")} waiting for details`,
    counts.due && `${plural(counts.due, "gig")} with no invoice yet`,
  ].filter(Boolean) as string[];
  const openList = !sent || v.changes.changed;

  return (
    <section aria-label="Check">
      <StepTitle n={step} aside={`${plural(v.invoices.length, "invoice")}, ${m(v.progress.totalMinor)}`}>
        Check
      </StepTitle>

      <div className="card mb-4 space-y-3 p-4">
        {sent ? (
          <p className="text-sm text-ink-700" data-testid="run-sent">
            <span className="font-semibold text-emerald-700">
              Sent {sentWhen(sent.sentAt!, tz)} by {sent.sentByName || "an admin"}
            </span>
            <span className="text-ink-500"> to {v.sends[0]?.to ?? to}</span>
            {later.map((s) => (
              <span key={s.at} className="block text-ink-500">
                {s.kind === "CHANGES" ? "Changes sent" : "Sent again"} {sentWhen(new Date(s.at), tz)} by {s.byName}:{" "}
                {[s.numbers.length && plural(s.numbers.length, "invoice"), s.voided.length && `${s.voided.length} voided`].filter(Boolean).join(", ")}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-ink-600">
            Not sent for your records yet. Check the invoices below (in case anyone swapped or changed over the weekend), then send them.
          </p>
        )}

        {warnings.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="run-warnings">
            {warnings.map((w) => (
              <li key={w} className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900">
                {w}
              </li>
            ))}
          </ul>
        )}

        {sent && v.changes.changed && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="run-changed">
            <div className="font-semibold">Changed since sent</div>
            <ul className="mt-1 space-y-0.5">
              {v.changes.added.map((a) => (
                <li key={a.id}>{a.number}: new or reissued</li>
              ))}
              {v.changes.removed.map((r) => (
                <li key={r.id}>
                  {r.number}: voided{r.reason ? ` (${r.reason})` : ""}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <ActionForm action={sendPayRun.bind(null, week, "CHANGES")} className="mt-3">
                <SubmitButton className="btn btn-sm btn-primary" pendingText="Sending…">
                  Send the changes
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}

        {!sent && v.invoices.length > 0 && (
          <div>
            {isAdmin ? (
              <ActionForm action={sendPayRun.bind(null, week, "ALL")} className="space-y-2">
                <SubmitButton className="btn btn-primary h-12 w-full px-6 text-base sm:w-auto" pendingText="Sending…">
                  Send to {business} for our records
                </SubmitButton>
                <p className="text-xs text-ink-500">
                  Emails {to}: a summary of who&apos;s paid, the invoices as a spreadsheet (CSV) and every invoice in one PDF. Nobody is paid by this.
                </p>
              </ActionForm>
            ) : (
              <p className="text-sm text-ink-500">An admin sends these for your records.</p>
            )}
          </div>
        )}
        {isAdmin && v.invoices.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={`/api/export/pay-run?week=${week}&file=invoices`} className="link">
              Download the invoices (PDF)
            </a>
            <span className="text-ink-300">·</span>
            <a href={`/api/export/pay-run?week=${week}&file=records`} className="link">
              Invoices spreadsheet (CSV)
            </a>
          </div>
        )}
      </div>

      {v.gaps.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-700">Gigs with no invoice yet</h3>
          <ul className="card divide-y divide-ink-100" data-testid="run-gaps">
            {v.gaps.map((g) => (
              <li key={g.booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1 basis-52">
                  <span className="font-medium">{g.booking.artist?.name ?? "No act"}</span>
                  <span className="text-ink-500">
                    {" "}
                    · {formatDate(g.booking.setStart, g.booking.timezone)} ·{" "}
                    <Link href={`/bookings/${g.booking.id}`} className="hover:underline">
                      {g.booking.reference}
                    </Link>
                  </span>
                  <div className={`text-xs font-medium ${g.kind === "DUE" ? "text-ink-500" : "text-amber-700"}`}>{g.reason}</div>
                </div>
                <span className="w-24 text-right font-semibold tabular-nums">{formatMoney(g.owedMinor, g.booking.currency)}</span>
                {g.canMake && (
                  <ActionForm action={makeActInvoice.bind(null, g.booking.id)}>
                    <SubmitButton className="btn btn-sm" pendingText="Making…">
                      Make invoice
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {v.invoices.length > 0 && (
        <details open={openList} className="card group overflow-hidden" data-testid="run-check">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-ink-400 transition group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            The week&apos;s invoices by payee
            <span className="font-normal text-ink-500">({plural(v.payees.length, "payee")})</span>
          </summary>
          <div className="divide-y divide-ink-100 border-t border-ink-100">
            {v.payees.map((pe) => (
              <CheckPayee key={pe.key} pe={pe} notes={v.notes} tz={tz} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function CheckPayee({ pe, notes, tz }: { pe: RunPayee<PayRunInvoice>; notes: Map<string, string[]>; tz: string }) {
  const m = (x: number) => formatMoney(x, pe.currency);
  return (
    <div className="px-4 py-3" data-testid="check-payee" aria-label={pe.name}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 font-semibold">
          {pe.name}
          {(pe.acts.length > 1 || pe.acts[0] !== pe.name) && <span className="font-normal text-ink-500"> · {pe.acts.join(", ")}</span>}
        </div>
        <div className="shrink-0 font-semibold tabular-nums">{m(pe.totalMinor)}</div>
      </div>
      <ul className="mt-1 space-y-1">
        {pe.invoices.map((inv) => (
          <li key={inv.id} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <a href={`/print/act-invoices/${inv.id}`} target="_blank" className="font-medium hover:underline">
                {inv.number}
              </a>
              <span className="text-ink-500">
                {formatDate(inv.gigDate, tz)} · {inv.actName} ·{" "}
                {inv.bookingId ? (
                  <Link href={`/bookings/${inv.bookingId}`} className="hover:underline">
                    {inv.bookingRef}
                  </Link>
                ) : (
                  inv.bookingRef
                )}
              </span>
              <span className="ml-auto tabular-nums">
                {inv.vatMinor > 0 ? `${m(inv.netMinor)} + VAT ${m(inv.vatMinor)}` : m(inv.totalMinor)}
                {inv.status === "PAID" && <span className="ml-2 text-xs font-medium text-emerald-700">Paid</span>}
              </span>
            </div>
            {notes.get(inv.id)?.map((n) => (
              <div key={n} className="text-xs font-medium text-amber-700" data-testid="invoice-note">
                {n}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// (b) Pay
// ---------------------------------------------------------------------------------------------------------

function PaySection({
  v,
  isAdmin,
  m,
  week,
  bank,
  step,
}: {
  v: PayRunView;
  isAdmin: boolean;
  m: (x: number) => string;
  week: string;
  bank: BankFileSetting;
  step: number;
}) {
  const p = v.progress;
  const pct = p.totalMinor ? Math.round((p.paidMinor / p.totalMinor) * 100) : 0;
  const unpaidIds = v.payees.flatMap((pe) => pe.invoices.filter((i) => i.owedMinor > 0).map((i) => i.id));
  const preset = PRESETS[bank.preset];
  return (
    <section aria-label="Pay">
      <StepTitle n={step} aside="Pay each one from your bank, then mark them paid">
        Pay
      </StepTitle>

      {v.bank.problems.length > 0 && (
        <div className="mb-4 rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" data-testid="run-fix">
          <div className="font-semibold">Fix before paying</div>
          <p className="text-xs text-rose-800">Left out of the payment list until their bank details are right.</p>
          <ul className="mt-2 space-y-1">
            {v.bank.problems.map((x) => (
              <li key={x.key}>
                {x.artistId ? (
                  <Link href={`/artists/${x.artistId}`} className="font-medium underline">
                    {x.payeeName}
                  </Link>
                ) : (
                  <span className="font-medium">{x.payeeName}</span>
                )}
                : {x.problems.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isAdmin && p.owedMinor > 0 && (
          <a href={`/api/export/pay-run?week=${week}`} className="btn btn-sm" title={`Laid out for ${preset.label}`}>
            Download payment list ({bank.preset === "GENERIC" || bank.preset === "CUSTOM" ? "CSV" : preset.label})
          </a>
        )}
        {isAdmin && (
          <a href={`/print/pay-run?week=${week}`} target="_blank" className="btn btn-sm">
            Print payment list
          </a>
        )}
        {unpaidIds.length > 0 && (
          <ActionForm action={payWholeWeek.bind(null, week)} className="ml-auto">
            {unpaidIds.map((id) => (
              <input key={id} type="hidden" name="id" value={id} />
            ))}
            <SubmitButton className="btn btn-sm" pendingText="Saving…">
              Mark all paid
            </SubmitButton>
          </ActionForm>
        )}
      </div>

      <ActionForm action={payPayees.bind(null, week)}>
        {/* Sticky: how far paying has got, and the ticked ones' button, stay in view down a long list. */}
        <div className="sticky top-0 z-20 -mx-4 mb-2 border-b border-ink-200 bg-ink-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white/95">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-sm font-semibold tabular-nums" data-testid="run-progress">
                {progressLine(p, v.invoices[0]?.currency ?? "GBP")}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {p.owedMinor > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 text-ink-600">
                  <SelectAll name="tick" />
                  Tick all
                </label>
                <TickedCount name="tick" />
                <SubmitButton name="mode" value="ticked" className="btn btn-sm btn-primary" pendingText="Saving…">
                  Mark ticked paid
                </SubmitButton>
              </div>
            )}
          </div>
        </div>

        {/* Column heads on a wide screen; on a phone each payee is a compact card. */}
        <div className="hidden px-3 pb-1 text-xs font-medium text-ink-500 min-[1360px]:grid min-[1360px]:grid-cols-[1.25rem_minmax(9rem,1.3fr)_minmax(8rem,1fr)_7.5rem_8.5rem_7.5rem_minmax(12.5rem,1.1fr)_6rem] min-[1360px]:gap-3">
          <span />
          <span>Payee</span>
          <span>Account name</span>
          <span>Sort code</span>
          <span>Account number</span>
          <span className="text-right">Amount</span>
          <span>Reference</span>
          <span />
        </div>
        <ul className="card divide-y divide-ink-100 overflow-hidden" data-testid="pay-list">
          {v.payees.map((pe) => (
            <PayRow key={pe.key} pe={pe} isAdmin={isAdmin} m={m} problem={v.bank.problems.find((x) => x.key === pe.key)?.problems.join(", ")} />
          ))}
        </ul>
      </ActionForm>
      {isAdmin && <BankFileSection bank={bank} />}
    </section>
  );
}

/** Which bank the payment list is laid out for, or the business's own layout. Admins only. */
function BankFileSection({ bank }: { bank: BankFileSetting }) {
  const preset = PRESETS[bank.preset];
  const rows = Array.from({ length: CUSTOM_MAX_COLUMNS }, (_, i) => bank.custom.columns[i] ?? null);
  const c = bank.custom;
  return (
    <details className="card mt-6 overflow-hidden" data-testid="bank-file">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">Bank file:</span> {preset.label}
        {!preset.confirmed && bank.preset !== "CUSTOM" && <span className="badge bg-amber-50 text-amber-900">Check against your bank&apos;s template</span>}
        <span className="link ml-auto">Change</span>
      </summary>
      <ActionForm action={saveBankFile} className="space-y-4 border-t border-ink-100 p-4 text-sm">
        <label className="block max-w-sm">
          <span className="label">Your bank</span>
          <select name="preset" defaultValue={bank.preset} className="input" aria-label="Your bank">
            {BANK_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESETS[p].label}
                {!PRESETS[p].confirmed && p !== "CUSTOM" ? " (check against your bank's template)" : ""}
              </option>
            ))}
          </select>
        </label>
        <ul className="space-y-1 text-xs text-ink-600">
          {BANK_PRESETS.filter((p) => p !== "CUSTOM").map((p) => (
            <li key={p}>
              <span className="font-medium text-ink-800">{PRESETS[p].label}:</span> {PRESETS[p].template!.columns.map((x) => x.header).join(", ")}
              {PRESETS[p].template!.header ? "" : " (no header row)"}. {PRESETS[p].note}
              {!PRESETS[p].confirmed && <span className="font-medium text-amber-800"> Check against your bank&apos;s template.</span>}
            </li>
          ))}
        </ul>

        <details open={bank.preset === "CUSTOM"} className="rounded-xl border border-ink-200 p-3">
          <summary className="cursor-pointer font-semibold">Your own layout (Custom)</summary>
          <p className="mt-1 mb-3 text-xs text-ink-500">
            Choose the columns in the order your bank wants them, and name each one as its template does. Leave a row blank to skip it.
          </p>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-right text-xs text-ink-400">{i + 1}</span>
                <select name={`col_field_${i}`} defaultValue={r?.field ?? ""} className="input w-auto min-w-0 flex-1 basis-48" aria-label={`Column ${i + 1}`}>
                  <option value="">None</option>
                  {BANK_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {BANK_FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
                <input
                  name={`col_header_${i}`}
                  defaultValue={r?.header ?? ""}
                  placeholder="Heading"
                  className="input w-auto min-w-0 flex-1 basis-40"
                  aria-label={`Column ${i + 1} heading`}
                />
              </li>
            ))}
          </ol>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex items-center gap-2 lg:col-span-1">
              <input type="checkbox" name="header" defaultChecked={c.header} className="h-4 w-4 accent-ink-950" />
              Header row
            </label>
            <label className="block">
              <span className="label">Separator</span>
              <select name="separator" defaultValue={c.separator} className="input">
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Date format</span>
              <select name="dateFormat" defaultValue={c.dateFormat} className="input">
                {DATE_FORMATS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Reference up to</span>
              <input name="referenceMax" type="number" min={6} max={140} defaultValue={c.referenceMax} className="input" />
            </label>
            <label className="block">
              <span className="label">Names up to</span>
              <input name="nameMax" type="number" min={6} max={140} defaultValue={c.nameMax} className="input" />
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-sm btn-primary" pendingText="Saving…">
            Save bank file
          </SubmitButton>
          <a href="/api/export/pay-run?file=sample" className="btn btn-sm">
            Download a sample
          </a>
          <span className="text-xs text-ink-500">The sample uses two made-up payees and the layout as saved. Try it in your bank before the real list.</span>
        </div>
      </ActionForm>
    </details>
  );
}

function PayRow({ pe, isAdmin, m, problem }: { pe: RunPayee<PayRunInvoice>; isAdmin: boolean; m: (x: number) => string; problem?: string }) {
  const unpaid = pe.invoices.filter((i) => i.owedMinor > 0);
  const paid = pe.invoices.filter((i) => i.status === "PAID");
  const sort = pe.bank.sortCode.replace(/\D/g, "");
  const account = pe.bank.accountNumber;
  const noBank = !sort || !account;
  const cell = (label: string, node: React.ReactNode, className = "") => (
    <div className={`min-w-0 ${className}`}>
      <span className="mr-1.5 text-[11px] text-ink-400 min-[1360px]:hidden">{label}</span>
      {node}
    </div>
  );
  return (
    <li
      className={`grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm min-[1360px]:grid-cols-[1.25rem_minmax(9rem,1.3fr)_minmax(8rem,1fr)_7.5rem_8.5rem_7.5rem_minmax(12.5rem,1.1fr)_6rem] ${pe.paid ? "bg-emerald-50/50" : ""}`}
      data-testid="pay-row"
      data-payee={pe.name}
      aria-label={pe.name}
    >
      <input type="hidden" name={`name_${pe.key}`} value={pe.name} />
      {unpaid.map((i) => (
        <input key={i.id} type="hidden" name={`ids_${pe.key}`} value={i.id} />
      ))}
      {paid.map((i) => (
        <input key={i.id} type="hidden" name={`paid_${pe.key}`} value={i.id} />
      ))}
      <div className="row-span-3 self-start pt-0.5 min-[1360px]:row-span-1 min-[1360px]:self-center min-[1360px]:pt-0">
        {!pe.paid && <input type="checkbox" name="tick" value={pe.key} aria-label={`Tick ${pe.name}`} className="h-4 w-4 accent-ink-950" />}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold" data-testid="pay-name">
          {pe.name}
        </div>
        <div className="truncate text-xs text-ink-500">
          {plural(pe.invoices.length, "gig")}
          {(pe.acts.length > 1 || pe.acts[0] !== pe.name) && ` · ${pe.acts.join(", ")}`}
        </div>
      </div>
      {/* Amount: top right on a phone, its own column on a wide screen. */}
      <div className="text-right min-[1360px]:order-6">
        <div className="font-semibold tabular-nums" data-testid="pay-amount">
          {pe.paid ? m(pe.totalMinor) : <CopyValue value={minorToInput(pe.owedMinor, pe.currency)} shown={m(pe.owedMinor)} label={`amount for ${pe.name}`} />}
        </div>
        {!pe.paid && pe.paidMinor > 0 && <div className="text-[11px] text-ink-500">{m(pe.paidMinor)} paid already</div>}
      </div>

      <div className="col-span-2 col-start-2 flex flex-wrap gap-x-4 gap-y-1 min-[1360px]:contents">
        {cell(
          "Name",
          pe.bank.accountName ? (
            <CopyValue value={pe.bank.accountName} label={`account name for ${pe.name}`} />
          ) : (
            <span className="text-ink-400">Not given</span>
          ),
          "min-[1360px]:order-3",
        )}
        {cell(
          "Sort code",
          sort ? <CopyValue value={sort} shown={formatSortCode(sort)} label={`sort code for ${pe.name}`} /> : <span className="text-ink-400">Not given</span>,
          "min-[1360px]:order-4",
        )}
        {cell(
          "Account",
          !account ? (
            <span className="text-ink-400">Not given</span>
          ) : isAdmin ? (
            <CopyValue value={account} label={`account number for ${pe.name}`} />
          ) : (
            <span className="font-mono tabular-nums" title="Only admins see the whole number">
              {maskAccount(account)}
            </span>
          ),
          "min-[1360px]:order-5",
        )}
        {cell("Ref", <CopyValue value={pe.reference} label={`reference for ${pe.name}`} />, "whitespace-nowrap min-[1360px]:order-7")}
      </div>

      <div className="col-span-2 col-start-2 flex items-center justify-between gap-3 min-[1360px]:order-8 min-[1360px]:col-span-1 min-[1360px]:col-start-auto min-[1360px]:justify-end">
        {(pe.bankMismatch || noBank || problem) && !pe.paid && (
          <span className="text-xs font-medium text-rose-700">
            {problem || noBank ? `Fix before paying: ${problem || "bank details missing"}` : "Invoices with different bank details: pay each from Pay acts"}
          </span>
        )}
        {pe.paid ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="badge bg-emerald-50 text-emerald-800" data-testid="pay-paid">
              Paid
            </span>
            {paid.length > 0 && (
              <SubmitButton name="undo" value={pe.key} className="btn btn-sm" pendingText="…">
                Undo
              </SubmitButton>
            )}
          </span>
        ) : (
          <span className="ml-auto">
            <SubmitButton name="payee" value={pe.key} className="btn btn-sm btn-primary min-w-20" pendingText="Saving…">
              Paid
            </SubmitButton>
          </span>
        )}
      </div>
    </li>
  );
}
