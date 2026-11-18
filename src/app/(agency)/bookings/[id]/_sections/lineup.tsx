import { addStandIn, removeStandIn, setOffGig } from "@/actions/lineup";
import { ActionForm, SubmitButton } from "@/components/forms";
import { prisma } from "@/lib/db";
import { personName } from "@/lib/person-name";
import { actTree } from "@/lib/people";

/**
 * Who's playing this one gig: the act's people (each can be taken off, e.g. ill) and anyone standing in.
 * Changes reach their app, calendar and messages for this booking only (src/lib/lineup.ts).
 */
export async function LineupSection({ bookingId, agencyId, artistId, actName }: { bookingId: string; agencyId: string; artistId: string; actName: string }) {
  const parts = [...(await actTree(agencyId)).withParts([artistId])];
  const [members, changes, everyone] = await Promise.all([
    prisma.personAct.findMany({ where: { artistId: { in: parts } }, include: { person: true } }),
    prisma.bookingLineup.findMany({ where: { bookingId }, include: { person: true }, orderBy: { createdAt: "asc" } }),
    prisma.person.findMany({ where: { agencyId }, select: { id: true, firstName: true, surname: true, alias: true }, orderBy: { firstName: "asc" } }),
  ]);
  const people = [...new Map(members.map((m) => [m.personId, m.person])).values()].sort((a, b) => personName(a).localeCompare(personName(b)));
  const off = new Set(changes.filter((c) => c.change === "OUT").map((c) => c.personId));
  const standIns = changes.filter((c) => c.change === "IN");
  const taken = new Set([...people.map((p) => p.id), ...standIns.map((s) => s.personId)]);
  const choices = everyone.filter((p) => !taken.has(p.id));

  return (
    <section className="card card-pad" id="lineup">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="section-title">Line-up</h2>
        {(off.size > 0 || standIns.length > 0) && <span className="text-xs font-medium text-amber-700">Changed for this gig</span>}
      </div>
      <p className="mb-3 text-xs text-ink-500">Who&apos;s playing this gig. Changes here are for this booking only, not {actName}&apos;s other gigs.</p>
      <ul className="divide-y divide-ink-100 text-sm">
        {people.map((p) => {
          const isOff = off.has(p.id);
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className={isOff ? "text-ink-400 line-through" : "font-medium"}>{personName(p)}</span>
              <ActionForm action={setOffGig.bind(null, bookingId, p.id, !isOff)}>
                <SubmitButton className="btn btn-sm" pendingText="Saving…">
                  {isOff ? "Back on" : "Off this gig"}
                </SubmitButton>
              </ActionForm>
            </li>
          );
        })}
        {standIns.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium">{personName(s.person)}</span>
              <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Standing in</span>
            </span>
            <ActionForm action={removeStandIn.bind(null, bookingId, s.personId)}>
              <SubmitButton className="btn btn-sm" pendingText="Saving…">
                Remove
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
        {people.length === 0 && standIns.length === 0 && <li className="py-2 text-ink-500">No people on file for {actName} yet.</li>}
      </ul>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Add a stand-in</summary>
        <ActionForm action={addStandIn.bind(null, bookingId)} className="mt-3 space-y-3">
          {choices.length > 0 && (
            <label className="block">
              <span className="label">Someone already in Gigsaw</span>
              <select name="personId" className="input" defaultValue="">
                <option value="">Choose…</option>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personName(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-ink-500">{choices.length > 0 ? "Or someone new:" : "Someone new:"}</p>
          <div className="grid grid-cols-2 gap-2">
            <input name="firstName" placeholder="First name" className="input" />
            <input name="surname" placeholder="Surname" className="input" />
            <input name="email" type="email" placeholder="Email" className="input col-span-2" />
            <input name="phone" placeholder="Phone" className="input col-span-2" />
          </div>
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Adding…">
            Add stand-in
          </SubmitButton>
          <p className="text-xs text-ink-500">
            On a confirmed gig they&apos;re emailed the details straight away. They never see the act&apos;s fee: that stays with {actName}.
          </p>
        </ActionForm>
      </details>
    </section>
  );
}
