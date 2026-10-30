import type { Metadata } from "next";
import Link from "next/link";
import { loadCatalogue } from "@/lib/plan-store";
import { LegalPage } from "../legal";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Gigsaw, in plain English. Draft.",
};

export const revalidate = 300;

export default async function TermsPage() {
  const { trialDays } = await loadCatalogue();
  return (
    <LegalPage
      title="Terms"
      intro="These are the terms for using Gigsaw. We've kept them short and plain. By signing up for an agency account, you agree to them on behalf of your agency."
    >
      <h2>Who we are</h2>
      <p>Gigsaw is run from the UK at gigsaw.live by [company name, registered number and address]. Contact us at [contact email].</p>

      <h2>Your account</h2>
      <ul>
        <li>Gigsaw is for businesses, such as music agencies. It isn&apos;t sold to consumers.</li>
        <li>Keep your sign-in details safe. You&apos;re responsible for what happens under your agency&apos;s logins.</li>
        <li>Your admins decide who on your team can sign in, and which acts get their own login.</li>
      </ul>

      <h2>Free trial</h2>
      <p>
        You can try Gigsaw free for {trialDays} days. To keep using it after that, choose a plan. [What happens to trial data if no plan is chosen to be
        confirmed.]
      </p>

      <h2>Plans and paying</h2>
      <ul>
        <li>
          Plans are priced by the number of bookings in a month, plus any internal users over the number your plan includes. Prices are on the{" "}
          <Link href="/pricing" className="link">
            pricing page
          </Link>
          .
        </li>
        <li>The pricing page explains what counts as a booking. If you go over your plan, nothing stops working: we&apos;ll suggest the plan that fits.</li>
        <li>Monthly plans are paid monthly. Yearly plans are paid for the year up front.</li>
        <li>You can change plan or cancel at any time. [Refunds and the timing of changes to be confirmed.]</li>
        <li>If we change our prices, we&apos;ll give you at least [notice period] notice by email.</li>
        <li>[Whether prices include VAT to be confirmed.]</li>
      </ul>

      <h2>Your data</h2>
      <ul>
        <li>
          Your bookings, acts, venues and contacts belong to you. We only use them to run Gigsaw for you, as set out in our{" "}
          <Link href="/privacy" className="link">
            privacy page
          </Link>
          .
        </li>
        <li>You can export your bookings, arrivals and reports to CSV at any time.</li>
        <li>
          You&apos;re responsible for having the right to add people&apos;s details to Gigsaw and for the messages your agency sends through it, including texts
          and emails to your acts and customers.
        </li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Please don&apos;t use Gigsaw to send spam, to break the law, or to try to get at another agency&apos;s data. Don&apos;t try to break, overload or copy
        the service. If you do, we may suspend your account. We&apos;ll keep your data while we sort it out.
      </p>

      <h2>Keeping Gigsaw running</h2>
      <p>
        We work hard to keep Gigsaw available and your data safe, but we can&apos;t promise it will never go down. We may change or improve features over time.
        If we remove something important, we&apos;ll tell you first.
      </p>
      <p>
        Gigsaw helps you keep track of bookings, arrivals and money, but it doesn&apos;t replace your own judgement. For example, a check-in shows where a phone
        was, not who was holding it.
      </p>

      <h2>Liability</h2>
      <p>[Limits of liability to be written and checked by a lawyer.] Nothing in these terms limits liability that can&apos;t be limited by law.</p>

      <h2>Ending your account</h2>
      <p>
        You can cancel at any time. We can close an account with [notice period] notice, or straight away if these terms are seriously broken. Either way,
        you&apos;ll have the chance to export your data first.
      </p>

      <h2>Changes and law</h2>
      <p>
        If we change these terms in a way that matters, we&apos;ll email your agency&apos;s admins before the change takes effect. These terms are governed by
        the law of [England and Wales, to be confirmed].
      </p>
      <p className="text-sm text-ink-500">Last updated: [date to be added at launch].</p>
    </LegalPage>
  );
}
