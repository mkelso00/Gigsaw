import type { Metadata } from "next";
import Link from "next/link";
import { ArtistDot, Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { punctualityByArtist } from "@/lib/bookings";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Acts" };

const VIEWS = [
  ["list", "List"],
  ["cards", "Cards"],
  ["bands", "Bands"],
] as const;
type View = (typeof VIEWS)[number][0];

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; show?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "list";
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const contains = sp.q ? { contains: sp.q, mode: "insensitive" as const } : null;
  const [all, stats, newActs] = await Promise.all([
    prisma.artist.findMany({
      where: {
        agencyId: user.agencyId,
        ...(contains
          ? {
              OR: [
                { name: contains },
                { genre: contains },
                { email: contains },
                { phone: contains },
                { members: { some: { person: { OR: [{ firstName: contains }, { surname: contains }] } } } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      include: {
        agent: { select: { name: true } },
        login: { select: { id: true } },
        partActs: { include: { child: { select: { id: true, name: true, colour: true } } } },
        partOf: { include: { parent: { select: { id: true, name: true } } } },
        _count: { select: { members: true, bookings: { where: { setStart: { gte: now }, status: { not: "CANCELLED" } } } } },
      },
    }),
    punctualityByArtist(settings, new Date(now.getTime() - 365 * 86_400_000)),
    prisma.actApplication.count({ where: { agencyId: user.agencyId, status: "NEW" } }),
  ]);
  const acts = sp.show === "bands" ? all.filter((a) => a.partActs.length) : sp.show === "solo" ? all.filter((a) => !a.partActs.length) : all;
  const qs = (extra: Record<string, string | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ view, q: sp.q, show: sp.show, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();

  const onTime = (id: string) => {
    const s = stats.get(id);
    if (s?.onTimeRate == null) return null;
    return (
      <span
        className={`badge ${s.onTimeRate >= 0.9 ? "bg-emerald-100 text-emerald-800" : s.onTimeRate >= 0.7 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}
      >
        {Math.round(s.onTimeRate * 100)}% on time
      </span>
    );
  };
  const initials = (a: { name: string; colour: string }, size = "h-10 w-10 text-sm") => (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${size}`} style={{ backgroundColor: a.colour }}>
      {a.name.slice(0, 2).toUpperCase()}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="Acts"
        subtitle="Your roster: solo singers, duos and bands. A band can be made up of other acts."
        actions={
          <>
            <Link href="/artists/import" className="btn">
              Import
            </Link>
            <Link href="/artists/applications" className="btn">
              New acts{newActs ? <span className="badge ml-1.5 bg-amber-400 text-ink-950">{newActs}</span> : null}
            </Link>
            <Link href="/artists/new" className="btn btn-primary">
              Add act
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm" role="tablist" aria-label="View">
          {VIEWS.map(([v, label]) => (
            <Link
              key={v}
              href={`/artists${qs({ view: v })}`}
              className={`rounded-lg px-3.5 py-2 font-medium ${view === v ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <form className="flex flex-1 flex-wrap gap-2">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={sp.q} placeholder="Search acts, genre, phone or a member's name" className="input min-w-56 flex-1" />
          <select name="show" defaultValue={sp.show ?? ""} className="input w-auto">
            <option value="">All acts</option>
            <option value="solo">Solo acts and duos</option>
            <option value="bands">Bands made of acts</option>
          </select>
          <button className="btn">Search</button>
        </form>
      </div>

      {acts.length === 0 ? (
        <Empty>{sp.q || sp.show ? "No acts match." : "No acts yet."}</Empty>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {acts.map((a) => (
            <Link key={a.id} href={`/artists/${a.id}`} className="card card-pad block transition hover:shadow-md">
              <div className="flex items-center gap-3">
                {initials(a)}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{a.name}</div>
                  <div className="truncate text-sm text-ink-500">{[a.genre, a.agent?.name].filter(Boolean).join(" · ") || "No details yet"}</div>
                </div>
              </div>
              {a.partActs.length > 0 && <div className="mt-3 truncate text-sm text-ink-600">Members: {a.partActs.map((l) => l.child.name).join(", ")}</div>}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="badge bg-ink-100 text-ink-700">{a._count.bookings} upcoming</span>
                {onTime(a.id)}
                <span className={`badge ${a.login ? "bg-emerald-50 text-emerald-800" : "bg-ink-100 text-ink-500"}`}>
                  {a.login ? "Has app login" : "No app login"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : view === "bands" ? (
        <div className="space-y-4">
          {acts
            .filter((a) => a.partActs.length)
            .map((a) => (
              <section key={a.id} className="card card-pad">
                <Link href={`/artists/${a.id}`} className="flex items-center gap-3 hover:underline">
                  {initials(a, "h-9 w-9 text-xs")}
                  <span className="text-[17px] font-semibold">{a.name}</span>
                  <span className="text-sm font-normal text-ink-500">· {a._count.bookings} upcoming</span>
                </Link>
                <div className="mt-3 flex flex-wrap gap-2 pl-12">
                  {a.partActs.map((l) => (
                    <Link key={l.id} href={`/artists/${l.child.id}`} className="badge bg-ink-100 py-1.5 text-sm text-ink-800 hover:bg-ink-200">
                      <ArtistDot colour={l.child.colour} />
                      {l.child.name}
                      {l.role && <span className="text-ink-500">· {l.role}</span>}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          {!acts.some((a) => a.partActs.length) && (
            <Empty>No bands made of acts yet. Open a band and add its members from your acts (e.g. Wonderlust = Graham McKee Solo + Jo Drummond Solo).</Empty>
          )}
          {acts.some((a) => !a.partActs.length && !a.partOf.length) && (
            <section className="card card-pad">
              <h2 className="section-title mb-3">Not in a band</h2>
              <div className="flex flex-wrap gap-2">
                {acts
                  .filter((a) => !a.partActs.length && !a.partOf.length)
                  .map((a) => (
                    <Link key={a.id} href={`/artists/${a.id}`} className="badge bg-ink-100 py-1.5 text-sm text-ink-800 hover:bg-ink-200">
                      <ArtistDot colour={a.colour} />
                      {a.name}
                    </Link>
                  ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Act</th>
                <th>Members / part of</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Lead agent</th>
                <th className="text-right">Upcoming</th>
                <th>On time</th>
                <th>App</th>
              </tr>
            </thead>
            <tbody>
              {acts.map((a) => (
                <tr key={a.id} className="hover:bg-ink-50">
                  <td>
                    <Link href={`/artists/${a.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                      {initials(a, "h-8 w-8 text-[11px]")}
                      <span>
                        {a.name}
                        {a.genre && <span className="block text-xs font-normal text-ink-500">{a.genre}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="max-w-72 text-sm">
                    {a.partActs.length > 0 && <div className="truncate">{a.partActs.map((l) => l.child.name).join(", ")}</div>}
                    {a.partOf.length > 0 && <div className="truncate text-xs text-ink-500">Part of {a.partOf.map((l) => l.parent.name).join(", ")}</div>}
                    {!a.partActs.length &&
                      !a.partOf.length &&
                      (a._count.members ? <span className="text-ink-500">{a._count.members} people</span> : <span className="text-ink-400">–</span>)}
                  </td>
                  <td className="whitespace-nowrap">
                    {a.phone ? <a href={`tel:${a.phone.replace(/\s/g, "")}`}>{a.phone}</a> : <span className="text-ink-400">–</span>}
                  </td>
                  <td className="max-w-56 truncate">{a.email || <span className="text-ink-400">–</span>}</td>
                  <td>{a.agent?.name ?? <span className="text-ink-400">–</span>}</td>
                  <td className="text-right tabular-nums">{a._count.bookings}</td>
                  <td>{onTime(a.id) ?? <span className="text-ink-400">–</span>}</td>
                  <td>{a.login ? <span className="badge bg-emerald-50 text-emerald-800">Login</span> : <span className="text-ink-400">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
