import type { Metadata } from "next";
import Link from "next/link";
import { makeActInvoice, markActInvoicesPaid } from "@/actions/act-invoices";
import { SelectAll } from "@/components/client-bits";
import { CopyValue } from "@/components/copy-value";
import { ActionForm, SubmitButton } from "@/components/forms";
import { NoAgreement } from "@/components/no-agreement";
import { RemindPayDetails } from "@/components/remind-pay-details";
import { ArtistDot, Empty, PageHeader, Segmented, Stat } from "@/components/ui";
import { INVOICE_STATUS_LABELS, NO_PAYEE, formatSortCode, maskAccount, owedOnInvoice, type ActInvoiceStatus } from "@/lib/act-invoice-rules";
import { uninvoicedGigs } from "@/lib/act-invoices";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { PaymentsTabs } from "../_tabs";

export const metadata: Metadata = { title: "Pay acts" };

// Paying acts: the self-billing invoices Gigsaw makes once a gig is over (src/lib/act-invoices.ts),
// grouped by act with their bank details to copy, to pay and mark paid one at a time, an act at a time,
// or ticked. Marking one paid logs the payment out to the act on the gig, the same record Payments and
// the booking use. Below: finished gigs still owed that have no invoice, mostly acts who haven't given
// their details yet.

const FILTERS = [
  ["open", "To pay"],
  ["paid", "Paid"],
  ["void", "Void"],
  ["all", "All"],
] as const;
type Filter = (typeof FILTERS)[number][0];

