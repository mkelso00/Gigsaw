import Link from "next/link";
import { revealNiNumber, setActLead, sortActPayDetails, updatePersonPay } from "@/actions/act-details";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StaffPayFields } from "@/components/pay-details";
import { maskNi, missingDetails, type PayFields } from "@/lib/act-details";
import type { AgencyUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasBank, leadOf, needsLead, payeeOf, peopleOf } from "@/lib/payee";
import { loadPayActs, PERSON_PAY_SELECT } from "@/lib/payee-server";
import { personName } from "@/lib/person-name";
import { formatDate } from "@/lib/time";

// The Pay details cards on the staff act and person pages. Any member of staff sees whether details are in
// and who an act's invoices go to; only admins see the details themselves (bank, address, NI number masked
// until Show). Who the payee is: src/lib/payee.ts.

type Holder = PayFields & { detailsCompletedAt: Date | null };

async function timeZone(agencyId: string) {
  const settings = await prisma.settings.findUnique({ where: { agencyId }, select: { defaultTimezone: true } });
  return settings?.defaultTimezone ?? "Europe/London";
}

/** "Details complete since …" or "Details missing: still needed …". */
function DetailsStatus({ h, tz, waiting }: { h: Holder; tz: string; waiting: string }) {
  const missing = missingDetails(h);
  const complete = !!h.detailsCompletedAt && !missing.length;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      {complete ? (
        <>
          <span className="badge bg-emerald-50 text-emerald-800">Details complete</span>
          <span className="text-ink-500">since {formatDate(h.detailsCompletedAt!, tz)}</span>
        </>
      ) : (
        <>
          <span className="badge bg-amber-50 text-amber-800">Details missing</span>
          <span className="text-ink-500">{missing.length ? `Still needed: ${missing.join(", ")}.` : waiting}</span>
        </>
      )}
    </p>
  );
}

/** The details themselves, for admins only. */
function DetailsList({ h, kind, id }: { h: Holder; kind: "act" | "person"; id: string }) {
  return (
    <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-ink-500">Bank</dt>
      <dd className="tabular-nums">
        {hasBank(h) ? (
          <>
            <span className="block">{h.bankAccountName}</span>
            <span className="block">{h.bankSortCode}</span>
            <span className="block">{h.bankAccountNumber}</span>
          </>
        ) : (
          <span className="text-ink-400">Not given</span>
        )}
        {h.vatRegistered && <span className="block text-xs text-ink-500">VAT registered{h.vatNumber ? `: ${h.vatNumber}` : ""}</span>}
      </dd>
      <dt className="text-ink-500">Address</dt>
      <dd className="whitespace-pre-line">{h.address || <span className="text-ink-400">Not given</span>}</dd>
      <dt className="text-ink-500">NI number</dt>
      <dd>
        {h.niNumber ? (
          <ActionForm
            action={revealNiNumber.bind(null, kind, id)}
            className="flex flex-wrap items-center gap-x-3 [&_[role=status]]:mb-1 [&_[role=status]]:w-full"
          >
            <span className="tabular-nums">{maskNi(h.niNumber)}</span>
            <SubmitButton className="link text-sm" pendingText="…">
              Show
            </SubmitButton>
          </ActionForm>
        ) : (
          <span className="text-ink-400">Not given</span>
        )}
      </dd>
    </dl>
  );
}

const ADMINS_ONLY = "Only admins can see bank details, address and National Insurance number.";

/**
 * The Pay details card on the staff act page: who the act's invoices go to (with "Invoices go to" to choose
 * a band's lead), whether that payee's details are in, and the details for admins.
 */
