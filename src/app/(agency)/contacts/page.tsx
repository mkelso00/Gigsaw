import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ContactsTabs } from "@/components/contacts-tabs";
import { DropMenu } from "@/components/header-actions";
import { Icon } from "@/components/icons";
import { Empty, PageHeader, Segmented } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType, CONTACT_TYPE_PLURALS } from "@/lib/constants";
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
    prisma.contact.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { bookings: { where: { archivedAt: null } } } } } }),
    prisma.contact.findMany({ where: { agencyId: user.agencyId }, select: { tags: true } }),
  ]);
  const tags = [...new Set(allTags.flatMap((c) => splitTags(c.tags)))].sort();

  return (
    <div>
      <PageHeader
        title="Companies & customers"
        subtitle="Companies (venue owners, promoters, clients like a record label) and private customers (weddings and parties). People who work at them are under People."
        actions={
          <>
            <DropMenu label="More">
              <Link href="/contacts/new?type=CLIENT">Add a private customer</Link>
              <Link href="/artists/import">Import from a spreadsheet</Link>
            </DropMenu>
            <Link href="/contacts/new" className="btn btn-primary">
              Add company
            </Link>
          </>
        }
      />
      <ContactsTabs active="companies" />
      {/* One quiet line: search (it covers tags too), the type of contact, and tags in a menu. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form className="relative min-w-0 flex-1 basis-full lg:min-w-72 lg:basis-auto">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            name="q"
            type="search"
            defaultValue={sp.q}
            placeholder="Search by name, company, email, phone or tag"
            aria-label="Search companies and customers"
            className="input pl-10"
          />
        </form>
        <Segmented
          label="Type"
          items={[["", "Everyone"], ...CONTACT_TYPES.map((t) => [t, CONTACT_TYPE_PLURALS[t]])].map(([t, label]) => ({
            href: t ? `/contacts?type=${t}` : "/contacts",
            label,
            on: (sp.type ?? "") === t,
          }))}
        />
        {tags.length > 0 && (
          <DropMenu label={sp.tag ? `#${sp.tag}` : "Tags"}>
            {sp.tag && <Link href="/contacts">All tags</Link>}
            {tags.map((t) => (
              <Link key={t} href={`/contacts?tag=${encodeURIComponent(t)}`}>
                #{t}
              </Link>
            ))}
          </DropMenu>
        )}
      </div>
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
