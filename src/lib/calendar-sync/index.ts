import "server-only";
import type { CalendarConnection, Prisma } from "@prisma/client";
import { ACT_FEED_SELECT } from "@/lib/act-calendar";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { actIdsFor, actTree } from "@/lib/people";
import { billingState } from "@/lib/subscription";
import { log } from "@/server/log";
import { ACT_FEED_DAYS_BACK, belongsInCalendar, calendarContent, CALENDAR_STATUSES, contentHash, planSync, type Provider } from "./content";
import { CalendarAccessError, CalendarClient, CalendarSetupError, type ClientDeps } from "./providers";

// Puts acts' gigs straight into their connected Google or Outlook calendars (docs/calendar-connect.md).
// These are the entry points the rest of the app calls:
//   syncBookingToCalendars  a booking changed in any way: bring every calendar it is (or was) in up to date
//   resyncConnection        a calendar was (re)connected, or needs a top-up: every gig that belongs, and nothing else
//   removeConnectionEvents  a calendar is being disconnected: take Gigsaw's events out of it
//
// None of them ever throws: a booking save must never fail because a calendar did. Failures are
// logged and kept on the connection (lastError) for the scheduler to try again (job.ts).
//
// What goes in, and its words, follow the act's subscribe feed (content.ts, src/lib/act-calendar.ts).
// Each event is remembered in CalendarEventLink with a hash of what was sent, so a gig that hasn't
// changed costs no calls, a changed one is updated in place, and one that left (cancelled,
// archived, deleted, moved to another act) is removed. Links are found by booking id, which is how
// a booking moved to another act is taken out of the old act's calendars.

/** Test hook: the fetch, clock and settings the provider clients use. */
let clientDeps: Omit<ClientDeps, "saveTokens"> = {};
export function setCalendarClientDepsForTests(deps: Omit<ClientDeps, "saveTokens">) {
  clientDeps = deps;
}

// One thing at a time per connection, in this process: two quick saves of the same gig would
// otherwise both see no event yet and add it twice, and two token refreshes could race. The app runs
// as one long-lived server (the scheduler lives in it too), so an in-memory queue covers it.
const queues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(connectionId: string, run: () => Promise<T>): Promise<T> {
  const prev = queues.get(connectionId) ?? Promise.resolve();
  const next = prev.then(run, run);
  const settled = next.then(
    () => {},
    () => {},
  );
  queues.set(connectionId, settled);
  void settled.then(() => {
    if (queues.get(connectionId) === settled) queues.delete(connectionId);
  });
  return next;
}

const connectionInclude = { user: { select: { artistId: true, personId: true } } } satisfies Prisma.CalendarConnectionInclude;
type Connection = Prisma.CalendarConnectionGetPayload<{ include: typeof connectionInclude }>;

const gigSelect = {
  ...ACT_FEED_SELECT,
  agencyId: true,
  artistId: true,
  archivedAt: true,
  agency: {
    select: {
      status: true,
      billingMode: true,
      plan: true,
      billingInterval: true,
      trialEndsAt: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      currentPeriodEnd: true,
    },
  },
} satisfies Prisma.BookingSelect;
type Gig = Prisma.BookingGetPayload<{ select: typeof gigSelect }>;

/** Like the act's feed: a closed business, or one whose trial or subscription has ended, doesn't add or change events. */
function agencyOpen(agency: Gig["agency"]) {
  return agency.status === "ACTIVE" && !billingState(agency).locked;
}

