import { buildIcs } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { findSharedVenue, venueLineup } from "@/lib/venue-share";

// Calendar feed for a venue's line-up (names and times only, no money).
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const venue = await findSharedVenue(token.replace(/\.ics$/, ""));
  if (!venue) return new Response("Not found", { status: 404 });
  const { days } = await venueLineup(venue, 12);
  const now = new Date();
  const events = days.flatMap(([, entries]) =>
    entries
      .filter((e) => e.kind === "gig")
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
  return new Response(buildIcs(`${venue.name} · what's on`, events), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" },
  });
}
