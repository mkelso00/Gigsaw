-- A lead turned into a proposal now counts as dealt with. Move the leads that already have one out of New.
UPDATE "Enquiry" SET "status" = 'DONE', "doneAt" = COALESCE("doneAt", NOW())
WHERE "status" = 'NEW' AND "id" IN (SELECT "enquiryId" FROM "Quote" WHERE "enquiryId" IS NOT NULL);