function clientFor(conn: CalendarConnection) {
  return new CalendarClient(conn, {
    ...clientDeps,
    saveTokens: async (update) => {
      await prisma.calendarConnection.update({ where: { id: conn.id }, data: update });
    },
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Note a failure on the connection. Access that's been withdrawn needs the act to connect again
 * (NEEDS_RECONNECT, which the connect flow shows); anything else is kept for the scheduler to retry.
 */
async function recordFailure(conn: { id: string; provider: string }, e: unknown, context: Record<string, unknown> = {}) {
  const reconnect = e instanceof CalendarAccessError;
  const level = reconnect || e instanceof CalendarSetupError ? "warn" : "error";
  log[level]("Calendar sync failed", { connectionId: conn.id, provider: conn.provider, needsReconnect: reconnect, ...context, err: e });
  try {
    await prisma.calendarConnection.updateMany({
      where: { id: conn.id },
      data: { lastError: message(e), ...(reconnect ? { status: "NEEDS_RECONNECT" } : {}) },
    });
  } catch (dbErr) {
    log.error("Couldn't save a calendar sync failure", { connectionId: conn.id, err: dbErr });
  }
}

/**
 * Bring one gig in one calendar in line: add, change, remove or leave it. `gig` is null when the
 * booking has been deleted. Throws provider errors to the caller, which decides what to record.
 */
async function applyGig(
  client: CalendarClient,
  conn: Connection,
  bookingId: string,
  gig: Gig | null,
  wanted: boolean,
  link: { id: string; externalId: string; contentHash: string } | null,
  baseUrl: string,
) {
  const content = gig && wanted ? calendarContent(gig, { baseUrl }) : null;
  const hash = content ? contentHash(content, conn.provider as Provider) : null;
  const plan = planSync(wanted, link, hash);
  if (plan === "skip") return plan;
  if (plan === "delete") {
    await client.deleteEvent(link!.externalId);
    await prisma.calendarEventLink.deleteMany({ where: { id: link!.id } });
    return plan;
  }
  let externalId = link?.externalId ?? "";
  if (plan === "update" && (await client.updateEvent(externalId, content!, bookingId)) === "gone") externalId = "";
  // New, or deleted from the calendar by hand: add it (again).
  if (!externalId) externalId = await client.createEvent(content!, bookingId);
  const data = { externalId, contentHash: hash!, syncedAt: new Date() };
  await prisma.calendarEventLink.upsert({
    where: { connectionId_bookingId: { connectionId: conn.id, bookingId } },
    create: { connectionId: conn.id, bookingId, ...data },
    update: data,
  });
  return plan;
}

/** The acts a connection's login sees: the same as their feed and app (their acts, and the bands those are in). */
function actsOf(conn: Connection) {
  return actIdsFor({ artistId: conn.user.artistId, personId: conn.user.personId, agencyId: conn.agencyId });
}

/**
 * Connections that could show this act's gigs: logins for this act or any act inside it (a solo act
 * in a band sees the band's gigs), directly or as a person in one of those acts.
 */
async function connectionsForAct(agencyId: string, artistId: string) {
  const parts = [...(await actTree(agencyId)).withParts([artistId])];
  const rows = await prisma.calendarConnection.findMany({
    where: { agencyId, status: "ACTIVE", user: { OR: [{ artistId: { in: parts } }, { person: { acts: { some: { artistId: { in: parts } } } } }] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** A booking was created, changed, confirmed, cancelled, archived, restored, deleted or moved to another act. Never throws. */
export async function syncBookingToCalendars(bookingId: string): Promise<void> {
  try {
    // Every calendar the gig is in now, whether or not it still belongs there.
    const linked = await prisma.calendarEventLink.findMany({ where: { bookingId }, select: { connectionId: true } });
    // findUnique isn't filtered by the archive (db.ts), so an archived gig is found and taken out.
    const gig = await prisma.booking.findUnique({ where: { id: bookingId }, select: gigSelect });
    const candidates = new Set(linked.map((l) => l.connectionId));
    if (gig?.artistId) for (const id of await connectionsForAct(gig.agencyId, gig.artistId)) candidates.add(id);
    if (!candidates.size) return;
    const baseUrl = appUrl();
    for (const connectionId of candidates) {
      await oneAtATime(connectionId, async () => {
        const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId }, include: connectionInclude });
        // Waiting for the act to connect again: nothing can be done until they do (resyncConnection catches up).
        if (!conn || conn.status !== "ACTIVE") return;
        try {
          const link = await prisma.calendarEventLink.findUnique({ where: { connectionId_bookingId: { connectionId, bookingId } } });
          const sameAgency = !!gig && gig.agencyId === conn.agencyId;
          const wanted = sameAgency && belongsInCalendar(gig!, await actsOf(conn), { ignoreAge: !!link });
          // A locked business leaves events as they are, but still takes out gigs that went.
          if (wanted && !agencyOpen(gig!.agency)) return;
          await applyGig(clientFor(conn), conn, bookingId, sameAgency ? gig : null, wanted, link, baseUrl);
        } catch (e) {
          await recordFailure(conn, e, { bookingId });
        }
      });
    }
  } catch (e) {
    log.error("Calendar sync for a booking failed", { bookingId, err: e });
  }
}

export type ResyncOptions = {
  /** Stop starting new calls after this time (ms since 1970), so the scheduler's run stays short. What's left is done next time. */
  deadline?: number;
};

/** A calendar was just connected (or reconnected), or is due a top-up: add, change and remove until it matches. Never throws. */
export async function resyncConnection(connectionId: string, opts: ResyncOptions = {}): Promise<void> {
  try {
    await oneAtATime(connectionId, () => resync(connectionId, opts));
  } catch (e) {
    log.error("Calendar resync failed", { connectionId, err: e });
  }
}

async function resync(connectionId: string, opts: ResyncOptions) {
  const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId }, include: connectionInclude });
  if (!conn || conn.status !== "ACTIVE") return;
  try {
    const now = new Date();
    const actIds = await actsOf(conn);
    const agency = await prisma.agency.findUnique({ where: { id: conn.agencyId }, select: gigSelect.agency.select });
    const open = !!agency && agencyOpen(agency);
    // The gigs that belong: the act feed's, less cancelled ones (archived ones are left out by db.ts too).
    const gigs =
      open && actIds.length
        ? await prisma.booking.findMany({
            where: {
              agencyId: conn.agencyId,
              artistId: { in: actIds },
              status: { in: CALENDAR_STATUSES },
              archivedAt: null,
              setStart: { gte: new Date(now.getTime() - ACT_FEED_DAYS_BACK * 86_400_000) },
            },
            select: gigSelect,
            orderBy: { setStart: "asc" },
          })
        : [];
    const links = await prisma.calendarEventLink.findMany({
      where: { connectionId },
      select: { id: true, bookingId: true, externalId: true, contentHash: true },
    });
    const linkFor = new Map(links.map((l) => [l.bookingId, l]));
    const client = clientFor(conn);
    const baseUrl = appUrl();
    const outOfTime = () => opts.deadline !== undefined && Date.now() > opts.deadline;
    let failed = 0;
    let firstError: unknown = null;
    let finished = true;
    const attempt = async (bookingId: string, gig: Gig | null, wanted: boolean) => {
      try {
        await applyGig(client, conn, bookingId, gig, wanted, linkFor.get(bookingId) ?? null, baseUrl);
      } catch (e) {
        // Withdrawn access or missing setup stops the lot: every other call would fail the same way.
        if (e instanceof CalendarAccessError || e instanceof CalendarSetupError) throw e;
        failed++;
        firstError ??= e;
        log.warn("A gig couldn't be synced to a calendar", { connectionId, bookingId, err: e });
      }
    };

    const current = new Set<string>();
    for (const gig of gigs) {
      current.add(gig.id);
      if (outOfTime()) {
        finished = false;
        break;
      }
      await attempt(gig.id, gig, true);
    }

    // Events for gigs that aren't in that list: deleted, cancelled, archived, another act's now, or
    // simply older than the feed goes back. Only the first four are taken out.
    const others = links.filter((l) => !current.has(l.bookingId));
    if (finished && others.length) {
      const still = await prisma.booking.findMany({ where: { id: { in: others.map((l) => l.bookingId) }, archivedAt: undefined }, select: gigSelect });
      const byId = new Map(still.map((b) => [b.id, b]));
      for (const l of others) {
        if (outOfTime()) {
          finished = false;
          break;
        }
        const gig = byId.get(l.bookingId) ?? null;
        const keep = !!gig && gig.agencyId === conn.agencyId && belongsInCalendar(gig, actIds, { now, ignoreAge: true });
        if (keep) continue;
        await attempt(l.bookingId, null, false);
      }
    }

    if (failed) {
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: { lastError: `${failed} gig${failed === 1 ? "" : "s"} couldn't be synced: ${message(firstError)}`.slice(0, 500) },
      });
    } else if (finished) {
      // Everything matches: clear any earlier failure, and note when, for the daily top-up.
      await prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastError: "", lastSyncedAt: new Date() } });
    }
  } catch (e) {
    await recordFailure(conn, e);
  }
}

