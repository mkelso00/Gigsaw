import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deletePerson, setPersonLogin, updatePerson } from "@/actions/people";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { PersonForm } from "@/components/person-form";
import { ArtistDot, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personFormOptions } from "@/lib/people";
import { personName } from "@/lib/person-name";
import { venueColour } from "@/lib/rota";
import { formatDate, localTime } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [p, options] = await Promise.all([
    prisma.person.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        acts: { include: { act: { select: { id: true, name: true, colour: true } } } },
        venue: true,
        company: true,
        login: { include: { pushSubscriptions: { select: { device: true } } } },
      },
    }),
    personFormOptions(user.agencyId),
  ]);
  if (!p) notFound();
  const actIds = p.acts.map((a) => a.artistId);
  const upcoming = actIds.length
    ? await prisma.booking.findMany({
        where: { agencyId: user.agencyId, artistId: { in: actIds }, status: { notIn: ["CANCELLED", "ENQUIRY"] }, setStart: { gte: new Date() } },
        include: { artist: { select: { name: true, colour: true } }, venue: { select: { name: true } } },
        orderBy: { setStart: "asc" },
        take: 8,
      })
    : [];
  const companyName = p.venue?.name ?? (p.company ? p.company.company || p.company.name : "");

  return (
    <div>
      <PageHeader
        eyebrow="Person"
        title={
          <span>
            {personName(p)}
            {p.pronouns && <span className="ml-3 text-lg font-normal text-ink-500">{p.pronouns}</span>}
          </span>
        }
        subtitle={
          [p.alias ? `${p.firstName} ${p.surname}`.trim() : "", [p.jobTitle, companyName].filter(Boolean).join(" at ")].filter(Boolean).join(" · ") || undefined
        }
        actions={
          p.phone ? (
            <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="btn">
              Call {p.phone}
            </a>
          ) : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <PersonForm
          action={updatePerson.bind(null, p.id)}
          values={{
            ...p,
            company: companyName,
            acts: p.acts.map((a) => ({ name: a.act.name, jobTitle: a.jobTitle })),
          }}
          {...options}
          submitLabel="Save changes"
          cancelHref="/people"
        />
        <div className="space-y-6">
          <section className="card card-pad">
            <h2 className="section-title mb-3">Acts</h2>
            {p.acts.length ? (
              <ul className="space-y-2 text-sm">
                {p.acts.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <ArtistDot colour={m.act.colour} />
                    <Link href={`/artists/${m.act.id}`} className="link">
                      {m.act.name}
                    </Link>
                    {m.jobTitle && <span className="text-ink-500">· {m.jobTitle}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Not in any acts. Add one in the form.</p>
            )}
            {p.venue && (
              <p className="mt-4 flex items-center gap-2 border-t border-ink-100 pt-4 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: venueColour(p.venue) }} />
                {p.jobTitle || "Contact"} at{" "}
                <Link href={`/venues/${p.venue.id}`} className="link">
                  {p.venue.name}
                </Link>
              </p>
            )}
          </section>

          {upcoming.length > 0 && (
            <section className="card card-pad">
              <h2 className="section-title mb-3">Coming up</h2>
              <ul className="divide-y divide-ink-100 text-sm">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/bookings/${b.id}`} className="min-w-0">
                      <div className="truncate font-medium hover:underline">
                        {formatDate(b.arriveBy, b.timezone)}, {localTime(b.setStart, b.timezone)}
                      </div>
                      <div className="flex items-center gap-1.5 truncate text-xs text-ink-500">
                        <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                        {actName(b)} · {b.venue?.name ?? "No venue"}
                      </div>
                    </Link>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card card-pad">
            <h2 className="section-title">App login</h2>
            <p className="mt-1 text-sm text-ink-500">
              {p.login
                ? `Signs in as ${p.login.email}. They see the bookings for every act they're in, and only their act's fee, never what the venue or customer pays.`
                : "Give them a login to see their bookings, check in on arrival and get reminders on their phone."}
            </p>
            {p.login && (
              <p className="mt-1 text-sm text-ink-500" data-testid="push-status">
                {p.login.pushSubscriptions.length
                  ? `Phone reminders on: ${[...new Set(p.login.pushSubscriptions.map((s) => s.device || "Phone"))].join(", ")}.`
                  : "Phone reminders are off; reminders go by email and text."}
              </p>
            )}
            <ActionForm action={setPersonLogin.bind(null, p.id)} className="mt-4 space-y-3">
              <Field label="Email">
                <input name="email" type="email" required defaultValue={p.login?.email ?? p.email} className="input" />
              </Field>
              <Field label={p.login ? "New password" : "Password"} hint="At least 8 characters">
                <input name="password" type="text" minLength={8} required autoComplete="off" className="input" />
              </Field>
              <SubmitButton>{p.login ? "Reset password" : "Create login"}</SubmitButton>
            </ActionForm>
          </section>

          <form action={deletePerson.bind(null, p.id)}>
            <ConfirmButton message={`Delete ${personName(p)}? Their acts and bookings stay.`} className="btn btn-danger w-full">
              Delete person
            </ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
