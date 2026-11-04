-- Scheduler heartbeat: the last successful (and last failed) run of each background job, for a
-- health check.

-- CreateTable
CREATE TABLE "SchedulerHeartbeat" (
    "job" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerHeartbeat_pkey" PRIMARY KEY ("job")
);