/** A calendar is being disconnected: remove the events Gigsaw put in it, then forget the links. Never throws. */
export async function removeConnectionEvents(connectionId: string): Promise<void> {
  try {
    await oneAtATime(connectionId, async () => {
      // Whatever the status: a connection waiting to be reconnected may still have working access to tidy up with.
      const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
      if (!conn) return;
      const links = await prisma.calendarEventLink.findMany({ where: { connectionId }, select: { id: true, externalId: true, bookingId: true } });
      if (!links.length) return;
      const client = clientFor(conn);
      let failed = 0;
      let firstError: unknown = null;
      for (const l of links) {
        try {
          await client.deleteEvent(l.externalId);
          await prisma.calendarEventLink.deleteMany({ where: { id: l.id } });
        } catch (e) {
          // Without access none of the rest will go either; the link is kept so a later try can still find the event.
          if (e instanceof CalendarAccessError || e instanceof CalendarSetupError) {
            await recordFailure(conn, e, { removing: true });
            return;
          }
          failed++;
          firstError ??= e;
          log.warn("A gig couldn't be removed from a calendar", { connectionId, bookingId: l.bookingId, err: e });
        }
      }
      if (failed)
        await prisma.calendarConnection.update({
          where: { id: conn.id },
          data: { lastError: `${failed} gig${failed === 1 ? "" : "s"} couldn't be removed: ${message(firstError)}`.slice(0, 500) },
        });
    });
  } catch (e) {
    log.error("Removing a calendar's events failed", { connectionId, err: e });
  }
}

/** Before deleting logins: take their connected calendars' events out, since the connections go with them. Never throws. */
export async function removeCalendarsOfLogins(where: Prisma.UserWhereInput): Promise<void> {
  try {
    const conns = await prisma.calendarConnection.findMany({ where: { user: where }, select: { id: true } });
    for (const c of conns) await removeConnectionEvents(c.id);
  } catch (e) {
    log.error("Couldn't tidy calendars before removing logins", { err: e });
  }
}
