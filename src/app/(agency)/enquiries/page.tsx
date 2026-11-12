import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { deleteEnquiry, setEnquiryStatus } from "@/actions/enquiries";
import { makeProposal } from "@/actions/proposals";
import { ActionForm, ConfirmButton, SubmitButton, ServerForm } from "@/components/forms";
import { FilterPanel } from "@/components/header-actions";
import { ProposalList, ProposalStatusBadge, proposalRowSelect } from "@/components/proposal-list";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { channelLabel, ENQUIRY_EVENT_TYPES, enquiryRows, enquiryTypeLabel } from "@/lib/enquiries";
import { effectiveStatus, OPEN_STATUSES, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES, proposalRef, type ProposalStatus } from "@/lib/proposals";
import { formatDateTime, localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Inbound leads" };
export const dynamic = "force-dynamic";

const VIEWS = { new: "New", done: "Dealt with", all: "All leads", quotes: "Proposals" } as const;
type View = keyof typeof VIEWS;

/** Enquiries from the form on the business's website or added by hand, new ones first, each with what it made and its proposal. */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const view: View = sp.view === "done" || sp.view === "all" || sp.view === "quotes" ? sp.view : "new";
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const today = localDateKey(new Date(), tz);

  const where: Prisma.EnquiryWhereInput = { agencyId: user.agencyId };
  if (view !== "all") where.status = view === "new" ? "NEW" : "DONE";
  if (sp.type && ENQUIRY_EVENT_TYPES.some((t) => t.value === sp.type)) where.eventType = sp.type;
  if (sp.q) {
    where.OR = ["name", "email", "phone", "venue", "message", "budget"].map((k) => ({ [k]: { contains: sp.q, mode: "insensitive" } }));
  }
  // The Proposals tab: every proposal's latest version, those waiting for an answer first.
  const proposalStatus = PROPOSAL_STATUSES.find((s) => s === sp.status);
  const live = { OR: [{ validUntil: null }, { validUntil: { gte: today } }] };
  const proposalWhere =
    proposalStatus === "EXPIRED"
      ? { OR: [{ status: "EXPIRED" }, { status: { in: OPEN_STATUSES }, validUntil: { lt: today } }] }
      : proposalStatus && OPEN_STATUSES.includes(proposalStatus)
        ? { status: proposalStatus, ...live }
        : proposalStatus
          ? { status: proposalStatus }
          : {};
  const [enquiries, counts, proposals, openProposals] = await Promise.all([
    view === "quotes"
      ? Promise.resolve([])
      : prisma.enquiry.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 200,
          include: {
            booking: { select: { id: true, reference: true, status: true } },
            event: { select: { id: true, name: true } },
            contact: { select: { id: true, name: true } },
            // The proposal that counts: the newest version that hasn't been replaced.
            quotes: {
              where: { supersededById: null },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, number: true, version: true, status: true, supersededById: true, validUntil: true },
            },
          },
        }),
    prisma.enquiry.groupBy({ by: ["status"], where: { agencyId: user.agencyId }, _count: true }),
    view === "quotes"
      ? prisma.quote.findMany({
          where: {
            agencyId: user.agencyId,
            supersededById: null,
            AND: [
              proposalWhere,
              sp.q
                ? { OR: [{ title: { contains: sp.q, mode: "insensitive" as const } }, { contact: { name: { contains: sp.q, mode: "insensitive" as const } } }] }
                : {},
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 200,
          select: proposalRowSelect,
        })
      : Promise.resolve([]),
    prisma.quote.count({ where: { agencyId: user.agencyId, supersededById: null, status: { in: OPEN_STATUSES }, ...live } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const tabCount: Record<View, number> = { new: count("NEW"), done: count("DONE"), all: count("NEW") + count("DONE"), quotes: openProposals };
  const link = (v: View) =>
    `/enquiries?${new URLSearchParams({ ...(v !== "new" ? { view: v } : {}), ...(sp.type && v !== "quotes" ? { type: sp.type } : {}), ...(sp.q ? { q: sp.q } : {}) })}`;
  // Waiting for the customer, then drafts, then the rest.
  const order = (s: ProposalStatus) => (OPEN_STATUSES.includes(s) ? 0 : s === "DRAFT" ? 1 : 2);
  const sortedProposals = [...proposals].sort((a, b) => order(effectiveStatus(a, today)) - order(effectiveStatus(b, today)));

  return (
    <div>
      <PageHeader
        title={view === "quotes" ? "Proposals" : "Inbound leads"}
        subtitle={
          view === "quotes"
            ? "Every proposal, newest first. The customer signs and approves it online, and it becomes a booked wedding or event."
            : "From the enquiry form on your website, or added by hand when they come by email or phone. Each one adds the customer, a note of what they asked and an Enquiry booking (or a wedding). Turn a lead into a proposal and it moves to Dealt with."
        }
        actions={
          <>
            <Link href="/enquiries/new" className="btn btn-primary">
              Add lead
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/settings/enquiries" className="btn">
                Form settings
              </Link>
            )}
          </>
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-200">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={link(v)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              v === view ? "border-ink-950 font-medium text-ink-950" : "border-transparent text-ink-500 hover:text-ink-950"
            }`}
          >
            {VIEWS[v]}
            <span
              className={`rounded-full px-1.5 text-[11px] font-semibold ${
                v === "new" && tabCount.new
                  ? "bg-amber-400 text-ink-950"
                  : v === "quotes" && tabCount.quotes
                    ? "bg-volt-200 text-ink-950"
                    : "bg-ink-100 text-ink-600"
              }`}
              title={v === "quotes" ? "Waiting for the customer's answer" : undefined}
            >
              {tabCount[v]}
            </span>
          </Link>
        ))}
      </div>

      {view === "quotes" && (
        <>
          <p className="mb-4 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
            Proposals are made from leads: open a lead in{" "}
            <Link href="/enquiries" className="link">
              New leads
            </Link>{" "}
            and press <span className="font-medium">Turn into a proposal</span>. For a repeat customer, use Make a proposal on their customer page.
          </p>
          <FilterPanel active={[sp.q, sp.status].filter(Boolean).length}>
            <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
              <input type="hidden" name="view" value="quotes" />
              <label className="min-w-48 flex-1">
                <span className="label">Search</span>
                <input name="q" defaultValue={sp.q} placeholder="Proposal name or customer" className="input" />
              </label>
              <label>
                <span className="label">Status</span>
                <select name="status" defaultValue={proposalStatus ?? ""} className="input">
                  <option value="">Any status</option>
                  {PROPOSAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROPOSAL_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn">Filter</button>
            </form>
          </FilterPanel>
          {sortedProposals.length === 0 ? (
            <Empty>{sp.q || proposalStatus ? "No proposals match." : "No proposals yet. Press Turn into a proposal on a lead to start one."}</Empty>
          ) : (
            <ProposalList proposals={sortedProposals} today={today} />
          )}
        </>
      )}

      {view !== "quotes" && (
        <FilterPanel active={[sp.q, sp.type].filter(Boolean).length}>
          <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
            {view !== "new" && <input type="hidden" name="view" value={view} />}
            <label className="min-w-48 flex-1">
              <span className="label">Search</span>
              <input name="q" defaultValue={sp.q} placeholder="Name, email, venue, message" className="input" />
            </label>
            <label>
              <span className="label">Type of event</span>
              <select name="type" defaultValue={sp.type ?? ""} className="input">
                <option value="">Any type</option>
                {ENQUIRY_EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn">Filter</button>
          </form>
        </FilterPanel>
      )}

      {view === "quotes" ? null : enquiries.length === 0 ? (
        <Empty>
          {sp.q || sp.type ? (
            "No leads match."
          ) : view === "new" ? (
            <>
              No new leads.{" "}
              {settings.enquiryOn ? (
                "New ones from your website will show up here."
              ) : (
                <>
                  Put the enquiry form on your website from{" "}
                  <Link href="/settings/enquiries" className="link">
                    Settings
                  </Link>{" "}
                  to get them here.
                </>
              )}
            </>
          ) : (
            "Nothing here yet."
          )}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {enquiries.map((e) => {
            const proposal = e.quotes[0];
            const details = enquiryRows({ ...e, acts: Array.isArray(e.acts) ? (e.acts as { id: string; name: string }[]) : [] }).filter(
              ([k]) => !["Name", "Email", "Phone", "Type of event", "Message"].includes(k),
            );
            return (
              <li key={e.id} id={e.id} className={`card scroll-mt-6 p-4 sm:p-5 ${e.status === "NEW" ? "ring-2 ring-amber-300" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink-950">{e.name}</h2>
                      {e.status === "NEW" ? (
                        <span className="badge bg-amber-100 text-amber-900">New</span>
                      ) : (
                        <span className="badge bg-ink-100 text-ink-600">Dealt with</span>
                      )}
                      {e.eventType && <span className="badge bg-ink-100 text-ink-700">{enquiryTypeLabel(e.eventType)}</span>}
                      {e.channel !== "WEBSITE" && <span className="badge bg-ink-100 text-ink-700">{channelLabel(e.channel)}</span>}
                      {proposal && (
                        <Link href={`/quotes/${proposal.id}`} className="inline-flex items-center gap-1.5 hover:underline" title="This lead's proposal">
                          <span className="font-mono text-[11px] text-ink-500">{proposalRef(proposal)}</span>
                          <ProposalStatusBadge q={proposal} today={today} />
                        </Link>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <a href={`mailto:${e.email}`} className="link break-all">
                        {e.email}
                      </a>
                      {e.phone && (
                        <a href={`tel:${e.phone.replace(/\s/g, "")}`} className="link">
                          {e.phone}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-ink-500">
                    {formatDateTime(e.createdAt, tz)}
                    {e.source && <div className="max-w-[16rem] truncate">from {e.source}</div>}
                  </div>
                </div>

                {details.length > 0 && (
                  <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                    {details.map(([k, v]) => (
                      <div key={k} className={k === "Acts they like" ? "sm:col-span-3" : ""}>
                        <dt className="text-xs text-ink-500">{k}</dt>
                        <dd className="mt-0.5 text-ink-950">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {e.message && <p className="mt-4 rounded-lg bg-ink-50 p-3 text-sm whitespace-pre-line text-ink-800">{e.message}</p>}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
                  {proposal ? (
                    <Link href={`/quotes/${proposal.id}`} className="btn btn-sm">
                      Proposal {proposalRef(proposal)}
                    </Link>
                  ) : (
                    e.contact && (
                      <ActionForm action={makeProposal.bind(null, "enquiry", e.id)}>
                        <SubmitButton className="btn btn-sm btn-volt" pendingText="Starting…">
                          Turn into a proposal
                        </SubmitButton>
                      </ActionForm>
                    )
                  )}
                  {e.booking && (
                    <Link href={`/bookings/${e.booking.id}`} className="btn btn-sm">
                      Booking {e.booking.reference}
                    </Link>
                  )}
                  {e.event && (
                    <Link href={`/events/${e.event.id}`} className="btn btn-sm">
                      {e.eventType === "WEDDING" ? "Wedding" : "Event"}
                    </Link>
                  )}
                  {e.contact && (
                    <Link href={`/contacts/${e.contact.id}`} className="btn btn-sm">
                      Customer
                    </Link>
                  )}
                  {!e.booking && !e.event && <span className="text-xs text-ink-500">No date given, so no booking was made.</span>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    <ServerForm action={setEnquiryStatus.bind(null, e.id, e.status === "NEW" ? "DONE" : "NEW")}>
                      <button className={`btn btn-sm ${e.status === "NEW" ? "btn-primary" : ""}`}>
                        {e.status === "NEW" ? "Mark dealt with" : "Back to new"}
                      </button>
                    </ServerForm>
                    <ServerForm action={deleteEnquiry.bind(null, e.id)}>
                      <ConfirmButton
                        className="btn btn-sm btn-danger"
                        message="Delete this lead as spam? Its Enquiry booking or wedding goes too (if nothing's been added to it), and the customer if they were new."
                      >
                        Spam
                      </ConfirmButton>
                    </ServerForm>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
