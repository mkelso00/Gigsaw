-- Pay details on people, a lead person for each band, and who each act invoice is made out to.
-- See src/lib/payee.ts for the rules.

-- AlterTable
ALTER TABLE "ActInvoice" ADD COLUMN     "payeeName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payeePersonId" TEXT;

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "leadPersonId" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "bankAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankSortCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "detailsCompletedAt" TIMESTAMP(3),
ADD COLUMN     "niNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vatNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ActInvoice_payeePersonId_idx" ON "ActInvoice"("payeePersonId");

-- AddForeignKey
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_leadPersonId_fkey" FOREIGN KEY ("leadPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoices so far were made out to the act.
UPDATE "ActInvoice" SET "payeeName" = "actName" WHERE "payeeName" = '';

-- data:start
-- Move acts' pay details to the person they belong to, where that's clear. The same rules as movePlan in
-- src/lib/payee.ts (tests/person-pay-details-db.test.ts runs this part and checks the two agree): the act's
-- only member, or else the one member whose email is the act's; never over a different address on the
-- person, and never two acts' details onto one person. Anything else stays on the act for staff to sort out.
CREATE TEMP TABLE "_PayMove" AS
WITH acts AS (
  SELECT a.id, a.email, a.address
  FROM "Artist" a
  WHERE btrim(a."bankAccountName") <> '' OR btrim(a."bankSortCode") <> '' OR btrim(a."bankAccountNumber") <> '' OR btrim(a.address) <> ''
     OR btrim(a."niNumber") <> '' OR btrim(a."vatNumber") <> '' OR a."detailsCompletedAt" IS NOT NULL
),
counts AS (
  SELECT pa."artistId", count(*) AS n FROM "PersonAct" pa GROUP BY pa."artistId"
),
matches AS (
  SELECT acts.id AS "artistId", p.id AS "personId", (COALESCE(c.n, 0) <> 1) AS "byEmail", acts.address AS "actAddress", p.address AS "personAddress"
  FROM acts
  JOIN "PersonAct" pa ON pa."artistId" = acts.id
  JOIN "Person" p ON p.id = pa."personId"
  LEFT JOIN counts c ON c."artistId" = acts.id
  WHERE COALESCE(c.n, 0) = 1 OR (btrim(acts.email) <> '' AND lower(btrim(acts.email)) = lower(btrim(p.email)))
),
single AS (
  SELECT m.* FROM matches m
  WHERE (SELECT count(*) FROM matches x WHERE x."artistId" = m."artistId") = 1
    AND (btrim(m."actAddress") = '' OR btrim(m."personAddress") = ''
      OR btrim(regexp_replace(lower(m."actAddress"), '[[:space:],]+', ' ', 'g')) = btrim(regexp_replace(lower(m."personAddress"), '[[:space:],]+', ' ', 'g')))
)
SELECT s."artistId", s."personId", s."byEmail" AS "setLead"
FROM single s
WHERE (SELECT count(*) FROM single y WHERE y."personId" = s."personId") = 1;

UPDATE "Person" p SET
  "bankAccountName" = a."bankAccountName",
  "bankSortCode" = a."bankSortCode",
  "bankAccountNumber" = a."bankAccountNumber",
  "vatRegistered" = a."vatRegistered",
  "vatNumber" = a."vatNumber",
  "niNumber" = a."niNumber",
  "address" = CASE WHEN btrim(a.address) <> '' THEN a.address ELSE p.address END,
  "detailsCompletedAt" = CASE
    WHEN btrim(a."bankAccountName") <> '' AND btrim(a."bankSortCode") <> '' AND btrim(a."bankAccountNumber") <> '' AND (btrim(a.address) <> '' OR btrim(p.address) <> '')
    THEN COALESCE(a."detailsCompletedAt", NOW()) ELSE NULL END
FROM "_PayMove" m JOIN "Artist" a ON a.id = m."artistId"
WHERE p.id = m."personId";

-- A band whose details were one member's: that member becomes its lead, so its invoices carry on going to them.
UPDATE "Artist" a SET "leadPersonId" = m."personId" FROM "_PayMove" m WHERE a.id = m."artistId" AND m."setLead" AND a."leadPersonId" IS NULL;

-- Invoices already made from those details were paid to that person, so they can see them from their login.
UPDATE "ActInvoice" i SET "payeePersonId" = m."personId" FROM "_PayMove" m WHERE i."artistId" = m."artistId" AND i."payeePersonId" IS NULL;

INSERT INTO "Activity" ("id", "agencyId", "entity", "entityId", "action", "detail", "createdAt")
SELECT 'pm' || md5(random()::text || m."artistId"), a."agencyId", 'ARTIST', a.id, 'pay details moved to a person', btrim(p."firstName" || ' ' || p.surname), NOW()
FROM "_PayMove" m JOIN "Artist" a ON a.id = m."artistId" JOIN "Person" p ON p.id = m."personId";

-- One copy only: the bank details now live on the person.
UPDATE "Artist" a SET
  "bankAccountName" = '', "bankSortCode" = '', "bankAccountNumber" = '', "vatRegistered" = false, "vatNumber" = '', "niNumber" = '', "address" = '',
  "detailsCompletedAt" = NULL
FROM "_PayMove" m WHERE a.id = m."artistId";

DROP TABLE "_PayMove";
-- data:end
