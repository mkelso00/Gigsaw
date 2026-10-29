import type { Metadata } from "next";
import { MessageList } from "@/components/message-list";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emailConfigured, smsConfigured } from "@/lib/messaging";

export const metadata: Metadata = { title: "Outbox" };
export const dynamic = "force-dynamic";

export default async function OwnerMessagesPage() {
  await requireOwner();
  const messages = await prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { agency: { select: { name: true } } } });
  const status = (on: boolean, what: string, keys: string) => (
    <div className="card flex-1 p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-ink-300"}`} />
        {what} {on ? "connected" : "not set up"}
      </div>
      {!on && <p className="mt-2 text-xs text-ink-500">Add {keys} in Railway → Variables, then redeploy.</p>}
    </div>
  );
  return (
    <div>
      <PageHeader
        title="Outbox"
        subtitle="Every email and text Gigsaw has sent, or would have sent. Until a provider is connected, messages are kept here instead of going out, including password reset links you can pass on by hand."
      />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        {status(emailConfigured(), "Email (Resend)", "RESEND_API_KEY and MAIL_FROM")}
        {status(smsConfigured(), "Texts (Twilio)", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM")}
      </div>
      <MessageList messages={messages} timezone="Europe/London" showAgency />
    </div>
  );
}
