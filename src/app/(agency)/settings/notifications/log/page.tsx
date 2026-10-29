import type { Metadata } from "next";
import { MessageList } from "@/components/message-list";
import { SettingsPage } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Message log" };
export const dynamic = "force-dynamic";

export default async function MessageLog() {
  const user = await requireAdmin();
  const [settings, messages] = await Promise.all([
    getSettings(user.agencyId!),
    prisma.message.findMany({ where: { agencyId: user.agencyId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return (
    <SettingsPage title="Message log" back={{ href: "/settings/notifications", label: "Notifications" }}>
      <p className="-mt-5 text-sm text-ink-500">The last 100 emails, texts and phone notifications, newest first.</p>
      {/* The list is its own card. */}
      <MessageList messages={messages} timezone={settings.defaultTimezone} />
    </SettingsPage>
  );
}
