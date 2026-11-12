import { formatDateTime } from "@/lib/time";
import type { BookingPageData } from "../_data";

export function ActivitySection({ activity, timeZone }: { activity: BookingPageData["activity"]; timeZone: string }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Activity</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="font-medium">{a.user?.name ?? "Someone"}</span> {a.action}
              {a.detail && <span className="text-slate-500"> · {a.detail}</span>}
              <span className="block text-xs text-slate-400">{formatDateTime(a.createdAt, timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
