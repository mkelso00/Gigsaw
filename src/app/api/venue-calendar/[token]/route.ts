import { buildIcs, icsResponse } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { findSharedVenue, venueLineup } from "@/lib/venue-share";

export const dynamic = "force-dynamic";

// Calendar feed for a venue's line-up (names and times only, no money).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const venue = await findSharedVenue(token.replace(/\.ics$/, ""));
  if (!venue) return new Response("Not found", { status: 404 });
  const { days } = await venueLineup(venue, 12);
  const now = new Date();
  const events = days.flatMap(([, entries]) =>
    entries
      .filter((e) => e.kind === "booking")
      .map((e) => ({
        uid: `${e.id}@gigsaw-venue`,
        start: e.start,
        end: e.end ?? new Date(e.start.getTime() + 2 * 3_600_000),
        summary: `${e.artist}${e.act ? ` (${e.act})` : ""}${e.provisional ? " [provisional]" : ""}`,
        location: venue.name,
        description: `Line-up: ${appUrl()}/v/${token.replace(/\.ics$/, "")}`,
        updated: now,
      })),
  );
  return icsResponse(req, buildIcs(`${venue.name} · what's on`, events, { timezone: venue.timezone }), { filename: "whats-on.ics" });
}
