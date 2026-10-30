import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { deleteEnquiry, setEnquiryStatus } from "@/actions/enquiries";
import { ConfirmButton } from "@/components/forms";
import { FilterPanel } from "@/components/header-actions";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { ENQUIRY_EVENT_TYPES, enquiryRows, enquiryTypeLabel } from "@/lib/enquiries";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Enquiries" };
export const dynamic = "force-dynamic";

const VIEWS = { new: "New", done: "Dealt with", all: "All" } as const;
type View = keyof typeof VIEWS;

/** Enquiries from the form on the business's website: new ones first, each with what it made. */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const view: View = sp.view === "done" || sp.view === "all" ? sp.view : "new";
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;

  const where: Prisma.EnquiryWhereInput = { agencyId: user.agencyId };
  if (view !== "all") where.status = view === "new" ? "NEW" : "DONE";
  if (sp.type && ENQUIRY_EVENT_TYPES.some((t) => t.value === sp.type)) where.eventType = sp.type;
  if (sp.q) {
    where.OR = ["name", "email", "phone", "venue", "message", "budget"].map((k) => ({ [k]: { contains: sp.q, mode: "insensitive" } }));
  }
  const [enquiries, counts] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        booking: { select: { id: true, reference: true, status: true } },
        event: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.enquiry.groupBy({ by: ["status"], where: { agencyId: user.agencyId }, _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const tabCount: Record<View, number> = { new: count("NEW"), done: count("DONE"), all: count("NEW") + count("DONE") };
  const link = (v: View) =>
    `/enquiries?${new URLSearchParams({ ...(v !== "new" ? { view: v } : {}), ...(sp.type ? { type: sp.type } : {}), ...(sp.q ? { q: sp.q } : {}) })}`;

  return (
    <div>
      <PageHeader
        title="Enquiries"
        subtitle="From the enquiry form on your website. Each one adds the customer, a note of what they asked and an Enquiry booking (or a wedding)."
        actions={
          user.role === "ADMIN" ? (
            <Link href="/settings/enquiries" className="btn">
              Form settings
            </Link>
          ) : undefined
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
              className={`rounded-full px-1.5 text-[11px] font-semibold ${v === "new" && tabCount.new ? "bg-amber-400 text-ink-950" : "bg-ink-100 text-ink-600"}`}
            >
              {tabCount[v]}
            </span>
          </Link>
        ))}
      </div>

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

      {enquiries.length === 0 ? (
        <Empty>
          {sp.q || sp.type ? (
            "No enquiries match."
          ) : view === "new" ? (
            <>
              No new enquiries.{" "}
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
                  {e.booking && (
                    <Link href={`/bookings/${e.booking.id}`} className="btn btn-sm">
                      Booking {e.booking.reference}
                    </Link>
                  )}
                  {e.event && (
                    <Link href={`/events/${e.event.id}`} className="btn btn-sm">
                      Wedding
                    </Link>
                  )}
                  {e.contact && (
                    <Link href={`/contacts/${e.contact.id}`} className="btn btn-sm">
                      Customer
                    </Link>
                  )}
                  {!e.booking && !e.event && <span className="text-xs text-ink-500">No date given, so no booking was made.</span>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    <form action={setEnquiryStatus.bind(null, e.id, e.status === "NEW" ? "DONE" : "NEW")}>
                      <button className={`btn btn-sm ${e.status === "NEW" ? "btn-primary" : ""}`}>
                        {e.status === "NEW" ? "Mark dealt with" : "Back to new"}
                      </button>
                    </form>
                    <form action={deleteEnquiry.bind(null, e.id)}>
                      <ConfirmButton
                        className="btn btn-sm btn-danger"
                        message="Delete this enquiry as spam? Its Enquiry booking or wedding goes too (if nothing's been added to it), and the customer if they were new."
                      >
                        Spam
                      </ConfirmButton>
                    </form>
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
