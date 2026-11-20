import { log } from "@/server/log";
import { withHeartbeat } from "@/server/scheduler-health";
import { runAsLeader } from "@/server/scheduler-lock";
import { runActInvoices } from "./act-invoices";
import { runActBillsToXero } from "./act-invoices-xero";
import { runOverdueCheck } from "./alerts";
import { runCalendarSync } from "./calendar-sync/job";
import { runEventMessages } from "./events";
import { runBillingReminders, runXeroPaymentChecks } from "./monthly-billing-server";
import { runPayDetailsChase } from "./pay-details-chase";
import { runProposalChasers } from "./proposal-chasers";
import { runReminders } from "./reminders";

const EVERY_MS = 60_000;
let started = false;
let running = false;

/**
 * Check for overdue arrivals, due gig reminders, wedding/event emails, proposal reminders, acts' invoices (with the weekly pay details
 * reminder and, where it's on, sending them to Xero) and the monthly billing reminders every minute, and catch up
 * connected calendars. Overlapping
 * runs are skipped. Each job's last success is recorded for the health check (schedulerHealth).
 */
export function startScheduler() {
  if (started) return;
  started = true;
  // With more than one server up, only the one holding the scheduler lock runs the jobs each time (src/server/scheduler-lock.ts).
  const tick = () => runAsLeader(runAll);
  const runAll = async () => {
    if (running) return;
    running = true;
    try {
      const r = await withHeartbeat("overdue", runOverdueCheck);
      if (r.alerted) log.info("Overdue alerts sent", { job: "overdue", bookings: r.alerted });
    } catch (e) {
      log.error("Overdue check failed", { job: "overdue", err: e });
    }
    try {
      const r = await withHeartbeat("reminders", runReminders);
      if (r.weekly || r.daily) log.info("Reminders sent", { job: "reminders", weekly: r.weekly, daily: r.daily });
    } catch (e) {
      log.error("Reminders failed", { job: "reminders", err: e });
    }
    try {
      const n = await withHeartbeat("event-emails", runEventMessages);
      if (n) log.info("Wedding and event emails sent", { job: "event-emails", sent: n });
    } catch (e) {
      log.error("Event emails failed", { job: "event-emails", err: e });
    }
    try {
      const r = await withHeartbeat("proposal-chasers", runProposalChasers);
      if (r.chased || r.expired) log.info("Proposal reminders sent", { job: "proposal-chasers", chased: r.chased, expired: r.expired });
    } catch (e) {
      log.error("Proposal reminders failed", { job: "proposal-chasers", err: e });
    }
    try {
      const r = await withHeartbeat("act-invoices", runActInvoices);
      if (r.issued || r.paid || r.voided || r.reissued) log.info("Act invoices updated", { job: "act-invoices", ...r });
    } catch (e) {
      log.error("Act invoices failed", { job: "act-invoices", err: e });
    }
    try {
      const r = await withHeartbeat("pay-details-chase", () => runPayDetailsChase());
      if (r.chased) log.info("Acts reminded about their pay details", { job: "pay-details-chase", chased: r.chased });
    } catch (e) {
      log.error("Pay details reminders failed", { job: "pay-details-chase", err: e });
    }
    try {
      const r = await withHeartbeat("act-bills-xero", () => runActBillsToXero());
      if (r.sent || r.paid || r.voided || r.problems) log.info("Act invoices sent to Xero", { job: "act-bills-xero", ...r });
    } catch (e) {
      log.error("Sending act invoices to Xero failed", { job: "act-bills-xero", err: e });
    }
    try {
      const r = await withHeartbeat("monthly-billing", async () => ({ ...(await runBillingReminders()), ...(await runXeroPaymentChecks()) }));
      if (r.sent) log.info("Monthly billing reminders sent", { job: "monthly-billing", sent: r.sent });
      if (r.paid) log.info("Bills marked paid from Xero", { job: "monthly-billing", paid: r.paid });
    } catch (e) {
      log.error("Monthly billing reminders failed", { job: "monthly-billing", err: e });
    }
    // Last, and time-boxed inside, so slow calendar providers never delay the jobs above.
    try {
      const r = await withHeartbeat("calendar-sync", runCalendarSync);
      if (r.retried || r.toppedUp) log.info("Connected calendars synced", { job: "calendar-sync", retried: r.retried, toppedUp: r.toppedUp });
    } catch (e) {
      log.error("Calendar sync job failed", { job: "calendar-sync", err: e });
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY_MS).unref?.();
}
