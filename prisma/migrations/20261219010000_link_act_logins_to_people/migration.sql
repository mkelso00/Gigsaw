-- data:start
-- Someone with their own solo act and a person record (in bands too) who signed up with the solo
-- act's email has a login on the act only, so their bands don't count them as signed up and their app
-- and calendar feed miss the bands' gigs. Link each such act login to its person as well
-- (src/lib/login-person.ts does the same from now on): someone in the login's act, in the same
-- business, with no login of their own, whose email is the login's or the act's; failing that, the
-- act's only member. Where two people would match, nothing is changed.

-- 1. By email.
WITH matches AS (
  SELECT u."id" AS uid, p."id" AS pid
  FROM "User" u
  JOIN "Artist" a ON a."id" = u."artistId"
  JOIN "PersonAct" pa ON pa."artistId" = a."id"
  JOIN "Person" p ON p."id" = pa."personId" AND p."agencyId" = a."agencyId"
  WHERE u."personId" IS NULL
    AND u."role" = 'ARTIST'
    AND btrim(p."email") <> ''
    AND (lower(btrim(p."email")) = lower(btrim(u."email")) OR lower(btrim(p."email")) = lower(btrim(a."email")))
    AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."personId" = p."id")
),
one_per_login AS (
  SELECT uid, min(pid) AS pid FROM matches GROUP BY uid HAVING count(DISTINCT pid) = 1
),
one_per_person AS (
  SELECT min(uid) AS uid, pid FROM one_per_login GROUP BY pid HAVING count(*) = 1
)
UPDATE "User" u SET "personId" = o.pid FROM one_per_person o WHERE u."id" = o.uid AND u."personId" IS NULL;

-- 2. The act's only member, for act logins still without a person and acts with no email match.
WITH solo AS (
  SELECT pa."artistId", min(pa."personId") AS pid
  FROM "PersonAct" pa
  GROUP BY pa."artistId"
  HAVING count(*) = 1
),
matches AS (
  SELECT u."id" AS uid, s.pid
  FROM "User" u
  JOIN "Artist" a ON a."id" = u."artistId"
  JOIN solo s ON s."artistId" = a."id"
  JOIN "Person" p ON p."id" = s.pid AND p."agencyId" = a."agencyId"
  WHERE u."personId" IS NULL
    AND u."role" = 'ARTIST'
    AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."personId" = s.pid)
    AND NOT EXISTS (
      SELECT 1 FROM "PersonAct" pa2 JOIN "Person" p2 ON p2."id" = pa2."personId"
      WHERE pa2."artistId" = a."id" AND btrim(p2."email") <> ''
        AND (lower(btrim(p2."email")) = lower(btrim(u."email")) OR lower(btrim(p2."email")) = lower(btrim(a."email")))
        AND p2."id" <> s.pid
    )
),
one_per_person AS (
  SELECT min(uid) AS uid, pid FROM matches GROUP BY pid HAVING count(*) = 1
)
UPDATE "User" u SET "personId" = o.pid FROM one_per_person o WHERE u."id" = o.uid AND u."personId" IS NULL;
-- data:end
