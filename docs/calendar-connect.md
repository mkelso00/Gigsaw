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
| Entry points `syncBookingToCalendars`, `resyncConnection`, `removeConnectionEvents` | `src/lib/calendar-sync/index.ts` | **sync engine** (done) |
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

## How the sync engine behaves

- **Files**: `src/lib/calendar-sync/index.ts` (entry points), `content.ts` (event content, hashing, which gigs
  belong), `providers.ts` (Google and Graph clients, token refresh), `queue.ts` (`queueCalendarSync`, used by the
  booking write paths), `job.ts` (scheduler job). The words come from `src/lib/act-calendar.ts`, which the
  subscribe feed uses too, so a connected calendar never says more than the feed.
- **Which gigs**: the feed's rule (the login's acts and the bands they're in, statuses an act sees, not archived,
  back 90 days), less cancelled ones, which are removed rather than shown as cancelled. A person's login works
  the same way as in their feed. A gig already in the calendar isn't taken out just because it's now old.
  A business that's locked (trial or subscription ended) gets no new or changed events, but removals still happen.
- **Times**: the venue's wall-clock time with its IANA zone (`Europe/London`) for both providers.
- **Booking writes** call `queueCalendarSync(ids)` after the write commits. It never waits for the provider: one
  in-process queue, started with Next's `after()` inside a request, worked through one gig at a time.
- **Failures**: `invalid_grant` (or similar), a 401 straight after a refresh, a 403 that isn't a rate limit, a
  calendar that's gone, or a refresh token that won't decrypt set `NEEDS_RECONNECT` with `lastError`. Anything else
  sets `lastError` only. Connections in `NEEDS_RECONNECT` are skipped until the connect flow sets them `ACTIVE`
  again and calls `resyncConnection`, which clears `lastError` and sets `lastSyncedAt` when everything matches.
- **Scheduler** (`calendar-sync` job, every minute, time-boxed to 20 seconds): retries connections with a
  `lastError` every 15 minutes, and resyncs each connection about once a day (`lastSyncedAt`).
- **Logins deleted** (an act, a person, a team member, demo data): `removeCalendarsOfLogins` empties their
  calendars first, since the connection rows go with the login.
- **Stand-in for tests**: with `OAUTH_TEST_BASE`, tokens go to `<base>/google/token` and
  `<base>/microsoft/common/oauth2/v2.0/token` (as sign-in), events to `<base>/google/calendar/v3/...` and
  `<base>/microsoft/graph/v1.0/...`.

## Providers

| | Google | Microsoft |
|---|---|---|
| Auth | Same OAuth client as sign-in (`GOOGLE_CLIENT_ID/SECRET`); `access_type=offline`, `prompt=consent`, PKCE | Same app as sign-in (`MICROSOFT_CLIENT_ID/SECRET`), `common` tenant, PKCE |
| Scopes | `openid email https://www.googleapis.com/auth/calendar.events` (+ `calendar.calendarlist.readonly` only if choosing a calendar is built) | `openid email offline_access User.Read Calendars.ReadWrite` |
| Events API | `https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` | `https://graph.microsoft.com/v1.0/me/calendar/events` (default) or `/me/calendars/{id}/events` |
| Redirect URI to register | `<APP_URL>/api/calendar-connect/google/callback` | `<APP_URL>/api/calendar-connect/microsoft/callback` |

`OAUTH_TEST_BASE` (tests only, ignored in production) points both the sign-in and the calendar APIs at a stand-in.

The connect flow uses these stand-in paths under it: `/google/authorize`, `/google/token`, `/google/jwks`,
`/google/revoke`, `/google/calendar/v3/…` and `/microsoft/common/oauth2/v2.0/…`, `/microsoft/graph/v1.0/…`.

## How the connect flow works

- **Start** (`GET /api/calendar-connect/google` or `/microsoft`, a plain link from the act app): only for a
  signed-in act login (`role = "ARTIST"` with `artistId`), and only when `CALENDAR_TOKEN_KEY` and that
  provider's `GOOGLE_`/`MICROSOFT_` settings are set. A new state, PKCE verifier and nonce are kept in a
  signed, 10-minute cookie (`gigsaw_calendar_connect`, path `/api/calendar-connect`) together with the
  login's id, then the browser goes to the provider. Reconnecting suggests the account already connected.
- **Callback** (`/api/calendar-connect/<provider>/callback`): the cookie is used up; the state must match and
  the flow must have been started by the same login; the code is swapped with the PKCE verifier; the
  id_token's signature, issuer, audience, expiry and nonce are checked (the same checks as sign-in, in
  `src/lib/oauth.ts`); calendar access must have been granted and a refresh token must have come back. Then
  the connection is saved (tokens sealed) and `resyncConnection` is called. The act lands back on `/app` with
  `?calendar=<result>`, shown in plain words in "Your calendar".
- **Reconnecting** the same account keeps the chosen calendar and clears `NEEDS_RECONNECT`. A different
  account calls `removeConnectionEvents` for the old one, drops its event links, and starts in the main
  calendar.
- **Choosing a calendar** (`/app/calendar`): lists the act's calendars they can add events to (Google
  `calendarList` with `minAccessRole=writer`, Microsoft `/me/calendars` where `canEdit`). The main calendar is
  saved as `"primary"`. Changing calls `removeConnectionEvents`, saves, then `resyncConnection`.
