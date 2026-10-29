import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../legal";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Gigsaw collects, uses and looks after personal information. Draft.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="This page explains what personal information Gigsaw holds, why, who it's shared with and what your rights are under UK data protection law (the UK GDPR and the Data Protection Act 2018)."
    >
      <h2>Who we are</h2>
      <p>
        Gigsaw is booking software for music agencies, run from the UK at gigsaw.live by [company name, registered number and address]. You can contact us about
        privacy at [privacy contact email].
      </p>

      <h2>Two kinds of information</h2>
      <p>
        <strong>Information about agency accounts.</strong> When an agency signs up, we hold the names, email addresses, mobile numbers and passwords of the
        people who sign in, plus the agency&apos;s plan and billing details. For this, Gigsaw is the controller.
      </p>
      <p>
        <strong>Information an agency puts into Gigsaw.</strong> Agencies add their acts, venue staff, customers and other contacts, with their bookings, fees,
        notes and messages. For this, the agency is the controller and Gigsaw is its processor: we only use it to run the service for that agency. If
        you&apos;re an act, a venue manager or a customer and have a question about your information, please ask the agency first. We&apos;ll help them answer.
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Contact details</strong> such as names, email addresses and phone numbers, so agencies can send offers, confirmations, reminders and changes.
        </li>
        <li>
          <strong>Booking and money details</strong> such as dates, venues, times, fees and payments, so agencies can run their bookings and send statements and
          invoices.
        </li>
        <li>
          <strong>Bank details</strong> that new acts choose to give when they apply to join an agency, so that agency can pay them. Only the agency can see
          them.
        </li>
        <li>
          <strong>Location at check-in.</strong> When an act taps I&apos;m on the way, I&apos;ve arrived or I&apos;ve left the venue, their phone can share its
          location so Gigsaw can check the distance to the venue. We don&apos;t track location at any other time, and the act&apos;s phone always asks first.
        </li>
        <li>
          <strong>Phone notification settings</strong>, if an act turns on reminders, so we can send them to that phone.
        </li>
        <li>
          <strong>A record of messages sent</strong> and an activity log on bookings, so agencies can see what was sent and who changed what.
        </li>
      </ul>
      <p>
        Our lawful bases are: performing our contract with the agency; the agency&apos;s legitimate interest in running its bookings; and, for phone
        notifications and location at check-in, the person&apos;s choice to turn them on. [Lawful bases to be confirmed.]
      </p>

      <h2>Who we share it with</h2>
      <p>We don&apos;t sell personal information, and we don&apos;t use it for advertising. We use a small number of suppliers to run Gigsaw:</p>
      <ul>
        <li>Hosting and database: Railway. [Hosting region to be confirmed.]</li>
        <li>Email: Resend.</li>
        <li>Text messages: Twilio.</li>
        <li>Phone notifications: the push service built into the person&apos;s phone or browser, for example Apple or Google.</li>
        <li>Payments for Gigsaw plans: [payment provider to be confirmed].</li>
      </ul>
      <p>
        Some of these suppliers may handle information outside the UK. Where they do, we rely on the safeguards UK law requires, such as the UK&apos;s
        international data transfer agreement or adequacy regulations. [Details to be confirmed.]
      </p>

      <h2>Cookies</h2>
      <p>
        Gigsaw uses two cookies. One keeps you signed in. The other remembers whether you chose light or dark mode. Both are needed for the site to work as you
        expect, so we don&apos;t ask for consent for them. We don&apos;t use advertising or tracking cookies.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep an agency&apos;s information while it has a Gigsaw account. When an account is closed, we delete it within [period to be confirmed], except
        anything we must keep for tax or legal reasons. Agencies can export their bookings, arrivals and reports to CSV at any time.
      </p>

      <h2>Your rights</h2>
      <p>Under UK data protection law you can ask to:</p>
      <ul>
        <li>see the personal information held about you</li>
        <li>have it corrected if it&apos;s wrong</li>
        <li>have it deleted</li>
        <li>restrict or object to how it&apos;s used</li>
        <li>get a copy in a format you can take elsewhere</li>
        <li>withdraw your consent where we rely on it, such as phone notifications</li>
      </ul>
      <p>
        Contact us at [privacy contact email]. If you&apos;re unhappy with how we&apos;ve handled your information, you can complain to the Information
        Commissioner&apos;s Office at{" "}
        <a href="https://ico.org.uk" className="link" rel="noopener noreferrer" target="_blank">
          ico.org.uk
        </a>
        .
      </p>

      <h2>Changes</h2>
      <p>
        If we change this page in a way that matters, we&apos;ll tell agency admins by email. See also our{" "}
        <Link href="/terms" className="link">
          terms
        </Link>
        .
      </p>
      <p className="text-sm text-ink-500">Last updated: [date to be added at launch].</p>
    </LegalPage>
  );
}
