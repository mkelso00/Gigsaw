import type { Metadata } from "next";
import Link from "next/link";
import { addOwnAway, removeOwnAway } from "@/actions/availability";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { blockLength, formatRange } from "@/lib/availability";
import { getSettings, prisma } from "@/lib/db";
import { ownActIds } from "@/lib/people";
import { localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Dates you can't play" };
export const dynamic = "force-dynamic";

const field =
  "block h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-base text-white [color-scheme:dark] placeholder:text-ink-500 focus:border-volt-400/60 focus:outline-none";

/** The act app: block out days you can't play (holiday, other work) so the agency doesn't book you. */
export default async function AwayPage() {
  const user = await requireUser(["ARTIST"]);
  const own = await ownActIds(user);
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const [acts, blocks] = await Promise.all([
    prisma.artist.findMany({ where: { id: { in: own }, agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.artistUnavailability.findMany({
      where: { agencyId: user.agencyId, artistId: { in: own }, endDate: { gte: today } },
      orderBy: { startDate: "asc" },
      include: { artist: { select: { name: true } } },
    }),
  ]);
  const many = acts.length > 1;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/app" className="text-sm text-ink-400 hover:text-white">
          ← My bookings
        </Link>
        <h1 className="mt-3 text-[28px] leading-tight font-semibold tracking-tight">Dates you can&apos;t play</h1>
        <p className="mt-1 text-[15px] text-ink-400">Holidays, other work, anything. {settings.agencyName || "Your agency"} sees these before booking you.</p>
      </div>

      {!acts.length ? (
        <p className="text-sm text-ink-400">Your login isn&apos;t linked to an act yet. Ask your agent to check it.</p>
      ) : (
        <section className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
          <h2 className="mb-4 text-sm font-medium text-volt-400">Add dates</h2>
          <ActionForm action={addOwnAway} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-300">From</span>
                <input type="date" name="startDate" required min={today} className={field} />
              </label>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-300">To (optional)</span>
                <input type="date" name="endDate" min={today} className={field} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-300">Note (optional)</span>
              <input name="note" maxLength={200} placeholder="e.g. Holiday" className={field} />
            </label>
            {many && (
              <fieldset>
                <legend className="mb-1.5 block text-[13px] font-medium text-ink-300">For</legend>
                <div className="space-y-1.5">
                  {acts.map((a) => (
                    <label key={a.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[15px]">
                      <input type="checkbox" name="actId" value={a.id} defaultChecked className="h-4 w-4 accent-volt-400" />
                      {a.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <SubmitButton className="h-11 w-full rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50">
              Save
            </SubmitButton>
          </ActionForm>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-400">Coming up</h2>
        {blocks.length ? (
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="font-medium">
                    {formatRange(b.startDate, b.endDate)}
                    {blockLength(b) > 1 && <span className="font-normal text-ink-400"> · {blockLength(b)} days</span>}
                  </div>
                  <div className="truncate text-xs text-ink-400">
                    {[many ? b.artist.name : "", b.note, b.source === "AGENCY" ? "added by your agency" : ""].filter(Boolean).join(" · ") || "No note"}
                  </div>
                </div>
                <form action={removeOwnAway.bind(null, b.id)}>
                  <ConfirmButton
                    message={`Remove ${formatRange(b.startDate, b.endDate)}? You'll show as free again.`}
                    className="h-9 rounded-lg border border-white/10 px-3 text-sm text-ink-300 hover:bg-white/[0.06] hover:text-white"
                  >
                    Remove
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] bg-ink-900 p-6 text-center text-sm text-ink-400">Nothing blocked out. You show as free.</div>
        )}
      </section>
    </div>
  );
}
