import type { Metadata } from "next";
import Link from "next/link";
import { ContactsTabs } from "@/components/contacts-tabs";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personName } from "@/lib/person-name";
import { venueColour } from "@/lib/rota";

export const metadata: Metadata = { title: "People" };

const SHOW = [
  ["", "Everyone"],
  ["acts", "In an act"],
  ["venues", "At a venue"],
  ["companies", "At a company"],
] as const;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const user = await requireStaff();
  const { q, show } = await searchParams;
  const contains = q ? { contains: q, mode: "insensitive" as const } : null;
  const people = await prisma.person.findMany({
    where: {
      agencyId: user.agencyId,
      ...(show === "acts" ? { acts: { some: {} } } : show === "venues" ? { venueId: { not: null } } : show === "companies" ? { companyId: { not: null } } : {}),
      ...(contains
        ? {
            OR: [
              { firstName: contains },
              { surname: contains },
              { alias: contains },
              { email: contains },
              { phone: contains },
              { acts: { some: { act: { name: contains } } } },
              { venue: { name: contains } },
              { company: { name: contains } },
            ],
          }
        : {}),
    },
    include: { acts: { include: { act: { select: { id: true, name: true, colour: true } } } }, venue: true, company: true, login: { select: { id: true } } },
    orderBy: [{ firstName: "asc" }, { surname: "asc" }],
  });

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Musicians, venue managers and anyone you work with. A person can be in several acts and work at a venue or company."
        actions={
          <>
            <Link href="/artists/import#template-people" className="btn">
              Import from a spreadsheet
            </Link>
            <Link href="/people/new" className="btn btn-primary">
              Add person
            </Link>
          </>
        }
      />
      <ContactsTabs active="people" />
      <form className="card mb-4 flex flex-wrap gap-3 p-3">
        <input name="q" defaultValue={q} placeholder="Search name, act, venue, company, phone or email" className="input min-w-64 flex-1" />
        <select name="show" defaultValue={show ?? ""} className="input w-auto">
          {SHOW.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn">Search</button>
      </form>
      {people.length === 0 ? (
        <Empty>
          {q || show ? "No one matches." : "No people yet."}{" "}
          <Link href="/people/new" className="link">
            Add a person
          </Link>{" "}
          to put musicians into acts, or record who manages each venue.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Acts</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Email</th>
                <th>App</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="hover:bg-ink-50">
                  <td>
                    <Link href={`/people/${p.id}`} className="link">
                      {personName(p)}
                    </Link>
                    {p.alias && (
                      <div className="text-xs text-ink-500">
                        {p.firstName} {p.surname}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {p.acts.map((m) => (
                        <Link key={m.id} href={`/artists/${m.act.id}`} className="badge bg-ink-100 text-ink-800 hover:bg-ink-200">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.act.colour }} />
                          {m.act.name}
                          {m.jobTitle && <span className="text-ink-500">· {m.jobTitle}</span>}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td>
                    {p.venue ? (
                      <Link href={`/venues/${p.venue.id}`} className="flex items-center gap-2 hover:underline">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: venueColour(p.venue) }} />
                        {p.venue.name}
                      </Link>
                    ) : p.company ? (
                      <Link href={`/contacts/${p.company.id}`} className="hover:underline">
                        {p.company.company || p.company.name}
                      </Link>
                    ) : (
                      <span className="text-ink-400">–</span>
                    )}
                    {p.jobTitle && <div className="text-xs text-ink-500">{p.jobTitle}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`}>{p.phone}</a> : <span className="text-ink-400">–</span>}
                  </td>
                  <td>{p.email || <span className="text-ink-400">–</span>}</td>
                  <td>{p.login ? <span className="badge bg-emerald-50 text-emerald-800">Login</span> : <span className="text-ink-400">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
