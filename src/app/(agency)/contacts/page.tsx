import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ContactsTabs } from "@/components/contacts-tabs";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { splitTags } from "@/lib/forms";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const where: Prisma.ContactWhereInput = { agencyId: user.agencyId };
  if (sp.type && (CONTACT_TYPES as readonly string[]).includes(sp.type)) where.type = sp.type;
  if (sp.tag) where.tags = { contains: sp.tag, mode: "insensitive" };
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { company: { contains: sp.q, mode: "insensitive" } },
      { email: { contains: sp.q, mode: "insensitive" } },
      { phone: { contains: sp.q, mode: "insensitive" } },
      { tags: { contains: sp.q, mode: "insensitive" } },
      // Search the note archive too.
      { notes: { some: { body: { contains: sp.q, mode: "insensitive" } } } },
    ];
  }
  const [contacts, allTags] = await Promise.all([
    prisma.contact.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { bookings: true } } } }),
    prisma.contact.findMany({ where: { agencyId: user.agencyId }, select: { tags: true } }),
  ]);
  const tags = [...new Set(allTags.flatMap((c) => splitTags(c.tags)))].sort();

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Companies (venue owners) and private customers (weddings and parties). People who work at them are under People."
        actions={
          <>
            <Link href="/contacts/new?type=CLIENT" className="btn">
              Add private customer
            </Link>
            <Link href="/contacts/new" className="btn btn-primary">
              Add company or contact
            </Link>
          </>
        }
      />
      <ContactsTabs active="companies" />
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm">
        {[["", "Everyone"], ...CONTACT_TYPES.map((t) => [t, `${CONTACT_TYPE_LABELS[t]}s`])].map(([t, label]) => (
          <Link
            key={t}
            href={t ? `/contacts?type=${t}` : "/contacts"}
            className={`rounded-lg px-3 py-1.5 ${(sp.type ?? "") === t ? "bg-ink-950 text-white" : "text-ink-600 hover:text-ink-950"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-48 flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={sp.q} placeholder="Name, company, email, phone, tag or note" className="input" />
        </label>
        <label>
          <span className="label">Type</span>
          <select name="type" defaultValue={sp.type ?? ""} className="input">
            <option value="">All types</option>
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTACT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        <button className="btn">Search</button>
      </form>
      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Link href="/contacts" className={`badge ${!sp.tag ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            All
          </Link>
          {tags.map((t) => (
            <Link
              key={t}
              href={`/contacts?tag=${encodeURIComponent(t)}`}
              className={`badge ${sp.tag === t ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              #{t}
            </Link>
          ))}
        </div>
      )}
      {contacts.length === 0 ? (
        <Empty>No contacts match.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Tags</th>
                <th className="text-right">Bookings</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/contacts/${c.id}`} className="link">
                      {c.name}
                    </Link>
                    {c.company && <div className="text-xs text-slate-500">{c.company}</div>}
                  </td>
                  <td>{CONTACT_TYPE_LABELS[c.type as ContactType] ?? c.type}</td>
                  <td>
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="hover:underline">
                        {c.email}
                      </a>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{c.phone}</td>
                  <td className="text-xs text-slate-500">
                    {splitTags(c.tags)
                      .map((t) => `#${t}`)
                      .join(" ")}
                  </td>
                  <td className="text-right">{c._count.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
