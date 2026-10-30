import type { Metadata } from "next";
import Link from "next/link";
import { connectStripe, disconnectStripe } from "@/actions/card-payments";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { refreshAccount } from "@/lib/card-payments";
import { prisma } from "@/lib/db";
import { stripeConfigured, StripeError } from "@/lib/stripe";

export const metadata: Metadata = { title: "Card payments" };
export const dynamic = "force-dynamic";

// Settings > Card payments: connect the agency's own Stripe account, so venues and customers can
// pay deposits and invoices by card from a link. The money goes straight to the agency.

export default async function CardPaymentSettings({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  let agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  let problem = sp.error ? "Stripe couldn't open the setup just now. Please try again." : "";
  // Until the account can take payments, check with Stripe each time this page is opened.
  if (agency.stripeAccountId && stripeConfigured() && (!agency.stripeChargesEnabled || sp.connected)) {
    try {
      await refreshAccount(agency.stripeAccountId);
      agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
    } catch (e) {
      problem = e instanceof StripeError ? `Stripe said: ${e.message}` : "We couldn't reach Stripe just now.";
    }
  }
  const connected = !!agency.stripeAccountId;
  const ready = connected && agency.stripeChargesEnabled;

  return (
    <SettingsPage title="Card payments">
      {problem && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{problem}</div>}
      {sp.connected && ready && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Stripe is connected. You can now send payment links from any booking or wedding.
        </div>
      )}

      <SettingsSection
        title="Stripe"
        description="Venues and customers pay deposits and invoices by card from a link you send them. The money goes straight into your own Stripe account. Gigsaw takes nothing; Stripe charges its usual card fees."
      >
        <SettingsCard>
          {!stripeConfigured() ? (
            <SettingsRow icon="billing" title="Not available yet" sub="Card payments aren't switched on for Gigsaw yet. Please check back soon." />
          ) : !connected ? (
            <SettingsRow
              icon="billing"
              title="Not connected"
              sub="Connect a Stripe account to take card payments. If you don't have one, Stripe makes it as part of the set-up: about five minutes with your bank details to hand."
              right={
                <ActionForm action={connectStripe}>
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Opening Stripe…">
                    Connect Stripe
                  </SubmitButton>
                </ActionForm>
              }
            />
          ) : (
            <>
              <SettingsRow
                icon="billing"
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Stripe account
                    <Badge tone={ready ? "green" : "amber"}>
                      {ready ? "Connected" : agency.stripeDetailsDone ? "Waiting for Stripe" : "Set-up not finished"}
                    </Badge>
                  </span>
                }
                sub={
                  ready
                    ? "Card payments are on. Payouts, refunds and receipts are in your Stripe dashboard."
                    : agency.stripeDetailsDone
                      ? "Stripe is checking your details. This page updates once it's done."
                      : "Finish setting up your account with Stripe to start taking payments."
                }
                right={
                  ready ? (
                    <a href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer" className="btn btn-sm">
                      Open Stripe
                    </a>
                  ) : (
                    <ActionForm action={connectStripe}>
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="Opening Stripe…">
                        {agency.stripeDetailsDone ? "Check details" : "Continue set-up"}
                      </SubmitButton>
                    </ActionForm>
                  )
                }
              />
              <SettingsRow icon="lock" title="Account ID" sub={<span className="font-mono text-xs break-all">{agency.stripeAccountId}</span>} />
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="How it works">
        <SettingsCard>
          <SettingsRow
            icon="bookings"
            title="Send a link"
            sub="On a booking or a wedding, make a payment link for the deposit or the balance, then copy it or email it from Gigsaw."
          />
          <SettingsRow
            icon="payments"
            title="They pay by card"
            sub="The page shows what's due, VAT and booking fee included, just as on your invoice. Acts never see it."
          />
          <SettingsRow
            icon="bell"
            title="It's logged for you"
            sub="The payment is recorded on the booking, the deposit is marked as paid and the lead agent gets an email."
          />
          <SettingsRow
            icon="mail"
            title="Payment link email"
            sub="Change the wording of the email in Notifications."
            href="/settings/notifications/customers/pay_link"
          />
        </SettingsCard>
      </SettingsSection>

      {connected && (
        <SettingsSection
          title="Disconnect"
          description="Stops card payments through Gigsaw. Your Stripe account and its money stay yours, and payments already made stay logged."
        >
          <SettingsCard pad>
            <form action={disconnectStripe}>
              <ConfirmButton message="Disconnect Stripe? Payment links you've sent will stop taking cards." className="btn btn-danger">
                Disconnect Stripe
              </ConfirmButton>
            </form>
          </SettingsCard>
        </SettingsSection>
      )}
      <p className="text-sm text-ink-500">
        Questions about card payments?{" "}
        <Link href="mailto:hello@gigsaw.live" className="link">
          Get in touch
        </Link>
        .
      </p>
    </SettingsPage>
  );
}
