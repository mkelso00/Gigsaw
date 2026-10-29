import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addAgencyAdmin, resetUserPassword, setStatementPaid, updateAgency } from "@/actions/owner";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader, Stat } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { monthLabel, shiftMonth } from "@/lib/billing";
import { CURRENCIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatMoney, minorToInput } from "@/lib/money";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Agency" };
export const dynamic = "force-dynamic";

export default async function OwnerAgencyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireOwner();
  const { id } = await params;
  const { created } = await searchParams;
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      users: { where: { demo: false }, orderBy: [{ role: "asc" }, { name: "asc" }] },
      statements: { orderBy: { month: "desc" }, take: 24 },
      _count: { select: { artists: true, venues: true, contacts: true, bookings: true } },
    },
  });
  if (!agency) notFound();

  // Usage for the last six months, newest first.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, -i));
  const usage = await Promise.all(months.map((m) => usageForMonth(m, agency.id).then((u) => u.get(agency.id)?.count ?? 0)));
  const money = (m: number) => formatMoney(m, agency.billingCurrency);
  const staff = agency.users.filter((u) => u.role !== "ARTIST");
  const artists = agency.users.filter((u) => u.role === "ARTIST");

  return (
    <div className="space-y-6">
      <PageHeader
        title={agency.name}
        subtitle={`${agency.status === "ACTIVE" ? "Active" : "Suspended"} · ${money(agency.pricePerGigMinor)} per gig · ${agency._count.bookings} bookings, ${agency._count.artists} artists`}
      />
      {created && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Agency created. Send the admin their email and password, and the web address of this site. They sign in at /login.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {usage.slice(0, 3).map((n, i) => (
          <Stat key={months[i]} label={monthLabel(months[i])} value={`${n} gigs`} hint={money(n * agency.pricePerGigMinor)} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ActionForm action={updateAgency.bind(null, agency.id)} className="card card-pad space-y-4">
          <h2 className="section-title">Account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name">
              <input name="name" required defaultValue={agency.name} className="input" />
            </Field>
            <Field label="Status" hint="Suspended agencies can't sign in. Their data is kept.">
              <select name="status" defaultValue={agency.status} className="input">
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </Field>
            <Field label="Price per gig">
              <input name="pricePerGig" inputMode="decimal" required defaultValue={minorToInput(agency.pricePerGigMinor, agency.billingCurrency)} className="input" />
            </Field>
            <Field label="Currency">
              <select name="billingCurrency" defaultValue={agency.billingCurrency} className="input">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Billing email" className="sm:col-span-2">
              <input name="billingEmail" type="email" defaultValue={agency.billingEmail} className="input" />
            </Field>
          </div>
          <Field label="Private notes" hint="Only you see these">
            <textarea name="ownerNotes" rows={3} defaultValue={agency.ownerNotes} className="input" />
          </Field>
          <p className="hint">A new price applies to statements you issue from now on. Statements already issued keep their price.</p>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>

        <section className="card card-pad">
          <h2 className="section-title mb-3">Team</h2>
          <ul className="mb-5 divide-y divide-slate-100 text-sm">
            {staff.map((u) => (
              <li key={u.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{u.name}</strong> · {u.email} · {u.role === "ADMIN" ? "Admin" : "Agent"}
                    {u.isOwner && <span className="badge ml-2 bg-slate-900 text-white">Owner</span>}
                  </span>
                </div>
                {!u.isOwner && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">Set a new password</summary>
                    <ActionForm action={resetUserPassword.bind(null, u.id)} className="mt-2 flex gap-2">
                      <input name="password" type="text" minLength={8} required placeholder="New password" autoComplete="off" className="input" />
                      <SubmitButton className="btn">Set</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className="mb-4 text-xs text-slate-500">{artists.length} artist app login(s).</p>
          <h3 className="mb-2 text-sm font-semibold">Add an admin</h3>
          <ActionForm action={addAgencyAdmin.bind(null, agency.id)} className="grid gap-2 sm:grid-cols-4 sm:items-end">
            <input name="name" required placeholder="Name" className="input" />
            <input name="email" type="email" required placeholder="Email" className="input" />
            <input name="password" type="text" minLength={8} required placeholder="Password" autoComplete="off" className="input" />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </section>
      </div>

      <section className="card card-pad">
        <h2 className="section-title mb-3">Statements</h2>
        {agency.statements.length === 0 ? (
          <p className="text-sm text-slate-500">None yet. Issue them from Billing once a month is over.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Gigs</th>
                <th className="text-right">Price</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agency.statements.map((s) => (
                <tr key={s.id}>
                  <td>{monthLabel(s.month)}</td>
                  <td className="text-right">{s.gigCount}</td>
                  <td className="text-right">{formatMoney(s.pricePerGigMinor, s.currency)}</td>
                  <td className="text-right font-medium">{formatMoney(s.amountMinor, s.currency)}</td>
                  <td>
                    <span className={`badge ${s.status === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{s.status === "PAID" ? "Paid" : "Unpaid"}</span>
                  </td>
                  <td className="text-right">
                    <form action={setStatementPaid.bind(null, s.id, s.status !== "PAID")}>
                      <button className="btn btn-sm">{s.status === "PAID" ? "Mark unpaid" : "Mark paid"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