- **Disconnecting**: `removeConnectionEvents`, then Google's revoke address (best effort; Microsoft has none
  for one app, so the act is told where to remove it), then the row is deleted.
- Staff see one line on the act's page (Artist app login): connected, which account, or needs reconnecting.

## Setting it up

Calendar connect uses the same Google and Microsoft apps as "Sign in with Google/Microsoft", with calendar
access added. Set those up first (README, the `GOOGLE_` and `MICROSOFT_` variables). You can set up just
one of the two; acts only see the buttons for the ones that are ready.

### 1. Make the key that protects acts' calendar access

Gigsaw stores each act's calendar access encrypted. Make a key once:

1. On a Mac or Linux computer, open Terminal and run `openssl rand -base64 32`. It prints a line of about
   44 letters and numbers.
2. In Railway, open the Gigsaw service, then **Variables**, and add `CALENDAR_TOKEN_KEY` with that line as
   its value. Railway redeploys.
3. Keep a copy somewhere safe, such as a password manager. If the key is lost or changed, every act has to
   connect their calendar again.

### 2. Google Calendar

In the [Google Cloud Console](https://console.cloud.google.com), choose the project that has Gigsaw's sign-in
client. Google moves these screens around now and then; if a name below doesn't match, look for the nearest
one with the same purpose.

1. **Turn on the Calendar API.** Go to **APIs & Services**, then **Library**, search for **Google Calendar
   API**, open it and press **Enable**.
2. **Add calendar access to the consent screen.** Go to **Google Auth Platform** (older layouts: **APIs &
   Services**, **OAuth consent screen**), then **Data Access** (older: **Scopes**), and press **Add or remove
   scopes**. Add these two and save:
   - `https://www.googleapis.com/auth/calendar.events` (add, change and remove events)
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (lets acts choose which calendar)
3. **Add the return address.** Go to **Clients** (older: **Credentials**), open the Web client Gigsaw uses
   for sign-in, and under **Authorised redirect URIs** add
   `https://<your site>/api/calendar-connect/google/callback` (your `APP_URL` with that path on the end).
   Keep the sign-in one that's already there. Save.
4. **While Google hasn't checked Gigsaw yet, add test users.** Under **Audience**, check the user type is
   **External**. While the publishing status is **Testing**, only the Google accounts listed under **Test
   users** can connect (up to 100). Add the email of each act who wants to try it. Google says access given
   to an app in Testing runs out after 7 days, so in this stage acts will see "Reconnect" about once a week.
5. **Ask Google to verify Gigsaw.** Calendar access is what Google calls a "sensitive" permission, so before
   everyone can use it, Google reviews the app. Under **Audience**, press **Publish app** to move it to In
   production, then go to **Verification Centre** and submit it. Google usually asks for:
   - your home page and privacy policy addresses, on a domain you've verified (in **Branding**, Authorised
     domains);
   - a sentence on why Gigsaw needs each permission, for example: "Gigsaw adds each act's confirmed gigs to
     the calendar they choose, and updates or removes them when the gig changes or is cancelled. The
     calendar list lets them choose which calendar.";
   - a short video showing an act connecting their calendar and a gig appearing in it.

   Until Google approves it, acts outside the test list see a "Google hasn't verified this app" warning and
   can only go on through **Advanced**, and Google limits how many can. Reviews can take from a few days to
   several weeks; check progress in Verification Centre and reply to Google's emails.

### 3. Outlook (Microsoft)

In the [Microsoft Entra admin centre](https://entra.microsoft.com), go to **App registrations** and open the
app Gigsaw uses for sign-in.

1. **Add the return address.** Open **Authentication**. Under the **Web** platform, add the redirect URI
   `https://<your site>/api/calendar-connect/microsoft/callback`, keep the sign-in one, and save.
2. **Add calendar permissions.** Open **API permissions**, press **Add a permission**, choose **Microsoft
   Graph**, then **Delegated permissions**, and tick:
   - `Calendars.ReadWrite`
   - `offline_access`
   - `User.Read` (often there already)
   - `openid` and `email` (often there already, for sign-in)

   Press **Add permissions**. You don't need **Grant admin consent**: each act agrees for themselves when they
   connect.
3. **Check the client secret's expiry date** under **Certificates & secrets**. When it runs out, sign-in and
   calendar connect both stop until a new secret is put in `MICROSOFT_CLIENT_SECRET`.

Personal accounts (Outlook.com, Hotmail, Live) work straight away. A work or school account may show "Need
admin approval": that organisation only lets its IT team approve apps. The act's IT team can approve
Gigsaw, and Microsoft's publisher verification (in **Branding & properties**, which needs a Microsoft
partner account) makes approval more likely to be allowed. Check Microsoft's current guidance on publisher
verification if many acts use work accounts.

### 4. Check it works

1. Sign in as an act (or ask one of your test users to), open the app, and find **Your calendar**.
2. Press **Connect Google Calendar** or **Connect Outlook**, choose the account and allow access.
3. Back in Gigsaw it says "Connected: name@example.com". On the act's page, staff see
   "Calendar: Google Calendar connected".

If it says it couldn't connect, Railway's logs have a line starting "Calendar connect failed" with the reason.
"redirect_uri_mismatch" from Google, or "AADSTS50011" from Microsoft, means the return address in step 2.3 or 3.1 doesn't exactly
match your site's address.
