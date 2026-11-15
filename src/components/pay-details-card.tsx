import Link from "next/link";
import { revealNiNumber } from "@/actions/act-details";
import { ActionForm, SubmitButton } from "@/components/forms";
import { maskNi, missingDetails } from "@/lib/act-details";
import type { AgencyUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

/**
 * The Pay details card on the staff act page: whether the act's details are complete (any member
 * of staff), and the details themselves (admins only, with the NI number masked until Show).
 */
export async function PayDetailsCard({ artistId, user }: { artistId: string; user: AgencyUser }) {
  const a = await prisma.artist.findFirst({
    where: { id: artistId, agencyId: user.agencyId },
    select: {
      id: true,
      email: true,
      detailsCompletedAt: true,
      bankAccountName: true,
      bankSortCode: true,
      bankAccountNumber: true,
      address: true,
      niNumber: true,
      phone: true,
      vatRegistered: true,
      vatNumber: true,
      login: { select: { email: true, passwordHash: true } },
    },
  });
  if (!a) return null;
  const isAdmin = user.role === "ADMIN";
  const missing = missingDetails(a);
  const complete = !!a.detailsCompletedAt && !missing.length;
  const settings = await prisma.settings.findUnique({ where: { agencyId: user.agencyId }, select: { defaultTimezone: true } });
  const tz = settings?.defaultTimezone ?? "Europe/London";
  // Where the act is with setting up their own login (src/lib/act-claim.ts).
  const loginLine = !a.login
    ? a.email
      ? `No app login yet. They can make one with ${a.email} from the sign-in page: First time? Set up your login.`
      : "No app login yet. Add their email so they can make one from the sign-in page."
    : a.login.passwordHash
      ? null
      : `Set-up link sent to ${a.login.email}. They haven't made a password yet.`;
  return (
    <section className="card card-pad" id="pay-details" data-testid="pay-details">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">Pay details</h2>
        {isAdmin && (
          <Link href={`/artists/${a.id}/edit`} className="link text-sm">
            Edit
          </Link>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {complete ? (
          <>
            <span className="badge bg-emerald-50 text-emerald-800">Details complete</span>
            <span className="text-ink-500">since {formatDate(a.detailsCompletedAt!, tz)}</span>
          </>
        ) : (
          <>
            <span className="badge bg-amber-50 text-amber-800">Details missing</span>
            <span className="text-ink-500">{missing.length ? `Still needed: ${missing.join(", ")}.` : "Waiting for the act to check them."}</span>
          </>
        )}
      </p>
      {loginLine && <p className="mt-2 text-sm text-ink-500">{loginLine}</p>}
      {isAdmin ? (
        <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-ink-500">Bank</dt>
          <dd className="tabular-nums">
            {a.bankAccountNumber || a.bankSortCode || a.bankAccountName ? (
              <>
                <span className="block">{a.bankAccountName}</span>
                <span className="block">{a.bankSortCode}</span>
                <span className="block">{a.bankAccountNumber}</span>
              </>
            ) : (
              <span className="text-ink-400">Not given</span>
            )}
            {a.vatRegistered && <span className="block text-xs text-ink-500">VAT registered{a.vatNumber ? `: ${a.vatNumber}` : ""}</span>}
          </dd>
          <dt className="text-ink-500">Address</dt>
          <dd className="whitespace-pre-line">{a.address || <span className="text-ink-400">Not given</span>}</dd>
          <dt className="text-ink-500">NI number</dt>
          <dd>
            {a.niNumber ? (
              <ActionForm
                action={revealNiNumber.bind(null, a.id)}
                className="flex flex-wrap items-center gap-x-3 [&_[role=status]]:mb-1 [&_[role=status]]:w-full"
              >
                <span className="tabular-nums">{maskNi(a.niNumber)}</span>
                <SubmitButton className="link text-sm" pendingText="…">
                  Show
                </SubmitButton>
              </ActionForm>
            ) : (
              <span className="text-ink-400">Not given</span>
            )}
          </dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-ink-500">Only admins can see bank details, address and National Insurance number.</p>
      )}
    </section>
  );
}
