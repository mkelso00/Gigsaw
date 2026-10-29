import type { Metadata } from "next";
import Link from "next/link";
import { approveApplication, declineApplication, makeJoinLink, removeJoinLink } from "@/actions/join";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, PageHeader } from "@/components/ui";
import { ACT_TYPE_LABELS, type JoinMember } from "@/lib/act-profile";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "New acts" };

/** The private join link to send new acts, and the acts waiting to be approved. */
export default async function ApplicationsPage() {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const isAdmin = user.role === "ADMIN";
  const [waiting, done] = await Promise.all([
    prisma.actApplication.findMany({ where: { agencyId: user.agencyId, status: "NEW" }, orderBy: { createdAt: "asc" } }),
    prisma.actApplication.findMany({ where: { agencyId: user.agencyId, status: { not: "NEW" } }, orderBy: { reviewedAt: "desc" }, take: 15 }),
  ]);
  const link = settings.joinToken ? `${appUrl()}/join/${settings.joinToken}` : null;
  const tz = settings.defaultTimezone;

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/artists" className="hover:underline">
            Acts
          </Link>
        }
        title="New acts"
        subtitle="Send new acts your private join link. They fill in their details, members, links and bank details, and choose a password. Approve them here and they can log in."
      />

      <section className="card card-pad mb-8 space-y-3">
        <h2 className="section-title">Your join link</h2>
        {link ? (
          <>
            <p className="text-sm text-ink-500">
              Send this to acts you want to take on, by text, WhatsApp or email. Anyone with the link can apply, so keep it private.
            </p>
            <div className="max-w-2xl">
              <CopyField value={link} />
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <form action={makeJoinLink}>
                  <button className="btn btn-sm">Make a new link</button>
                </form>
                <form action={removeJoinLink}>
                  <button className="btn btn-sm">Switch the link off</button>
                </form>
                <span className="self-center text-xs text-ink-500">A new link stops the old one working.</span>
              </div>
            )}
          </>
        ) : isAdmin ? (
          <form action={makeJoinLink}>
            <button className="btn btn-primary">Make a join link</button>
          </form>
        ) : (
          <p className="text-sm text-ink-500">There&apos;s no join link yet. An admin can make one here.</p>
        )}
      </section>

      <h2 className="section-title mb-3">Waiting for approval{waiting.length ? ` (${waiting.length})` : ""}</h2>
      {waiting.length === 0 ? (
        <Empty>No new acts waiting. They&apos;ll appear here when someone fills in the join link.</Empty>
      ) : (
        <div className="space-y-4">
          {waiting.map((a) => {
            const members = (a.members as JoinMember[]) ?? [];
            const rows: [string, React.ReactNode][] = [
              ["Contact", `${a.contactName} · ${a.email} · ${a.phone}`],
              ["Act", [ACT_TYPE_LABELS[a.actType as keyof typeof ACT_TYPE_LABELS] ?? a.actType, a.genre, a.town].filter(Boolean).join(" · ")],
              ["Members", members.length ? members.map((m) => [m.name, m.role, m.email, m.phone].filter(Boolean).join(", ")).join("\n") : ""],
              [
                "Video",
                a.videoUrl ? (
                  <a href={a.videoUrl} target="_blank" rel="noreferrer" className="link break-all">
                    {a.videoUrl}
                  </a>
                ) : (
                  ""
                ),
              ],
              [
                "Photo",
                a.photoUrl ? (
                  <a href={a.photoUrl} target="_blank" rel="noreferrer" className="link break-all">
                    {a.photoUrl}
                  </a>
                ) : (
                  ""
                ),
              ],
              [
                "Instagram",
                a.instagram ? (
                  <a href={`https://instagram.com/${a.instagram}`} target="_blank" rel="noreferrer" className="link">
                    @{a.instagram}
                  </a>
                ) : (
                  ""
                ),
              ],
              [
                "Website",
                a.website ? (
                  <a href={a.website} target="_blank" rel="noreferrer" className="link break-all">
                    {a.website}
                  </a>
                ) : (
                  ""
                ),
              ],
              ["Set list", a.setList],
              ["Usual fee", a.usualFeeMinor != null ? formatMoney(a.usualFeeMinor, settings.defaultCurrency) : ""],
              ["Bank", [a.bankAccountName, a.bankSortCode, a.bankAccountNumber].filter(Boolean).join(" · ")],
              ["VAT", a.vatRegistered ? `Registered${a.vatNumber ? `: ${a.vatNumber}` : ""}` : ""],
              ["Notes", a.notes],
            ];
            return (
              <article key={a.id} id={a.id} className="card card-pad scroll-mt-24">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold">{a.actName}</h3>
                  <span className="text-xs text-ink-500">Sent {formatDateTime(a.createdAt, tz)}</span>
                </div>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                  {rows
                    .filter(([, v]) => v !== "" && v !== null)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-ink-500">{k}</dt>
                        <dd className="whitespace-pre-line">{v}</dd>
                      </div>
                    ))}
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4">
                  <ActionForm action={approveApplication.bind(null, a.id)}>
                    <SubmitButton pendingText="Approving…">Approve and add {a.actName}</SubmitButton>
                  </ActionForm>
                  <form action={declineApplication.bind(null, a.id)}>
                    <button className="btn">Decline</button>
                  </form>
                  <span className="text-xs text-ink-500">
                    Approving adds the act and its members, and lets {a.contactName} log in. Declining sends nothing.
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <section className="mt-10">
          <h2 className="section-title mb-3">Recently dealt with</h2>
          <div className="card overflow-x-auto">
            <table className="table">
              <tbody>
                {done.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.artistId ? (
                        <Link href={`/artists/${a.artistId}`} className="hover:underline">
                          {a.actName}
                        </Link>
                      ) : (
                        a.actName
                      )}
                    </td>
                    <td>{a.contactName}</td>
                    <td>
                      <span className={`badge ${a.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-ink-100 text-ink-600"}`}>
                        {a.status === "APPROVED" ? "Approved" : "Declined"}
                      </span>
                    </td>
                    <td className="text-right text-ink-500">{a.reviewedAt ? formatDateTime(a.reviewedAt, tz) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
