import { detailLine, detailText, timeLines } from "./gig-details";
import type { IcsEvent } from "./ics";

// The venue's "what's on" calendar feed (/api/venue-calendar/[token]): what their line-up page shows,
// as events. Never any money: the venue's line-up page shows no prices, not even what the venue pays,
// so neither does this. No contacts or the act's itinerary either: those are between the agency and the act.

/** A gig on the venue's line-up (src/lib/venue-share.ts), with the venue's time zone. */
export type VenueFeedGig = {
  id: string;
  start: Date;
  end: Date | null;
  arriveBy: Date;
  artist: string;
  genre: string;
  /** The booking's event name, e.g. "Quiz night". */
  act: string;
  provisional: boolean;
};

export function venueFeedEvent(e: VenueFeedGig, opts: { venueName: string; timezone: string; lineupUrl: string; now: Date }): IcsEvent {
  return {
    uid: `${e.id}@gigsaw-venue`,
    start: e.start,
    end: e.end ?? new Date(e.start.getTime() + 2 * 3_600_000),
    summary: `${e.artist}${e.act ? ` (${e.act})` : ""}${e.provisional ? " [provisional]" : ""}`,
    location: opts.venueName,
    description: detailText([
      [
        detailLine("Act", e.artist),
        detailLine("Style", e.genre),
        detailLine("Event", e.act),
        e.provisional ? detailLine("Status", "Provisional, not confirmed yet") : "",
      ],
      timeLines({ arriveBy: e.arriveBy, setStart: e.start, setEnd: e.end, timezone: opts.timezone }),
      [detailLine("Line-up", opts.lineupUrl)],
    ]),
    updated: opts.now,
  };
}
