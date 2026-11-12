# Calendar connect

Acts connect their own Google or Outlook calendar once, and Gigsaw then puts their gigs straight into it:
added when a gig is booked, changed when it changes, removed when it's cancelled. This sits alongside the
existing subscribe link (`/api/calendar/[token]`, an iCalendar feed), which stays for Apple Calendar and
anyone who prefers it.

## What the act sees

Each gig is one event in their calendar, with the same content as their subscribe feed (`src/lib/ics.ts`
and `src/app/api/calendar/[token]`): title, venue and address, on-stage and arrival times, and the notes an
act is allowed to see. **Never** the sale price, booking fee, deposit, what the venue or customer pays,
or anything about other acts' fees. Acts only ever see their own pay, and only where the feed already shows it.

Which gigs: the same ones the act's subscribe feed contains (live statuses for that act, not archived). A gig
that leaves the feed (cancelled, archived, deleted, act changed to someone else) is removed from the calendar.

## Pieces and who owns them

| Piece | Where | Owner |
|---|---|---|
| Tables `CalendarConnection`, `CalendarEventLink` | `prisma/schema.prisma`, migration `20261205000000_calendar_connect` | groundwork (done) |
| Token encryption (`sealToken`, `openToken`, AES-256-GCM with `CALENDAR_TOKEN_KEY`) | `src/server/token-box.ts` | groundwork (done) |
| Setting `env().calendarTokenKey` | `src/server/env.ts` | groundwork (done) |
| Entry points `syncBookingToCalendars`, `resyncConnection`, `removeConnectionEvents` | `src/lib/calendar-sync/index.ts` | **sync engine** (placeholders now) |
| Google Calendar and Microsoft Graph clients, token refresh, event content, hashing, retries | `src/lib/calendar-sync/*` | **sync engine** |
| Calling `syncBookingToCalendars` wherever a booking changes | booking write paths (`src/actions/*`, `src/lib/*`) | **sync engine** |
| Scheduler job: retry failed syncs and a nightly top-up | `src/lib/scheduler.ts` / cron jobs | **sync engine** |
| Connect and callback routes, scopes, consent, storing the connection | `src/app/api/calendar-connect/[provider]/…`, `src/lib/calendar-connect.ts` | **connect flow** |
| Act app screen: connect, status, choose calendar, disconnect | `src/app/app/…`, `src/components/…` | **connect flow** |
| Staff view: which acts have a calendar connected | `src/app/(agency)/artists/[id]/page.tsx` (a small section) | **connect flow** |
| Setup guide (Google Cloud, Microsoft Entra, verification) | this file, section "Setting it up", and `.env.example` | **connect flow** |

## Contract between the two halves

- The connect flow creates or updates a `CalendarConnection` (one per `userId` + `provider`) with
  `refreshTokenEnc = sealToken(refreshToken)`, optional `accessTokenEnc` and `accessTokenExpiresAt`,
  `accountEmail`, `calendarId` (`"primary"` for Google; the id of the default calendar, or `"primary"`
  meaning default, for Microsoft), `status = "ACTIVE"`, then calls `resyncConnection(id)`.
- Disconnecting calls `removeConnectionEvents(id)` first, then revokes the token with the provider (best
  effort) and deletes the row.
- Changing the chosen calendar: the connect flow calls `removeConnectionEvents(id)`, updates `calendarId` and
  `calendarName`, then `resyncConnection(id)`.
- The sync engine sets `status = "NEEDS_RECONNECT"` and `lastError` when a refresh token is revoked or
  rejected (`invalid_grant`, 401 after refresh). The connect flow shows that state and offers Reconnect.
- The three entry points never throw: failures are logged and kept on the connection (`lastError`), and the
  scheduler retries. A booking save must never fail because a calendar did.
- Only the connection's own act's bookings are synced: `user.artistId`. Staff logins aren't connected yet; the
  table allows it later.

## Providers

| | Google | Microsoft |
|---|---|---|
| Auth | Same OAuth client as sign-in (`GOOGLE_CLIENT_ID/SECRET`); `access_type=offline`, `prompt=consent`, PKCE | Same app as sign-in (`MICROSOFT_CLIENT_ID/SECRET`), `common` tenant, PKCE |
| Scopes | `openid email https://www.googleapis.com/auth/calendar.events` (+ `calendar.calendarlist.readonly` only if choosing a calendar is built) | `openid email offline_access User.Read Calendars.ReadWrite` |
| Events API | `https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` | `https://graph.microsoft.com/v1.0/me/calendar/events` (default) or `/me/calendars/{id}/events` |
| Redirect URI to register | `<APP_URL>/api/calendar-connect/google/callback` | `<APP_URL>/api/calendar-connect/microsoft/callback` |

`OAUTH_TEST_BASE` (tests only, ignored in production) points both the sign-in and the calendar APIs at a stand-in.

## Setting it up

Written by the connect flow. Must cover: generating `CALENDAR_TOKEN_KEY`; Google Cloud (enable the Calendar
API, add the scope to the consent screen, add the redirect URI, test users while unverified, and Google's
verification for the sensitive `calendar.events` scope before it works for everyone); Microsoft Entra (add
the delegated `Calendars.ReadWrite` and `offline_access` permissions and the redirect URI; no admin consent
needed for personal accounts).
