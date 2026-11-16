-- The National Insurance number is now optional: acts with bank details and an address count as complete.
UPDATE "Artist" SET "detailsCompletedAt" = NOW()
WHERE "detailsCompletedAt" IS NULL AND "bankAccountName" <> '' AND "bankSortCode" <> '' AND "bankAccountNumber" <> '' AND "address" <> '';
