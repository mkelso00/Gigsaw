import "server-only";

// Puts acts' gigs straight into their connected Google or Outlook calendars (docs/calendar-connect.md).
// These are the entry points the rest of the app calls. PLACEHOLDERS until the sync engine lands:
// they do nothing yet, so callers can be wired up first.

/** A booking was created, changed, confirmed, cancelled, archived or deleted: bring its act's calendars in line. Never throws. */
export async function syncBookingToCalendars(bookingId: string): Promise<void> {
  void bookingId;
}

/** A calendar was just connected (or reconnected): add the act's upcoming gigs to it. Never throws. */
export async function resyncConnection(connectionId: string): Promise<void> {
  void connectionId;
}

/** A calendar is being disconnected: remove the events Gigsaw put in it, then forget the links. Never throws. */
export async function removeConnectionEvents(connectionId: string): Promise<void> {
  void connectionId;
}
