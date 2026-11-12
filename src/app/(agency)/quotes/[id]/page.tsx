import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteDraftProposal, getProposalLink, newVersion, sendProposalNow, withdrawProposal } from "@/actions/proposals";
import { CopyField } from "@/components/client-bits";
import { ActionForm, ConfirmButton, SubmitButton, ServerForm } from "@/components/forms";
import { ProposalStatusBadge } from "@/components/proposal-list";
import { PageHeader, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDay } from "@/lib/enquiries";
import { formatMoney } from "@/lib/money";
import { linePlace, proposalInclude, proposalUrl, readyToSend } from "@/lib/proposal-server";
import { canEdit, canNewVersion, canResend, canSend, canWithdraw, effectiveStatus, lineTimes, proposalRef, proposalTotals } from "@/lib/proposals";
import { formatDateTime, localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Proposal" };
export const dynamic = "force-dynamic";

/** One proposal, for staff: what's on it (with the acts' fees and what we make), sending it, and its history. */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const q = await prisma.quote.findFirst({
    where: { id, agencyId: user.agencyId },
    include: { ...proposalInclude, event: { select: { id: true, name: true } }, enquiry: { select: { id: true, name: true } }, supersededBy: true },
  });
  if (!q) notFound();
  const [versions, activity] = await Promise.all([
    prisma.quote.findMany({
      where: { agencyId: user.agencyId, number: q.number },
      orderBy: { version: "desc" },
      select: { id: true, version: true, status: true, supersededById: true, validUntil: true, sentAt: true },
    }),
    prisma.activity.findMany({
      where: { agencyId: user.agencyId, entity: "QUOTE", entityId: q.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { name: true } } },
    }),
  ]);
  const today = localDateKey(new Date(), q.timezone);
  const status = effectiveStatus(q, today);
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const when = (d: Date) => formatDateTime(d, q.timezone);
  const notReady = canSend(q) ? readyToSend(q, today) : null;
  const latest = versions[0];

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow={
          <>
            Proposal {proposalRef(q)}
            {q.enquiry && (
              <>
                {" · "}
                <Link href={`/enquiries?view=all#${q.enquiry.id}`} className="hover:underline">
                  from {q.enquiry.name}&apos;s lead
                </Link>
              </>
            )}
          </>
        }
        title={q.title}
        subtitle={[q.contact?.name, q.lines[0]?.date ? formatDay(q.lines[0].date) : ""].filter(Boolean).join(" · ")}
        actions={
          <>
            {canEdit(q) && (
              <Link href={`/quotes/${q.id}/edit`} className="btn btn-primary">
                Edit
              </Link>
            )}
            {canNewVersion(q) && (
              <ActionForm action={newVersion.bind(null, q.id)}>
                <SubmitButton className="btn" pendingText="Copying…">
                  {status === "SENT" || status === "VIEWED" ? "Change (new version)" : "Duplicate as new version"}
                </SubmitButton>
              </ActionForm>
            )}
            {q.token && (
              <Link href={`/q/${q.token}`} className="btn" target="_blank">
                Customer&apos;s page
              </Link>
            )}
            {q.contact && (
              <Link href={`/contacts/${q.contact.id}`} className="btn">
                Customer
              </Link>
            )}
          </>
        }
      />

      {q.supersededBy && (
        <div className="mb-6 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm">
          Replaced by{" "}
          <Link href={`/quotes/${q.supersededBy.id}`} className="link">
            version {q.supersededBy.version}
          </Link>
          . This one&apos;s link now tells the customer it has been updated{q.supersededBy.token ? " and points to the new one" : ""}.
        </div>
      )}
      {status === "ACCEPTED" && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <div className="font-semibold">
            Signed and approved by {q.answerName} on {when(q.answeredAt!)}
          </div>
          {q.answerSignature && (
            <div className="mt-2 inline-block rounded-lg bg-white px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.answerSignature} alt={`Signature of ${q.answerName}`} className="h-12 max-w-[240px] object-contain" />
            </div>
          )}
          {q.answerNote && <p className="mt-1 whitespace-pre-line">“{q.answerNote}”</p>}
          <p className="mt-1 text-xs text-emerald-900/70">
            Recorded: {q.answerIp || "IP not known"} · {q.answerAgent.slice(0, 80) || "device not known"}
          </p>
          {q.event && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/events/${q.event.id}`} className="btn btn-sm btn-primary">
                Open the event
              </Link>
              <Link href={`/events/${q.event.id}#contract`} className="btn btn-sm">
                Send contract to sign
              </Link>
            </div>
          )}
        </div>
      )}
      {status === "DECLINED" && (
        <div className="mb-6 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm">
          <div className="font-semibold">Declined on {when(q.answeredAt!)}</div>
          <p className="mt-1 text-ink-600">{q.answerNote ? `“${q.answerNote}”` : "No reason given."}</p>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Customer pays"
          value={m(t.totalMinor)}
          hint={
            [t.bookingFeeMinor ? `incl. ${m(t.bookingFeeMinor)} booking fee` : "", t.vatMinor ? `VAT ${m(t.vatMinor)}` : ""].filter(Boolean).join(" · ") ||
            undefined
          }
        />
        <Stat label="Deposit" value={q.depositMinor ? m(q.depositMinor) : "None"} hint={q.depositDue ? `Due by ${formatDay(q.depositDue)}` : undefined} />
        <Stat label="Acts are paid" value={m(t.costMinor)} hint={t.costMissing ? "Some fees not set yet" : "Staff only"} />
        <Stat tone="dark" label="We make" value={m(t.agencyMinor)} hint={t.bookingFeeMinor ? `booking fee ${m(t.bookingFeeMinor)}` : undefined} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-3 text-[17px] font-semibold tracking-tight">What&apos;s proposed</h2>
            {q.lines.length === 0 ? (
              <p className="card card-pad text-sm text-ink-500">Nothing on it yet. Edit the proposal to add a line.</p>
            ) : (
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Act</th>
                      <th>When</th>
                      <th>Where</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Act&apos;s fee</th>
                      <th className="text-right">Makes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.lines.map((l, i) => {
                      const d = t.lines[i];
                      return (
                        <tr key={l.id}>
                          <td>
                            <div className="font-medium">{l.artist?.name ?? <span className="text-amber-800">Act to be confirmed</span>}</div>
                            {l.description && <div className="text-xs text-ink-500">{l.description}</div>}
                            {l.bookingId && (
                              <Link href={`/bookings/${l.bookingId}`} className="text-xs link">
                                Booking
                              </Link>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {l.date ? formatDay(l.date) : "No date"}
                            <div className="text-xs text-ink-500 tabular-nums">
                              {l.arriveTime ? `Arrive ${l.arriveTime} · ` : ""}
                              {l.startTime ? lineTimes(l) : "No time"}
                            </div>
                          </td>
                          <td>{linePlace(l) || "–"}</td>
                          <td className="text-right tabular-nums">
                            {m(d.grossMinor)}
                            {d.vatMinor > 0 && <div className="text-xs text-ink-500">+ VAT {l.vatPct}%</div>}
                          </td>
                          <td className="text-right text-ink-600 tabular-nums">{l.costMinor === null ? "Not set" : m(l.costMinor)}</td>
                          <td className="text-right tabular-nums">{m(d.agencyMinor - d.bookingFeeMinor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {(q.message || q.terms) && (
            <section className="card card-pad space-y-4 text-sm">
              {q.message && (
                <div>
                  <h3 className="section-title mb-1">Note to the customer</h3>
                  <p className="whitespace-pre-line text-ink-700">{q.message}</p>
                </div>
              )}
              {q.terms && (
                <div>
                  <h3 className="section-title mb-1">Terms</h3>
                  <p className="whitespace-pre-line text-ink-700">{q.terms}</p>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card card-pad">
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-title">Status</h2>
              <ProposalStatusBadge q={q} today={today} />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Line k="Valid until" v={q.validUntil ? formatDay(q.validUntil) : "No end date"} />
              <Line k="When accepted" v={q.tellActs ? "The acts are emailed" : "The acts aren't emailed: tell them yourself"} />
              {q.sentAt && <Line k="Sent" v={`${when(q.sentAt)}${q.sentTo ? ` to ${q.sentTo}` : ", as a link you sent yourself"}`} />}
              {q.viewedAt && <Line k="Opened" v={when(q.viewedAt)} />}
              {q.answeredAt && <Line k={status === "ACCEPTED" ? "Accepted" : "Answered"} v={when(q.answeredAt)} />}
              {q.withdrawnAt && <Line k="Withdrawn" v={when(q.withdrawnAt)} />}
              {status === "ACCEPTED" && (q.answerIp || q.answerAgent) && (
                <Line k="From" v={<span className="break-all text-xs text-ink-500">{[q.answerIp, q.answerAgent].filter(Boolean).join(" · ")}</span>} />
              )}
            </dl>

            {(canSend(q) || canResend(q, today)) && (
              <ActionForm action={sendProposalNow.bind(null, q.id)} className="mt-4 space-y-3 border-t border-ink-100 pt-4">
                <label className="block">
                  <span className="label">Send to</span>
                  <input name="to" type="email" required defaultValue={q.sentTo || q.contact?.email || ""} className="input" />
                </label>
                {notReady && <p className="text-xs text-amber-800">{notReady}</p>}
                <SubmitButton className={`btn w-full ${canSend(q) ? "btn-primary" : ""}`} pendingText="Sending…">
                  {canSend(q) ? "Send proposal" : "Send it again"}
                </SubmitButton>
                <p className="hint">The email uses your “Your proposal” wording from Settings, Notifications.</p>
              </ActionForm>
            )}
            {canSend(q) && (
              <ActionForm action={getProposalLink.bind(null, q.id)} className="mt-3">
                <SubmitButton className="btn w-full" pendingText="Making the link…">
                  Get a link to send yourself
                </SubmitButton>
                <p className="hint">For WhatsApp, a text or your own email. No email is sent from Gigsaw.</p>
              </ActionForm>
            )}
            {q.token && (
              <div className="mt-4 border-t border-ink-100 pt-4">
                <span className="label">Link to send the customer</span>
                <CopyField value={proposalUrl(q.token)} />
                <p className="hint">Anyone with this link can see the proposal and sign it, so send it only to the customer.</p>
              </div>
            )}
            {canWithdraw(q) && (
              <ServerForm action={withdrawProposal.bind(null, q.id)} className="mt-4">
                <ConfirmButton message="Withdraw this proposal? The customer's link will say it's been withdrawn and they can't accept it." className="btn w-full">
                  Withdraw
                </ConfirmButton>
              </ServerForm>
            )}
            {canEdit(q) && (
              <ServerForm action={deleteDraftProposal.bind(null, q.id)} className="mt-4">
                <ConfirmButton
                  message={q.version > 1 ? "Delete this draft? The version before it goes back to being the live one." : "Delete this draft proposal?"}
                  className="btn btn-danger w-full"
                >
                  Delete draft
                </ConfirmButton>
              </ServerForm>
            )}
          </section>

          {versions.length > 1 && (
            <section className="card card-pad">
              <h2 className="section-title mb-3">Versions</h2>
              <ul className="space-y-2 text-sm">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <Link href={`/quotes/${v.id}`} className={v.id === q.id ? "font-semibold" : "link"}>
                      Version {v.version}
                      {v.id === latest.id ? " (latest)" : ""}
                    </Link>
                    <ProposalStatusBadge q={v} today={today} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card card-pad">
            <h2 className="section-title mb-3">History</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing yet.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {activity.map((a) => (
                  <li key={a.id}>
                    {a.user?.name ?? (a.action.startsWith("customer") ? "" : "Someone")} {a.action}
                    {a.detail && <span className="text-ink-500"> · {a.detail}</span>}
                    <div className="font-mono text-[11px] text-ink-400">{when(a.createdAt)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
