import type { Metadata } from "next";
import { companyToVenue } from "@/actions/crm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addContactNote, deleteContactNote, setCompanyLeadContact } from "@/actions/crm";
import { makeProposal } from "@/actions/proposals";
import { ActionForm, ConfirmButton, SubmitButton, ServerForm } from "@/components/forms";
import { ProposalList, proposalRowSelect } from "@/components/proposal-list";
import { DefinitionList, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { personName } from "@/lib/person-name";
import { requireStaff } from "@/lib/auth";
import { CONTACT_TYPE_LABELS, type ContactType, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { splitTags } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { BILLING_MODE_LABELS, billingModeOf } from "@/lib/monthly-billing";
import { formatDate, formatDateTime, localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Contact" };

/**
 * Who hears about this company's gigs (src/lib/client-recipient.ts): its lead contact for bookings, and whether
 * day-to-day emails may go to the company's own email when there's no lead contact.
 */
function CompanyMessages({
  contact,
}: {
  contact: {
    id: string;
    name: string;
    company: string;
    email: string;
    leadContactId: string | null;
    notifyOwner: boolean;
    people: { id: string; firstName: string; surname: string; alias: string; jobTitle: string }[];
  };
}) {
  const name = contact.company || contact.name;
  const lead = contact.people.find((p) => p.id === contact.leadContactId);
  return (
    <section className="card card-pad" id="client-messages">
      <h2 className="section-title">Who hears about gigs</h2>
      <p className="mt-1 text-sm text-ink-500" data-testid="company-messages">
        {lead
          ? `${personName(lead)} gets the arrival notes, confirmations, contracts and PO requests for ${name}'s bookings, unless the venue or the booking names someone else.`
          : contact.notifyOwner
            ? `With no lead contact, messages go to ${name}'s own email${contact.email ? ` (${contact.email})` : ""}, unless the venue or the booking names someone.`
            : `With no lead contact, arrival notes and confirmations for ${name} aren't sent at all. Invoices and PO requests still go to its own email${contact.email ? ` (${contact.email})` : ""}, as business documents.`}
      </p>
      <ActionForm action={setCompanyLeadContact.bind(null, contact.id)} className="mt-3 space-y-3 [&_[role=status]]:w-full">
        <label className="block">
          <span className="label">Lead contact for bookings</span>
          {/* Keyed so it shows the saved choice after the page refreshes (the form resets once saved). */}
          <select key={contact.leadContactId ?? ""} name="leadContactId" defaultValue={contact.leadContactId ?? ""} className="input">
            <option value="">Nobody</option>
            {contact.people.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
                {p.jobTitle ? `, ${p.jobTitle}` : ""}
              </option>
            ))}
          </select>
          {!contact.people.length && <span className="hint block">Add the people who deal with the bookings above, then choose one here.</span>}
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            key={String(contact.notifyOwner)}
            type="checkbox"
            name="notifyOwner"
            defaultChecked={contact.notifyOwner}
            className="mt-0.5 h-4 w-4 accent-ink-950"
          />
          <span>
            <span className="block text-sm font-medium">Send day-to-day emails to this company&apos;s own email</span>
            <span className="block text-xs text-ink-500">
              Turn off when the owners don&apos;t want the nitty gritty. Arrival notes and confirmations then go only to a lead contact, and aren&apos;t sent
              without one.
            </span>
          </span>
        </label>
        <SubmitButton className="btn">Save</SubmitButton>
      </ActionForm>
    </section>
  );
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [contact, settings, proposals] = await Promise.all([
    prisma.contact.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        contractTemplate: { select: { name: true } },
        notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
        people: { orderBy: { firstName: "asc" } },
        bookings: {
          where: { archivedAt: null },
          orderBy: { setStart: "desc" },
          include: { artist: { select: { name: true } }, venue: { select: { name: true } } },
        },
      },
    }),
    getSettings(user.agencyId),
    // Each proposal's latest version.
    prisma.quote.findMany({
      where: { agencyId: user.agencyId, contactId: id, supersededById: null },
      orderBy: { createdAt: "desc" },
      select: proposalRowSelect,
    }),
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
            {contact.type !== "CLIENT" && (
              <ServerForm action={companyToVenue.bind(null, contact.id)}>
                <ConfirmButton message={`Make ${contact.company || contact.name} a venue? Its people move to the venue.`} className="btn">
                  This is a venue
                </ConfirmButton>
              </ServerForm>
            )}
            {contact.type === "CLIENT" && (
              <ActionForm action={makeProposal.bind(null, "contact", contact.id)}>
                <SubmitButton className="btn" pendingText="Starting…">
                  Make a proposal
                </SubmitButton>
              </ActionForm>
            )}
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
                [
                  "Email",
                  contact.email && (
                    <a href={`mailto:${contact.email}`} className="link">
                      {contact.email}
                    </a>
                  ),
                ],
                [
                  "Phone",
                  contact.phone && (
                    <a href={`tel:${contact.phone}`} className="link">
                      {contact.phone}
                    </a>
                  ),
                ],
                ["Address", contact.address],
                [
                  "Contract for this client",
                  <span key="contract" data-testid="client-contract">
                    {contact.contractTemplate ? (
                      <>
                        {contact.contractTemplate.name}
                        <span className="text-ink-500">, for every new proposal, booking and wedding for them</span>
                      </>
                    ) : (
                      <span className="text-ink-500">None: by the type of event</span>
                    )}
                  </span>,
                ],
                ...(contact.type !== "CLIENT"
                  ? [
                      [
                        "Monthly bill",
                        <span key="billing" data-testid="client-billing">
                          {BILLING_MODE_LABELS[billingModeOf(contact.billing)]}
                          <span className="text-ink-500">
                            {" "}
                            ·{" "}
                            <Link href="/billing" className="link">
                              Monthly billing
                            </Link>
                          </span>
                        </span>,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
                [
                  "Tags",
                  splitTags(contact.tags)
                    .map((t) => `#${t}`)
                    .join(" "),
                ],
              ]}
            />
          </section>
          <section className="card card-pad">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="section-title">People here</h2>
              <Link href={`/people/new?companyId=${contact.id}`} className="btn btn-sm">
                + Add person
              </Link>
            </div>
            {contact.people.length ? (
              <ul className="mt-3 divide-y divide-ink-100 text-sm">
                {contact.people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>
                      <Link href={`/people/${p.id}`} className="link">
                        {personName(p)}
                      </Link>
                      {p.jobTitle && <span className="text-ink-500"> · {p.jobTitle}</span>}
                      {p.id === contact.leadContactId && <span className="badge ml-2 bg-volt-100 text-ink-950">Lead contact</span>}
                    </span>
                    <span className="text-xs text-ink-500">{[p.phone, p.email].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-500">Nobody linked yet. People whose company is {contact.company || contact.name} appear here.</p>
            )}
          </section>
          {contact.type !== "CLIENT" && <CompanyMessages contact={contact} />}
          {proposals.length > 0 && (
            <section>
              <h2 className="section-title mb-3">Proposals</h2>
              <ProposalList proposals={proposals} today={localDateKey(new Date(), settings.defaultTimezone)} showCustomer={false} />
            </section>
          )}
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
                      <th>Act</th>
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
                        <td>{actName(b)}</td>
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
                    <ServerForm action={deleteContactNote.bind(null, n.id)}>
                      <ConfirmButton message="Delete this note?" className="text-rose-600 hover:underline">
                        Delete
                      </ConfirmButton>
                    </ServerForm>
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
