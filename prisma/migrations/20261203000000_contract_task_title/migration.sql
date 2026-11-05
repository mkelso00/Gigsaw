-- A signed proposal now counts as the contract: rename the standard checklist item to say so.
UPDATE "EventTask" SET "title" = 'Proposal or contract signed' WHERE "key" = 'CONTRACT' AND "title" = 'Contract sent and signed';
