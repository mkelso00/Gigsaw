import { buildIcs, icsResponse } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { venueFeedEvent } from "@/lib/venue-calendar";
import { findSharedVenue, venueLineup } from "@/lib/venue-share";

export const dynamic = "force-dynamic";

// Calendar feed for a venue's line-up: acts, times and the line-up link, never any money (src/lib/venue-calendar.ts).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const venue = await findSharedVenue(token.replace(/\.ics$/, ""));
  if (!venue) return new Response("Not found", { status: 404 });
  const { days } = await venueLineup(venue, 12);
  const opts = { venueName: venue.name, timezone: venue.timezone, lineupUrl: `${appUrl()}/v/${token.replace(/\.ics$/, "")}`, now: new Date() };
  const events = days.flatMap(([, entries]) => entries.flatMap((e) => (e.kind === "booking" ? [venueFeedEvent(e, opts)] : [])));
  return icsResponse(req, buildIcs(`${venue.name} · what's on`, events, { timezone: venue.timezone }), { filename: "whats-on.ics" });
}
