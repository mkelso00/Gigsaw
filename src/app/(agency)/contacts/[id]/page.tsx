import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addContactNote, deleteContactNote } from "@/actions/crm";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { DefinitionList, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CONTACT_TYPE_LABELS, type ContactType } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { splitTags } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [contact, settings] = await Promise.all([
    prisma.contact.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
        bookings: { orderBy: { setStart: "desc" }, include: { artist: { select: { name: true } }, venue: { select: { name: true } } } },
      },
    }),
    getSettings(user.agencyId),
  ]);
  if (!contact) notFound();

  return (
    <div>
      <PageHeader
        title={contact.name}
        subtitle={[CONTACT_TYPE_LABELS[contact.type as ContactType], contact.company].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href={`/contacts/${contact.id}/edit`} className="btn">
              Edit
            </Link>
            {contact.type === "PROMOTER" && (
              <Link href={`/bookings/new?promoterId=${contact.id}`} className="btn btn-primary">
                New booking
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="card card-pad">
            <DefinitionList
              items={[
                ["Email", contact.email && <a href={`mailto:${contact.email}`} className="link">{contact.email}</a>],
                ["Phone", contact.phone && <a href={`tel:${contact.phone}`} className="link">{contact.phone}</a>],
                ["Address", contact.address],
                ["Tags", splitTags(contact.tags).map((t) => `#${t}`).join(" ")],
              ]}
            />
          </section>
          <section>
            <h2 className="section-title mb-3">Bookings</h2>
            {contact.bookings.length === 0 ? (
              <Empty>No bookings with this contact yet.</Empty>
            ) : (
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Artist</th>
                      <th>Venue</th>
                      <th>Status</th>
                      <th className="text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contact.bookings.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link href={`/bookings/${b.id}`} className="link">
                            {formatDate(b.arriveBy, b.timezone)}
                          </Link>
                        </td>
                        <td>{b.artist.name}</td>
                        <td>{b.venue?.name ?? "–"}</td>
                        <td>
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="text-right">{formatMoney(b.feeMinor, b.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <section className="card card-pad">
          <h2 className="section-title mb-3">Notes and history</h2>
          <ActionForm action={addContactNote.bind(null, contact.id)} className="mb-4 space-y-2">
            <textarea name="body" rows={3} required placeholder="Call notes, what was agreed, follow-ups" className="input" />
            <SubmitButton className="btn btn-sm btn-primary">Add note</SubmitButton>
          </ActionForm>
          {contact.notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {contact.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {n.author?.name ?? "Someone"} · {formatDateTime(n.createdAt, settings.defaultTimezone)}
                    </span>
                    <form action={deleteContactNote.bind(null, n.id)}>
                      <ConfirmButton message="Delete this note?" className="text-rose-600 hover:underline">
                        Delete
                      </ConfirmButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
