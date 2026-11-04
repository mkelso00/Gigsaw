// What happens when a business's free trial has ended or its subscription was cancelled (see
// billingState in ./subscription). Checked for every signed-in agency user in src/lib/auth.ts:
// pages send them to Plan (or to /locked if they can't choose one), server actions refuse with a
// message. The plan page and its billing actions, Profile and signing out stay open, as does
// everything for the platform owner. Free and invoiced businesses are never locked.

import { billingState } from "./subscription";

type LockedUser = {
  role: string;
  isOwner: boolean;
  agency: Parameters<typeof billingState>[0] | null;
};

export type LockDecision = { kind: "open" } | { kind: "redirect"; to: string } | { kind: "refuse"; message: string };

/** Whether this user's business is locked out of Gigsaw right now. */
export function isLocked(user: LockedUser, now = new Date()) {
  return !user.isOwner && !!user.agency && billingState(user.agency, now).locked;
}

/** Where a locked user is sent: admins choose a plan, everyone else is told to ask an admin. */
export function lockedPath(user: { role: string }) {
  return user.role === "ADMIN" ? "/settings/plan" : "/locked";
}

/** Why a locked user can't do something, worded for who they are. */
export function lockedMessage(user: LockedUser, now = new Date()) {
  const billing = user.agency ? billingState(user.agency, now) : null;
  const reason = billing?.mode === "STRIPE" && billing.status === "CANCELED" ? "Your business's subscription has been cancelled" : "Your free trial has ended";
  if (user.role === "ARTIST") return "Your agency's Gigsaw account is paused, so this can't be saved right now. Your bookings are safe.";
  if (user.role === "ADMIN") return `${reason}. Choose a plan in Settings, Plan to carry on.`;
  return `${reason}. Ask an admin at your business to choose a plan.`;
}

/**
 * What to do with a request from this user. `allowLocked` marks the pages and actions a locked
 * business may still use; `inAction` is true for a server action, which can't be sent elsewhere
 * mid-form, so it refuses with a message instead.
 */
export function lockDecision(user: LockedUser, opts: { allowLocked?: boolean; inAction: boolean }, now = new Date()): LockDecision {
  if (opts.allowLocked || !isLocked(user, now)) return { kind: "open" };
  if (opts.inAction) return { kind: "refuse", message: lockedMessage(user, now) };
  return { kind: "redirect", to: lockedPath(user) };
}