export default async function PayActsPage({ searchParams }: { searchParams: Promise<{ show?: string; act?: string }> }) {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const sp = await searchParams;
  const show: Filter = FILTERS.some(([f]) => f === sp.show) ? (sp.show as Filter) : "open";
  const actId = sp.act ?? "";
  const status = { open: "ISSUED", paid: "PAID", void: "VOID", all: undefined }[show];

  const [invoices, acts, notInvoiced] = await Promise.all([
    prisma.actInvoice.findMany({
      where: { agencyId: user.agencyId, ...(status ? { status } : {}), ...(actId ? { artistId: actId } : {}) },
      include: { booking: { select: { id: true, payments: { select: { direction: true, amountMinor: true } } } }, artist: { select: { colour: true } } },
      orderBy: show === "open" ? [{ actName: "asc" }, { seq: "asc" }] : [{ seq: "desc" }],
      take: 500,
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId, invoices: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    show === "open" ? uninvoicedGigs(user.agencyId) : Promise.resolve([]),
  ]);
  const waiting = notInvoiced.filter((r) => !r.canMake && (!actId || r.booking.artistId === actId));
  const canMake = notInvoiced.filter((r) => r.canMake && (!actId || r.booking.artistId === actId));

  // One group per act and who its invoices are made out to (a band's lead, the one person in a solo act, or
  // the act: src/lib/payee.ts). Unpaid invoices always match the payee's current details (a change replaces
  // them), so the newest invoice's bank details are the ones to pay into.
  type Row = (typeof invoices)[number] & { owed: number };
  type Group = { key: string; name: string; payee: string; colour: string; artistId: string | null; rows: Row[]; total: number };
  const groups = new Map<string, Group>();
  for (const inv of invoices) {
    const owed = owedOnInvoice(inv, inv.booking?.payments ?? []);
    const key = `${inv.artistId ?? `name:${inv.actName}`}|${inv.payeePersonId ?? ""}`;
    const payee = inv.payeeName || inv.actName;
    const g = groups.get(key) ?? { key, name: inv.actName, payee, colour: inv.artist?.colour ?? "#94a3b8", artistId: inv.artistId, rows: [], total: 0 };
    g.rows.push({ ...inv, owed });
    g.total += show === "open" ? owed : inv.totalMinor;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => (show === "open" ? b.total - a.total : 0));
  const currency = invoices[0]?.currency ?? settings.defaultCurrency;
  const m = (x: number, cur = currency) => formatMoney(x, cur);
  const owedTotal = sorted.reduce((t, g) => t + g.total, 0);
  const href = (extra: Record<string, string>) => `/payments/acts?${new URLSearchParams({ ...(actId ? { act: actId } : {}), show, ...extra })}`;
  const keyOf = (k: string) => k.replace(/[^a-zA-Z0-9]/g, "_");

  return (
    <div>
      <PageHeader
        title="Pay acts"
        subtitle="Gigsaw makes out an invoice for each act's fee once their gig is over. Pay it from your bank, then mark it paid here."
        actions={
          <>
            <Link href="/payments/run" className="btn">
              Weekly pay run
            </Link>
            {isAdmin && show === "open" && invoices.length > 0 && (
              <a href={`/api/export/act-invoices${actId ? `?act=${actId}` : ""}`} className="btn">
                Bank payments CSV
              </a>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PaymentsTabs on="pay" />
        <Segmented label="Which invoices" items={FILTERS.map(([f, label]) => ({ href: href({ show: f }), label, on: show === f }))} />
        {acts.length > 1 && (
          <form className="flex items-center gap-2">
            <input type="hidden" name="show" value={show} />
            <select name="act" defaultValue={actId} aria-label="Act" className="input w-auto">
              <option value="">Every act</option>
              {acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className="btn btn-sm">Show</button>
          </form>
        )}
      </div>

      {show === "open" && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            tone={owedTotal ? "dark" : "default"}
            label="To pay"
            value={m(owedTotal)}
            hint={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
          />
          <Stat label="Acts" value={sorted.length} />
          <Stat label="Waiting for details" value={waiting.length} hint="Finished gigs with no invoice yet" />
        </div>
      )}

      {sorted.length === 0 ? (
        <Empty>{show === "open" ? "Nothing to pay. Every invoice has been paid." : "No invoices here."}</Empty>
      ) : (
        <ActionForm action={markActInvoicesPaid} className="space-y-4">
          {show === "open" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm">
              <label className="flex items-center gap-2 text-ink-600">
                <SelectAll name="id" />
                Tick all
              </label>
              <SubmitButton className="btn btn-sm btn-primary" pendingText="Saving…">
                Mark ticked paid
              </SubmitButton>
            </div>
          )}
          {sorted.map((g) => {
            const latest = g.rows.reduce((a, b) => (b.seq > a.seq ? b : a));
            const account = latest.bankAccountNumber.replace(/\s/g, "");
            return (
              <section key={g.key} className="card overflow-hidden" aria-label={g.name}>
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                    <ArtistDot colour={g.colour} />
                    {g.artistId ? (
                      <Link href={`/artists/${g.artistId}`} className="hover:underline">
                        {g.name}
                      </Link>
                    ) : (
                      g.name
                    )}
                    <span className="text-sm font-normal text-ink-500">
                      · {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{m(g.total)}</span>
                </div>
                {/* Who it's made out to and paid to, when that isn't the act itself (a band's lead, or a solo act's person). */}
                {g.payee !== g.name && (
                  <p className="-mt-2 px-4 pb-3 text-sm text-ink-600" data-testid="payee">
                    Made out to {g.payee}
                  </p>
                )}
                {show === "open" && (
                  <dl className="grid gap-x-6 gap-y-2 border-t border-ink-100 bg-ink-50/60 px-4 py-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-ink-500">Account name</dt>
                      <dd>{latest.bankAccountName ? <CopyValue value={latest.bankAccountName} label="account name" /> : "Not given"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Sort code</dt>
                      <dd>
                        {latest.bankSortCode ? (
                          <CopyValue value={latest.bankSortCode.replace(/\D/g, "")} shown={formatSortCode(latest.bankSortCode)} label="sort code" />
                        ) : (
                          "Not given"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Account number</dt>
                      <dd>
                        {!account ? (
                          "Not given"
                        ) : isAdmin ? (
                          <CopyValue value={account} label="account number" />
                        ) : (
                          <span className="font-mono tabular-nums" title="Only admins see the whole number">
                            {maskAccount(account)}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                )}
                <ul className="divide-y divide-ink-100 border-t border-ink-100">
                  {g.rows.map((r) => {
                    const st = r.status as ActInvoiceStatus;
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                        {show === "open" && <input type="checkbox" name="id" value={r.id} aria-label={`Tick ${r.number}`} className="h-4 w-4 accent-ink-950" />}
                        <div className="min-w-0 flex-1 basis-52">
                          <div className="font-medium">
                            <a href={`/print/act-invoices/${r.id}`} target="_blank" className="hover:underline">
                              {r.number}
                            </a>
                            <span className="font-normal text-ink-500">
                              {" "}
                              · {formatDate(r.gigDate, tz)} ·{" "}
                              {r.bookingId ? (
                                <Link href={`/bookings/${r.bookingId}`} className="hover:underline">
                                  {r.bookingRef}
                                </Link>
                              ) : (
                                r.bookingRef
                              )}
                            </span>
                          </div>
                          <div className="text-xs text-ink-500">
                            {r.vatMinor > 0 ? `${m(r.netMinor, r.currency)} + VAT ${m(r.vatMinor, r.currency)}` : "No VAT"}
                            {r.status === "PAID" && r.paidAt && ` · Paid ${formatDate(r.paidAt, tz)}`}
                            {r.note && ` · ${r.note}`}
                            {!r.selfBillingAgreedAt && r.status !== "VOID" && <NoAgreement />}
                            {show === "open" && r.owed < r.totalMinor && ` · ${m(r.totalMinor - r.owed, r.currency)} paid already`}
                          </div>
                        </div>
                        {show !== "open" && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${st === "PAID" ? "bg-emerald-50 text-emerald-700" : st === "VOID" ? "bg-ink-100 text-ink-500" : "bg-amber-50 text-amber-800"}`}
                          >
                            {INVOICE_STATUS_LABELS[st] ?? r.status}
                          </span>
                        )}
                        <span className="ml-auto w-24 text-right font-semibold tabular-nums">{m(show === "open" ? r.owed : r.totalMinor, r.currency)}</span>
                        {show === "open" && (
                          <SubmitButton name="one" value={r.id} className="btn btn-sm" pendingText="Saving…">
                            Mark paid
                          </SubmitButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {show === "open" && g.rows.length > 1 && (
                  <div className="flex justify-end border-t border-ink-100 px-4 py-3">
                    {g.rows.map((r) => (
                      <input key={r.id} type="hidden" name={`all_${keyOf(g.key)}`} value={r.id} />
                    ))}
                    <SubmitButton name="act" value={keyOf(g.key)} pendingText="Saving…">
                      Mark all {m(g.total)} paid to {g.payee}
                    </SubmitButton>
                  </div>
                )}
              </section>
            );
          })}
        </ActionForm>
      )}

      {show === "open" && (waiting.length > 0 || canMake.length > 0) && (
        <section className="mt-10" aria-label="Not invoiced yet">
          <h2 className="section-title mb-1">Not invoiced yet</h2>
          <p className="mb-3 text-sm text-ink-500">
            Finished gigs still owed to the act. An invoice is made as soon as whoever it goes to has given their bank details and address.
          </p>
          <div className="card divide-y divide-ink-100">
            {[...waiting, ...canMake].map((r) => (
              <div key={r.booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-52">
                  <div className="font-medium">
                    {r.booking.artist ? (
                      <Link href={`/artists/${r.booking.artist.id}`} className="hover:underline">
                        {r.booking.artist.name}
                      </Link>
                    ) : (
                      "No act"
                    )}
                    <span className="font-normal text-ink-500">
                      {" "}
                      · {formatDate(r.booking.setStart, r.booking.timezone)} ·{" "}
                      <Link href={`/bookings/${r.booking.id}`} className="hover:underline">
                        {r.booking.reference}
                      </Link>
                    </span>
                  </div>
                  <div className={`text-xs ${r.canMake ? "text-ink-500" : "font-medium text-amber-700"}`}>{r.reason}</div>
                </div>
                <span className="ml-auto w-24 text-right font-semibold tabular-nums">{m(r.owedMinor, r.booking.currency)}</span>
                {!r.canMake && r.booking.artistId && r.reason !== NO_PAYEE && <RemindPayDetails artistId={r.booking.artistId} />}
                {r.canMake && (
                  <ActionForm action={makeActInvoice.bind(null, r.booking.id)}>
                    <SubmitButton className="btn btn-sm" pendingText="Making…">
                      Make invoice
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
