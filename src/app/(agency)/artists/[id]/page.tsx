import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resetCalendarToken, setArtistLogin } from "@/actions/crm";
import { addActMember, addActPart, removeActMember, removeActPart } from "@/actions/people";
import { arrivalDetail } from "@/components/arrival-panel";
import { AwayCard } from "@/components/away-card";
import { CopyField } from "@/components/client-bits";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ArrivalBadge, ArtistDot, Empty, Field, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { punctuality } from "@/lib/arrival";
import { requireStaff } from "@/lib/auth";
import { awayBetween } from "@/lib/away";
import { arrivalFor } from "@/lib/bookings";
import { getSettings, prisma } from "@/lib/db";
import { ACT_TYPE_LABELS } from "@/lib/act-profile";
import { formatMoney } from "@/lib/money";
import { personName } from "@/lib/person-name";
import { formatDate, formatMinutes, localDateKey, localTime } from "@/lib/time";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await requireStaff();
  const a = await prisma.artist.findFirst({
    where: { id, agencyId: user.agencyId },
    select: { name: true },
  });
  return { title: a?.name ?? "Artist" };
}

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [artist, settings, peopleRows, actRows] = await Promise.all([
    prisma.artist.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        agent: { select: { name: true } },
        members: { include: { person: { include: { login: { select: { id: true } } } } }, orderBy: { person: { firstName: "asc" } } },
        partActs: { include: { child: { select: { id: true, name: true, colour: true, phone: true } } } },
        partOf: { include: { parent: { select: { id: true, name: true, colour: true } } } },
        login: {
          select: {
            email: true,
            pushSubscriptions: { select: { device: true } },
          },
        },
        bookings: {
          where: { archivedAt: null },
          orderBy: { setStart: "desc" },
          include: {
            venue: {
              select: {
                name: true,
                city: true,
                latitude: true,
                longitude: true,
              },
            },
            checkIns: {
              select: {
                kind: true,
                at: true,
                source: true,
                distanceM: true,
                etaMinutes: true,
              },
            },
          },
        },
      },
    }),
    getSettings(user.agencyId),
    prisma.person.findMany({ where: { agencyId: user.agencyId }, select: { firstName: true, surname: true, alias: true } }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const actNames = actRows.map((a) => a.name);
  const people = [...new Set(peopleRows.map(personName))].sort();
  if (!artist) notFound();

  const now = new Date();
  const today = localDateKey(now, settings.defaultTimezone);
  // Days they can't play from today on, including days an act inside this one is away.
  const away = (await awayBetween(user.agencyId, today, "9999-12-31")).filter((e) => e.artistId === artist.id);
  const rows = artist.bookings.map((b) => ({
    b,
    a: arrivalFor(b, settings, now),
  }));
  const upcoming = rows.filter((r) => r.b.setStart >= now && r.b.status !== "CANCELLED").reverse();
  const past = rows.filter((r) => r.b.setStart < now);
  const stats = punctuality(past.map((r) => r.a));

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const feedUrl = `${proto}://${host}/api/calendar/${artist.calendarToken}`;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: artist.colour }}>
              {artist.name.slice(0, 2).toUpperCase()}
            </span>
            {artist.name}
          </span>
        }
        subtitle={[artist.genre, artist.agent && `Agent: ${artist.agent.name}`, artist.email, artist.phone].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href={`/artists/${artist.id}/edit`} className="btn">
              Edit
            </Link>
            <Link href={`/bookings/new?artistId=${artist.id}`} className="btn btn-primary">
              New booking
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="On-time rate"
          value={stats.onTimeRate != null ? `${Math.round(stats.onTimeRate * 100)}%` : "No data"}
          hint={stats.tracked ? `${stats.onTime} of ${stats.tracked} past gigs` : "Builds up as gigs happen"}
        />
        <Stat
          label="Late arrivals"
          value={stats.late}
          hint={stats.averageMinutesLate != null ? `Avg ${formatMinutes(stats.averageMinutesLate)} late` : undefined}
        />
        <Stat label="No check-in" value={stats.missing} hint="Gigs with no arrival recorded" />
        <Stat
          label="Typical arrival"
          value={
            stats.averageArrivalOffset != null ? `${formatMinutes(stats.averageArrivalOffset)} ${stats.averageArrivalOffset <= 0 ? "early" : "late"}` : "–"
          }
          hint={`${stats.verifiedOnSite} verified at the venue`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <section>
            <h2 className="section-title mb-3">Upcoming</h2>
            {upcoming.length === 0 ? <Empty>No upcoming shows.</Empty> : <BookingTable rows={upcoming} />}
          </section>
          <section>
            <h2 className="section-title mb-3">Past shows and arrival history</h2>
            {past.length === 0 ? <Empty>No past shows yet.</Empty> : <BookingTable rows={past} showArrival />}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {(() => {
            const link = (href: string, text: string) => (
              <a href={href} target="_blank" rel="noreferrer" className="link break-all">
                {text}
              </a>
            );
            const rows: [string, React.ReactNode][] = [
              ["Type", ACT_TYPE_LABELS[artist.actType as keyof typeof ACT_TYPE_LABELS] ?? ""],
              ["Based in", artist.town],
              ["Usual fee", artist.usualFeeMinor != null ? formatMoney(artist.usualFeeMinor, settings.defaultCurrency) : ""],
              ["Video", artist.videoUrl ? link(artist.videoUrl, "Watch") : ""],
              ["Photo", artist.photoUrl ? link(artist.photoUrl, "View") : ""],
              ["Instagram", artist.instagram ? link(`https://instagram.com/${artist.instagram}`, `@${artist.instagram}`) : ""],
              ["Website", artist.website ? link(artist.website, artist.website.replace(/^https?:\/\//, "")) : ""],
            ].filter(([, v]) => v !== "") as [string, React.ReactNode][];
            const bank = [artist.bankAccountName, artist.bankSortCode, artist.bankAccountNumber].filter(Boolean);
            return (
              <section className="card card-pad">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="section-title">Profile</h2>
                  <Link href={`/artists/${artist.id}/edit`} className="link text-sm">
                    Edit
                  </Link>
                </div>
                {rows.length === 0 && !bank.length && !artist.setList ? (
                  <p className="mt-2 text-sm text-ink-500">No profile yet. Add links, their usual fee and bank details from Edit.</p>
                ) : (
                  <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                    {rows.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-ink-500">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                    {bank.length > 0 && (
                      <div className="contents">
                        <dt className="text-ink-500">Bank</dt>
                        <dd className="tabular-nums">
                          {bank.map((x) => (
                            <span key={x} className="block">
                              {x}
                            </span>
                          ))}
                          {artist.vatRegistered && (
                            <span className="block text-xs text-ink-500">VAT registered{artist.vatNumber ? `: ${artist.vatNumber}` : ""}</span>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {artist.setList && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-ink-500">Set list</summary>
                    <p className="mt-2 whitespace-pre-line">{artist.setList}</p>
                  </details>
                )}
              </section>
            );
          })()}
          <AwayCard artistId={artist.id} actName={artist.name} entries={away} today={today} />
          <section className="card card-pad" id="line-up">
            <h2 className="section-title">Members</h2>
            <p className="mt-1 mb-4 text-sm text-ink-500">
              The acts that make up this one, e.g. Wonderlust = Graham McKee Solo + Jo Drummond Solo. Search your acts to add one. Their gigs are checked
              against each other, and each member sees this act&apos;s gigs too.
            </p>
            {artist.partActs.length > 0 && (
              <ul className="mb-4 divide-y divide-ink-100 text-sm">
                {artist.partActs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <ArtistDot colour={l.child.colour} />
                      <Link href={`/artists/${l.child.id}`} className="link">
                        {l.child.name}
                      </Link>
                      {l.role && <span className="text-ink-500">· {l.role}</span>}
                    </span>
                    <form action={removeActPart.bind(null, l.id)}>
                      <ConfirmButton message={`Take ${l.child.name} out of ${artist.name}?`} className="btn btn-sm">
                        Remove
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <datalist id="act-names">
              {actNames
                .filter((n) => n !== artist.name)
                .map((n) => (
                  <option key={n} value={n} />
                ))}
            </datalist>
            <ActionForm action={addActPart.bind(null, artist.id)} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <input name="act" list="act-names" required placeholder="Search acts…" aria-label="Act" className="input" autoComplete="off" />
              <input name="role" placeholder="Role" aria-label="Role" className="input" />
              <SubmitButton className="btn">Add</SubmitButton>
            </ActionForm>
            {artist.partOf.length > 0 && (
              <p className="mt-4 border-t border-ink-100 pt-4 text-sm text-ink-600">
                Part of{" "}
                {artist.partOf.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ", "}
                    <Link href={`/artists/${l.parent.id}`} className="link">
                      {l.parent.name}
                    </Link>
                  </span>
                ))}
                .
              </p>
            )}
          </section>

          <section className="card card-pad" id="members">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="section-title">People</h2>
              <Link href={`/people/new?actId=${artist.id}`} className="text-sm text-ink-500 hover:text-ink-950">
                Add with full details →
              </Link>
            </div>
            <p className="mt-1 mb-4 text-sm text-ink-500">
              {artist.members.length
                ? "Reminders and gig changes go to each person. Anyone in another act too is checked for clashes across both."
                : "Optional: the people in this act, with their own phone, email and login. Until you add any, reminders and changes go to the act's own email and phone."}
            </p>
            {artist.members.length > 0 && (
              <ul className="mb-4 divide-y divide-ink-100 text-sm">
                {artist.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/people/${m.person.id}`} className="link">
                        {personName(m.person)}
                      </Link>
                      {m.jobTitle && <span className="text-ink-500"> · {m.jobTitle}</span>}
                      <div className="truncate text-xs text-ink-500">
                        {[m.person.phone, m.person.email].filter(Boolean).join(" · ") || "No phone or email yet"}
                        {m.person.login ? " · has app login" : ""}
                      </div>
                    </div>
                    <form action={removeActMember.bind(null, m.id)}>
                      <ConfirmButton message={`Take ${personName(m.person)} out of ${artist.name}?`} className="btn btn-sm">
                        Remove
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <datalist id="people-names">
              {people.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <ActionForm action={addActMember.bind(null, artist.id)} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <input name="person" list="people-names" required placeholder="Name" aria-label="Name" className="input" autoComplete="off" />
              <input name="jobTitle" placeholder="Role" aria-label="Role" className="input" />
              <SubmitButton className="btn">Add</SubmitButton>
            </ActionForm>
          </section>

          <section className="card card-pad">
            <h2 className="section-title">Artist app login</h2>
            <p className="mt-1 text-sm text-slate-500">
              {artist.login
                ? `Signed up as ${artist.login.email}. Set a new password below if they've forgotten it.`
                : "Give the artist a login so they can see their gigs and check in on arrival from their phone."}
            </p>
            <p className="mt-1 mb-4 text-sm text-ink-500" data-testid="push-status">
              {!artist.login
                ? "Gig reminders go by email and text until they have a login."
                : artist.login.pushSubscriptions.length
                  ? `Phone reminders on: ${[...new Set(artist.login.pushSubscriptions.map((p) => p.device || "Phone"))].join(", ")}.`
                  : "Phone reminders are off. They can turn them on in their app; until then reminders go by email and text."}
            </p>
            <ActionForm action={setArtistLogin.bind(null, artist.id)} className="space-y-3">
              <Field label="Email">
                <input name="email" type="email" required defaultValue={artist.login?.email ?? artist.email} className="input" />
              </Field>
              <Field label={artist.login ? "New password" : "Password"} hint="At least 8 characters">
                <input name="password" type="text" required minLength={8} className="input" autoComplete="off" />
              </Field>
              <SubmitButton>{artist.login ? "Reset password" : "Create login"}</SubmitButton>
            </ActionForm>
          </section>

          <section className="card card-pad">
            <h2 className="section-title">Calendar feed</h2>
            <p className="mt-1 mb-3 text-sm text-slate-500">
              Subscribe to this link in Google, Apple or Outlook calendar to see this artist&apos;s shows. Anyone with the link can see the dates, so only share
              it with the artist&apos;s team.
            </p>
            <CopyField value={feedUrl} />
            <form action={resetCalendarToken.bind(null, artist.id)} className="mt-3">
              <ConfirmButton message="Make a new link? The old one will stop working." className="btn btn-sm">
                Make a new link
              </ConfirmButton>
            </form>
          </section>

          {artist.notes && (
            <section className="card card-pad">
              <h2 className="section-title mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-line">{artist.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type Row = {
  b: {
    id: string;
    arriveBy: Date;
    setStart: Date;
    timezone: string;
    status: string;
    feeMinor: number;
    currency: string;
    venue: { name: string; city: string } | null;
  };
  a: ReturnType<typeof arrivalFor>;
};

function BookingTable({ rows, showArrival = false }: { rows: Row[]; showArrival?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Venue</th>
            <th>Status</th>
            <th className="text-right">Fee</th>
            {showArrival && <th>Arrival</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, a }) => (
            <tr key={b.id}>
              <td className="whitespace-nowrap">
                <Link href={`/bookings/${b.id}`} className="link">
                  {formatDate(b.arriveBy, b.timezone)}
                </Link>
                <div className="text-xs text-slate-500">Call {localTime(b.arriveBy, b.timezone)}</div>
              </td>
              <td>{b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "–"}</td>
              <td>
                <StatusBadge status={b.status} />
              </td>
              <td className="text-right whitespace-nowrap">{formatMoney(b.feeMinor, b.currency)}</td>
              {showArrival && (
                <td>
                  <ArrivalBadge state={a.state} />
                  <div className="mt-1 text-xs text-slate-500">{arrivalDetail(a, b.timezone)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
