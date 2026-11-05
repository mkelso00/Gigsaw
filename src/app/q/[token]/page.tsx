import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptQuoteAnswer, declineQuoteAnswer } from "@/actions/quotes";
import { PrintButton } from "@/components/client-bits";
import { SignaturePad } from "@/components/signature-pad";
import { ActionForm, SubmitButton } from "@/components/forms";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDay, readEnquiryConfig } from "@/lib/enquiries";
import { formatMoney } from "@/lib/money";
import { payUrl } from "@/lib/card-payments";
import { linePlace, markExpired, markViewed, quoteInclude } from "@/lib/quote-server";
import { answerProblem, effectiveStatus, lineTimes, looksLikeQuoteToken, quoteRef, quoteTotals, tokenOpens } from "@/lib/quotes";
import { formatDateTime, localDateKey } from "@/lib/time";

// The customer's quote: a private link (no login), made for their phone. It shows what's quoted,
// when and where, and what they pay (the acts' prices, the booking fee and VAT), never what the
// acts are paid. They sign and approve (typing their name and drawing a signature) or decline. Once answered, withdrawn or replaced
// by a newer version, the same link only shows where things stand.

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!looksLikeQuoteToken(token)) notFound();
  const q = await prisma.quote.findUnique({ where: { token }, include: quoteInclude });
  if (!q || q.agency.status !== "ACTIVE") notFound();
  const settings = q.agency.settings;
  const brand = settings?.agencyName || q.agency.name;
  const logo = readEnquiryConfig(settings?.enquiryForm).logoUrl;
  const contactLine = settings?.agencyEmail ? ` at ${settings.agencyEmail}` : "";

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-ink-50 px-4 py-8 text-ink-950 sm:py-12">
      <div className="mx-auto max-w-xl">
        <header className="mb-6 flex items-center gap-3">
          {logo ? (
            // A logo on the business's own site, of any size: an img keeps it simple.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={brand} className="h-10 max-w-[160px] object-contain" />
          ) : (
            <span className="text-[15px] font-semibold tracking-tight">{brand}</span>
          )}
        </header>
        {children}
        <p className="mt-8 text-center text-xs text-ink-400">
          This page is private to you. Questions? Reply to the email, or contact {brand}
          {contactLine}.
        </p>
      </div>
    </div>
  );

  if (!tokenOpens(q, token)) {
    return shell(
      <section className="card card-pad text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-2 text-ink-600">Please get in touch with {brand} if you need a copy of your proposal.</p>
      </section>,
    );
  }

  const today = localDateKey(new Date(), q.timezone);
  // Staff checking the link don't count as the customer opening it.
  const me = await currentUser();
  const isStaff = me?.agencyId === q.agencyId;
  if (!isStaff) {
    if (q.status === "SENT") await markViewed(q);
    if (effectiveStatus(q, today) === "EXPIRED" && q.status !== "EXPIRED") await markExpired(q);
  }

  // Replaced by a newer version: point to the newest one that's been sent.
  if (q.supersededById) {
    let next = await prisma.quote.findUnique({ where: { id: q.supersededById } });
    for (let i = 0; next?.supersededById && i < 20; i++) next = await prisma.quote.findUnique({ where: { id: next.supersededById } });
    return shell(
      <section className="card card-pad text-center">
        <div className="font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">Proposal {quoteRef(q)}</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This proposal has been updated</h1>
        {next?.token && next.status !== "DRAFT" ? (
          <>
            <p className="mt-2 text-ink-600">There&apos;s a newer version of your proposal for {q.title}.</p>
            <Link href={`/q/${next.token}`} className="btn btn-primary mt-5 h-12 w-full text-base">
              See the latest proposal
            </Link>
          </>
        ) : (
          <p className="mt-2 text-ink-600">
            {brand} is updating your proposal for {q.title}. You&apos;ll get the new one by email shortly.
          </p>
        )}
      </section>,
    );
  }

  const status = effectiveStatus(q, today);
  if (status === "DRAFT") notFound();
  const t = quoteTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const problem = answerProblem(q, today);
  const firstName = (q.contact?.name ?? "").split(" ")[0];
  const payLink =
    status === "ACCEPTED" && q.eventId && q.depositMinor > 0 ? await prisma.payLink.findFirst({ where: { eventId: q.eventId, kind: "DEPOSIT" } }) : null;

  return shell(
    <>
      <div className="mb-6">
        <div className="font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">Proposal {quoteRef(q)}</div>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">{q.title}</h1>
        {q.contact && <p className="mt-1 text-ink-600">For {q.contact.name}</p>}
      </div>

      {status === "ACCEPTED" && (
        <div role="status" className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-emerald-950">
          <div className="text-lg font-semibold">Thank you, you&apos;re booked</div>
          <p className="mt-1 text-sm">
            Signed and approved by {q.answerName} on {formatDateTime(q.answeredAt!, q.timezone)}. We&apos;ve emailed you a confirmation.
          </p>
          {q.answerSignature && (
            <div className="mt-3 inline-block rounded-lg bg-white px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.answerSignature} alt={`Signature of ${q.answerName}`} className="h-12 max-w-[240px] object-contain" />
            </div>
          )}
          <div className="no-print mt-3">
            <PrintButton />
          </div>
          {payLink && (
            <a href={payUrl(payLink.token)} className="btn btn-primary mt-4 h-12 w-full text-base">
              Pay your deposit of {m(q.depositMinor)}
            </a>
          )}
        </div>
      )}
      {status !== "ACCEPTED" && problem && (
        <div role="status" className="mb-6 rounded-2xl border border-ink-200 bg-white px-5 py-4">
          <div className="font-semibold">{problem}</div>
          <p className="mt-1 text-sm text-ink-600">
            {status === "EXPIRED"
              ? `It was valid until ${formatDay(q.validUntil!)}. Please get in touch with ${brand} if you'd still like to book.`
              : status === "DECLINED"
                ? `Thanks for letting us know. If you change your mind, please get in touch with ${brand}.`
                : `Please get in touch with ${brand} if you have any questions.`}
          </p>
        </div>
      )}

      {q.message && status !== "ACCEPTED" && (
        <section className="card card-pad mb-4 text-[15px] whitespace-pre-line text-ink-800">
          {firstName && <p className="mb-2">Hi {firstName},</p>}
          {q.message}
        </section>
      )}

      <section className="card mb-4 overflow-hidden">
        <ul className="divide-y divide-ink-100">
          {q.lines.map((l, i) => (
            <li key={l.id} className="flex items-start gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                {l.description && <div className="font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">{l.description}</div>}
                <div className="mt-0.5 font-semibold">{l.artist?.name ?? "Act to be confirmed"}</div>
                <div className="mt-1 text-sm text-ink-600">
                  {formatDay(l.date)} · {lineTimes(l)}
                </div>
                {linePlace(l) && <div className="text-sm text-ink-600">{linePlace(l)}</div>}
              </div>
              <div className="shrink-0 text-right font-medium tabular-nums">{m(t.lines[i].grossMinor)}</div>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-ink-100 bg-ink-50/60 px-5 py-4 text-sm tabular-nums">
          {t.bookingFeeMinor > 0 && <Row k="Booking fee" v={m(t.bookingFeeMinor)} />}
          {t.vatMinor > 0 && <Row k="VAT" v={m(t.vatMinor)} />}
          <div className="flex items-baseline justify-between gap-3 pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd data-testid="customer-total">{m(t.totalMinor)}</dd>
          </div>
          {q.depositMinor > 0 && <Row k={`Deposit${q.depositDue ? `, due by ${formatDay(q.depositDue)}` : ""}`} v={m(q.depositMinor)} />}
          {q.depositMinor > 0 && <Row k="Balance" v={m(t.totalMinor - q.depositMinor)} />}
        </dl>
      </section>

      {q.validUntil && status !== "ACCEPTED" && status !== "DECLINED" && (
        <p className="mb-4 text-sm text-ink-600">
          {status === "EXPIRED" ? "This proposal was valid until" : "This proposal is valid until"} {formatDay(q.validUntil)}.
        </p>
      )}

      {q.terms && (
        <details className="card mb-6" open={!problem}>
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Terms</summary>
          <p className="border-t border-ink-100 px-5 py-4 text-sm whitespace-pre-line text-ink-700">{q.terms}</p>
        </details>
      )}

      {!problem && (
        <>
          <ActionForm action={acceptQuoteAnswer.bind(null, token)} className="card card-pad">
            <h2 className="text-xl font-semibold tracking-tight">Sign and approve your proposal</h2>
            <p className="mt-1 text-sm text-ink-600">Signing books everything above with {brand}.</p>
            <label className="mt-5 block">
              <span className="label">Your full name</span>
              <input name="name" required autoComplete="name" maxLength={120} defaultValue={q.contact?.name ?? ""} className="input h-12 text-base" />
            </label>
            <div className="mt-4">
              <span className="label">Your signature</span>
              <SignaturePad name="signature" />
            </div>
            <label className="mt-4 block">
              <span className="label">A message for us (optional)</span>
              <textarea name="note" rows={3} maxLength={2000} className="input text-base" />
            </label>
            <label className="mt-4 flex items-start gap-3 rounded-xl bg-ink-50 p-4 text-[15px]">
              <input type="checkbox" name="agree" required className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                I accept this proposal{q.terms ? " and its terms" : ""}, and I&apos;d like to book it with {brand}
                {q.depositMinor > 0 ? `. I'll pay the deposit of ${m(q.depositMinor)}${q.depositDue ? ` by ${formatDay(q.depositDue)}` : ""}` : ""}.
              </span>
            </label>
            <SubmitButton className="btn btn-primary mt-5 h-12 w-full text-base" pendingText="Booking…">
              Sign and approve
            </SubmitButton>
            <p className="mt-3 text-center text-xs text-ink-500">
              We record your name, signature, the time, your IP address and device, so there&apos;s a clear record.
            </p>
          </ActionForm>

          <details className="mt-4">
            <summary className="cursor-pointer px-1 py-2 text-center text-sm text-ink-600 underline-offset-2 hover:underline">
              No thanks, decline this proposal
            </summary>
            <ActionForm action={declineQuoteAnswer.bind(null, token)} className="card card-pad mt-2">
              <label className="block">
                <span className="label">Can you tell us why? (optional)</span>
                <textarea name="reason" rows={3} maxLength={2000} className="input text-base" />
              </label>
              <SubmitButton className="btn mt-4 h-12 w-full text-base" pendingText="Sending…">
                Decline the proposal
              </SubmitButton>
            </ActionForm>
          </details>
        </>
      )}
    </>,
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-600">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
