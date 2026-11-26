-- AlterTable
ALTER TABLE "User" ADD COLUMN     "handOffToId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_handOffToId_fkey" FOREIGN KEY ("handOffToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

