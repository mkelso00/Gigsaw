-- Indexes for the hot paths that had none (architecture review P2-15), and hiding the secret
-- links in messages logged before the app started redacting them (1C).
-- Every index here is also declared with @@index in schema.prisma, under Prisma's own name, so
-- `prisma migrate diff` stays clean. IF NOT EXISTS makes a re-run (or an index someone already
-- added by hand under the same name) harmless.

-- Nearly every booking list includes payments.
CREATE INDEX IF NOT EXISTS "Payment_bookingId_idx" ON "Payment"("bookingId");

-- A venue's and a payer's bookings, newest first; also clearing the link when one is deleted.
CREATE INDEX IF NOT EXISTS "Booking_venueId_setStart_idx" ON "Booking"("venueId", "setStart");
CREATE INDEX IF NOT EXISTS "Booking_promoterId_setStart_idx" ON "Booking"("promoterId", "setStart");

-- Across every business by call time: the every-minute overdue check and the month's billable
-- gigs. A plain index rather than a partial one: overdueAlertSentAt is only set once an alert has
-- gone, so "WHERE overdueAlertSentAt IS NULL" would keep nearly every row, and the query's demo
-- and status filters arrive as bind parameters, which a partial index can't be matched against
-- once Postgres switches the prepared statement to a generic plan.
CREATE INDEX IF NOT EXISTS "Booking_arriveBy_idx" ON "Booking"("arriveBy");

-- Signing out everywhere, or every other device.
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- The contact page: its notes (newest first) and its people.
CREATE INDEX IF NOT EXISTS "ContactNote_contactId_createdAt_idx" ON "ContactNote"("contactId", "createdAt");
CREATE INDEX IF NOT EXISTS "Person_companyId_idx" ON "Person"("companyId");

-- Links to a booking that are cleared (SET NULL) when the booking is deleted, and the booking
-- page's "acts were asked" line.
CREATE INDEX IF NOT EXISTS "Enquiry_bookingId_idx" ON "Enquiry"("bookingId");
CREATE INDEX IF NOT EXISTS "AvailabilityRequest_bookingId_idx" ON "AvailabilityRequest"("bookingId");
CREATE INDEX IF NOT EXISTS "AvailabilityReply_bookingId_idx" ON "AvailabilityReply"("bookingId");

-- Events: the every-minute email check runs across every business by date; a contact's and a
-- venue's events are counted before turning one into the other, and cleared when one is deleted.
CREATE INDEX IF NOT EXISTS "Event_date_idx" ON "Event"("date");
CREATE INDEX IF NOT EXISTS "Event_customerId_idx" ON "Event"("customerId");
CREATE INDEX IF NOT EXISTS "Event_venueId_idx" ON "Event"("venueId");

-- A business's team: the agent pickers on most forms, seat counts for billing.
CREATE INDEX IF NOT EXISTS "User_agencyId_idx" ON "User"("agencyId");

-- Password reset links: the per-user rate limit, and using up the others once one is used.
CREATE INDEX IF NOT EXISTS "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");

-- The Owner area's message log, newest first across every business.
CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");


-- Hide the key in secret links in messages already logged, exactly as redactLinks() in
-- src/lib/message-format.ts now does before saving (body and error; the subject never had links):
-- https://gigsaw.live/o/abc123?x=1 becomes https://gigsaw.live/o/…?x=1. Host, page and query
-- string stay, so staff can still see which link went out.
--
-- This is a loop rather than one regexp_replace because redactLinks decides per match: a path on
-- its own (no host) only counts at the start of a word, and one that doesn't count is still
-- consumed, so nothing inside it can match either. regexp_replace can't do "keep this match as it
-- is". The pattern is the same as SECRET_LINK, with JavaScript's \s spelled out (Postgres's \s
-- depends on the locale). A redacted link stays the same when redacted again, so a re-run changes
-- nothing; rows with nothing to hide aren't written at all.
CREATE FUNCTION pg_temp.redact_links(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE
  ws CONSTANT text := '\t\n\v\f\r    -     　﻿';
  link CONSTANT text := '((?:https?://[^' || ws || '/?#<>"'']+)?/(?:reset-password|o|c|pay|w|f|join|v|q)/[^' || ws || '/?#<>"''),\]]+)';
  word_start CONSTANT text := '[' || ws || '(<"''\[]';
  out text := '';
  pos int := 1;
  at int;
  m text;
  host text;
BEGIN
  LOOP
    -- The next link from pos on. The match at a given place is fixed by the text from there on,
    -- so the first copy of the matched text from pos on is where it was found.
    m := (regexp_match(substr(t, pos), link))[1];
    EXIT WHEN m IS NULL;
    at := pos - 1 + strpos(substr(t, pos), m);
    host := substring(m from '^https?://[^/]+');
    out := out || substr(t, pos, at - pos);
    IF host IS NULL AND at > 1 AND substr(t, at - 1, 1) !~ word_start THEN
      out := out || m; -- inside another path, e.g. /docs/o/abc: not a link of ours
    ELSE
      -- host (if any) and "/<page>/", then the ellipsis (U+2026) in place of the key
      out := out || coalesce(host, '') || substring(m from '^(?:https?://[^/]+)?(/[^/]+/)') || chr(8230);
    END IF;
    pos := at + length(m);
  END LOOP;
  RETURN out || substr(t, pos);
END
$fn$;

UPDATE "Message" AS m
SET body = r.body, error = r.error
FROM (
  SELECT id, pg_temp.redact_links(body) AS body, pg_temp.redact_links(error) AS error
  FROM "Message"
  -- Every link has "/<page>/" in it: a quick check that skips the rest.
  WHERE body ~ '/(reset-password|o|c|pay|w|f|join|v|q)/' OR error ~ '/(reset-password|o|c|pay|w|f|join|v|q)/'
) AS r
WHERE m.id = r.id AND (m.body <> r.body OR m.error <> r.error);

DROP FUNCTION pg_temp.redact_links(text);
