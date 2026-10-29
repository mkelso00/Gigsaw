import type { Message } from "@/generated/prisma/client";
import { Empty } from "@/components/ui";
import { formatDateTime } from "@/lib/time";

const KIND: Record<string, string> = {
  PASSWORD_RESET: "Password reset",
  OVERDUE_ALERT: "Overdue alert",
  CLIENT_ARRIVAL: "Client: artist arrived",
  BOOKING_CHANGE: "Artist: gig booked or changed",
  TEST: "Test",
};
const STATUS: Record<string, [string, string]> = {
  SENT: ["Sent", "bg-emerald-50 text-emerald-800"],
  FAILED: ["Failed", "bg-rose-50 text-rose-800"],
  NOT_SENT: ["Not sent, no provider", "bg-ink-100 text-ink-600"],
};

/** A log of outgoing emails and texts. */
export function MessageList({ messages, timezone, showAgency }: { messages: (Message & { agency?: { name: string } | null })[]; timezone: string; showAgency?: boolean }) {
  if (messages.length === 0) return <Empty>No messages yet.</Empty>;
  return (
    <ul className="card divide-y divide-ink-100">
      {messages.map((m) => {
        const [label, style] = STATUS[m.status] ?? [m.status, "bg-ink-100"];
        return (
          <li key={m.id} className="px-5 py-4 text-sm">
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`badge ${style}`}>{label}</span>
                <span className="font-medium">{KIND[m.kind] ?? m.kind}</span>
                <span className="text-ink-500">
                  {m.channel === "SMS" ? "Text" : "Email"} to {m.to}
                </span>
                {showAgency && m.agency && <span className="text-ink-400">· {m.agency.name}</span>}
                <span className="ml-auto text-xs text-ink-400">{formatDateTime(m.createdAt, timezone)}</span>
              </summary>
              <div className="mt-3 rounded-lg bg-ink-50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-700">
                {m.subject && <div className="mb-2 font-semibold">{m.subject}</div>}
                {m.body}
              </div>
              {m.error && <p className="mt-2 text-xs text-rose-700">Error: {m.error}</p>}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