export async function PayDetailsCard({ artistId, user }: { artistId: string; user: AgencyUser }) {
  const [act, login, tz] = await Promise.all([
    loadPayActs(user.agencyId, [artistId]).then((m) => m.get(artistId)),
    prisma.user.findUnique({ where: { artistId }, select: { email: true, passwordHash: true } }),
    timeZone(user.agencyId),
  ]);
  if (!act) return null;
  const isAdmin = user.role === "ADMIN";
  const people = peopleOf(act);
  const lead = leadOf(act);
  const payee = payeeOf(act);
  const choose = needsLead(act);
  // Details from before people had their own, still on the act (src/lib/payee.ts): staff sort them out.
  const oldOnAct = people.length > 0 && hasBank(act);
  // Where the act is with setting up their own login (src/lib/act-claim.ts), when it's the act's own details.
  const loginLine =
    payee?.kind !== "act" || people.length
      ? null
      : !login
        ? act.email
          ? `No app login yet. They can make one with ${act.email} from the sign-in page: First time? Set up your login.`
          : "No app login yet. Add their email so they can make one from the sign-in page."
        : login.passwordHash
          ? null
          : `Set-up link sent to ${login.email}. They haven't made a password yet.`;
  return (
    <section className="card card-pad" id="pay-details" data-testid="pay-details">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">Pay details</h2>
        {isAdmin && payee?.kind === "person" && (
          <Link href={`/people/${payee.person.id}#pay`} className="link text-sm">
            Edit
          </Link>
        )}
        {isAdmin && payee?.kind === "act" && (
          <Link href={`/artists/${act.id}/edit`} className="link text-sm">
            Edit
          </Link>
        )}
      </div>

      {people.length > 0 && (
        <div className="mt-2">
          {choose && <p className="mb-2 text-sm font-medium text-amber-700">Choose who the band&apos;s invoices go to.</p>}
          {people.length > 1 || act.leadPersonId ? (
            <ActionForm action={setActLead.bind(null, act.id)} className="flex flex-wrap items-end gap-2 [&_[role=status]]:w-full">
              <label className="min-w-0 flex-1">
                <span className="label">Invoices go to</span>
                <select name="leadPersonId" defaultValue={lead?.id ?? ""} className="input">
                  <option value="">{choose ? "Choose someone" : "Nobody chosen"}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className="btn">Save</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm">
              <span className="text-ink-500">Invoices go to</span> {lead ? personName(lead) : "nobody yet"}
            </p>
          )}
          <p className="hint">The invoices are made out to them and paid into their bank account. Everyone in the act still gets the booking messages.</p>
        </div>
      )}

      {payee?.kind === "person" && (
        <>
          <DetailsStatus h={payee.person} tz={tz} waiting={`Waiting for ${personName(payee.person)} to check them.`} />
          {!payee.person.detailsCompletedAt && (
            <p className="mt-2 text-sm text-ink-500">They add these themselves from their own login, or an admin can on their page.</p>
          )}
          {isAdmin ? <DetailsList h={payee.person} kind="person" id={payee.person.id} /> : <p className="mt-3 text-sm text-ink-500">{ADMINS_ONLY}</p>}
        </>
      )}
      {payee?.kind === "act" && (
        <>
          {oldOnAct && (
            <p className="mt-2 text-sm text-ink-500">Paid from the act&apos;s own details from before{lead ? ` until ${personName(lead)} adds theirs` : ""}.</p>
          )}
          <DetailsStatus h={act} tz={tz} waiting="Waiting for the act to check them." />
          {loginLine && <p className="mt-2 text-sm text-ink-500">{loginLine}</p>}
          {isAdmin ? <DetailsList h={act} kind="act" id={act.id} /> : <p className="mt-3 text-sm text-ink-500">{ADMINS_ONLY}</p>}
        </>
      )}

      {oldOnAct && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="old-pay-details">
          <p className="font-medium">The act still has its own pay details from before people had their own.</p>
          <p className="mt-1">
            {lead
              ? hasBank(lead)
                ? `${personName(lead)} has added their own, so the act's aren't used any more. Clear them to keep one copy.`
                : `Move them to ${personName(lead)} if they're theirs, or clear them and ask ${personName(lead)} to add their own.`
              : "Choose who the band's invoices go to first, then move them to that person or clear them."}
          </p>
          {isAdmin ? (
            <ActionForm action={sortActPayDetails.bind(null, act.id)} className="mt-2 flex flex-wrap gap-2 [&_[role=status]]:w-full">
              {lead && !hasBank(lead) && (
                <SubmitButton name="do" value="move" className="btn btn-sm" pendingText="Moving…">
                  Move them to {personName(lead)}
                </SubmitButton>
              )}
              <SubmitButton name="do" value="clear" className="btn btn-sm" pendingText="Clearing…">
                Clear the act&apos;s details
              </SubmitButton>
            </ActionForm>
          ) : (
            <p className="mt-1 text-xs">An admin can move or clear them.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** The Pay details card on a person's page: their own details, with the form to change them for admins. */
export async function PersonPayCard({ personId, user }: { personId: string; user: AgencyUser }) {
  const [p, leads, tz] = await Promise.all([
    prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId }, select: { ...PERSON_PAY_SELECT, _count: { select: { acts: true } } } }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId, leadPersonId: personId }, select: { id: true, name: true } }),
    timeZone(user.agencyId),
  ]);
  if (!p || (!p._count.acts && !hasBank(p) && !p.detailsCompletedAt)) return null;
  const isAdmin = user.role === "ADMIN";
  return (
    <section className="card card-pad scroll-mt-20" id="pay" data-testid="person-pay-details">
      <h2 className="section-title">Pay details</h2>
      <DetailsStatus h={p} tz={tz} waiting="Waiting for them to check them." />
      {leads.length > 0 && (
        <p className="mt-2 text-sm text-ink-500">
          Invoices for{" "}
          {leads.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link href={`/artists/${a.id}`} className="link">
                {a.name}
              </Link>
            </span>
          ))}{" "}
          go to them.
        </p>
      )}
      {isAdmin ? (
        <>
          <DetailsList h={p} kind="person" id={p.id} />
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium">Change their pay details</summary>
            <ActionForm action={updatePersonPay.bind(null, p.id)} className="mt-3 space-y-4">
              <StaffPayFields artist={p} withAddress={false} intro="Their address is in the form. Only admins and they can see these." />
              <SubmitButton>Save pay details</SubmitButton>
            </ActionForm>
          </details>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-500">{ADMINS_ONLY}</p>
      )}
    </section>
  );
}
