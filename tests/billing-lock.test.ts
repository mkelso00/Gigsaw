import { describe, expect, it } from "vitest";
import { isLocked, lockDecision, lockedMessage, lockedPath } from "@/lib/billing-lock";
import { FormError, ShownFormError, formErrorFromDigest, handleForm } from "@/lib/forms";

const now = new Date("2026-11-04T12:00:00Z");
const DAY = 86_400_000;

type Billing = {
  billingMode: string;
  plan: string | null;
  billingInterval: string;
  trialEndsAt: Date | null;
  subscriptionStatus: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

const agency = (extra: Partial<Billing> = {}): Billing => ({
  billingMode: "STRIPE",
  plan: "STARTER",
  billingInterval: "month",
  trialEndsAt: new Date(now.getTime() - DAY),
  subscriptionStatus: "NONE",
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  ...extra,
});
const user = (role: string, a: Billing | null = agency(), isOwner = false) => ({ role, isOwner, agency: a });

const page = { inAction: false };
const action = { inAction: true };

describe("isLocked", () => {
  it("locks a self-service business once its trial has ended without a subscription", () => {
    expect(isLocked(user("ADMIN"), now)).toBe(true);
  });

  it("stays open during the trial, while subscribed and while Stripe retries a failed payment", () => {
    expect(isLocked(user("ADMIN", agency({ trialEndsAt: new Date(now.getTime() + 3 * DAY) })), now)).toBe(false);
    expect(isLocked(user("ADMIN", agency({ subscriptionStatus: "ACTIVE", stripeSubscriptionId: "sub_1" })), now)).toBe(false);
    expect(isLocked(user("ADMIN", agency({ subscriptionStatus: "PAST_DUE", stripeSubscriptionId: "sub_1" })), now)).toBe(false);
  });

  it("locks a cancelled subscription", () => {
    expect(isLocked(user("AGENT", agency({ subscriptionStatus: "CANCELED", stripeSubscriptionId: "sub_1" })), now)).toBe(true);
  });

  it("never locks free or invoiced businesses, whatever their trial date says", () => {
    expect(isLocked(user("ADMIN", agency({ billingMode: "FREE" })), now)).toBe(false);
    expect(isLocked(user("ADMIN", agency({ billingMode: "INVOICE" })), now)).toBe(false);
  });

  it("never locks the platform owner, even in a locked business", () => {
    expect(isLocked(user("ADMIN", agency(), true), now)).toBe(false);
  });

  it("doesn't lock a user with no business", () => {
    expect(isLocked(user("ADMIN", null), now)).toBe(false);
  });
});

describe("lockDecision", () => {
  it("lets everything through for a business that isn't locked", () => {
    const open = user("AGENT", agency({ trialEndsAt: new Date(now.getTime() + DAY) }));
    expect(lockDecision(open, page, now)).toEqual({ kind: "open" });
    expect(lockDecision(open, action, now)).toEqual({ kind: "open" });
  });

  it("sends a locked admin's pages to Plan, and agents and acts to the locked page", () => {
    expect(lockDecision(user("ADMIN"), page, now)).toEqual({ kind: "redirect", to: "/settings/plan" });
    expect(lockDecision(user("AGENT"), page, now)).toEqual({ kind: "redirect", to: "/locked" });
    expect(lockDecision(user("ARTIST"), page, now)).toEqual({ kind: "redirect", to: "/locked" });
  });

  it("refuses a locked business's server actions with a message instead of redirecting", () => {
    const d = lockDecision(user("ADMIN"), action, now);
    expect(d.kind).toBe("refuse");
    expect(d.kind === "refuse" && d.message).toBe("Your free trial has ended. Choose a plan in Settings, Plan to carry on.");
  });

  it("keeps the allow-listed pages and actions (Plan, Profile) open", () => {
    expect(lockDecision(user("ADMIN"), { ...page, allowLocked: true }, now)).toEqual({ kind: "open" });
    expect(lockDecision(user("AGENT"), { ...action, allowLocked: true }, now)).toEqual({ kind: "open" });
  });

  it("keeps everything open for the platform owner and free accounts", () => {
    expect(lockDecision(user("ADMIN", agency(), true), action, now)).toEqual({ kind: "open" });
    expect(lockDecision(user("AGENT", agency({ billingMode: "FREE" })), page, now)).toEqual({ kind: "open" });
  });
});

describe("lockedMessage and lockedPath", () => {
  it("words the message for who's asking and why", () => {
    expect(lockedMessage(user("AGENT"), now)).toBe("Your free trial has ended. Ask an admin at your business to choose a plan.");
    expect(lockedMessage(user("ADMIN", agency({ subscriptionStatus: "CANCELED", stripeSubscriptionId: "sub_1" })), now)).toMatch(
      /^Your business's subscription has been cancelled\. Choose a plan/,
    );
    expect(lockedMessage(user("ARTIST"), now)).toMatch(/^Your agency's Gigsaw account is paused/);
  });

  it("only sends admins to Plan, since only they can choose one", () => {
    expect(lockedPath({ role: "ADMIN" })).toBe("/settings/plan");
    expect(lockedPath({ role: "AGENT" })).toBe("/locked");
  });
});

describe("ShownFormError", () => {
  it("carries its message in the digest Next passes to the browser", () => {
    const message = "Your free trial has ended. Ask an admin @ your business: 100% safe";
    const e = new ShownFormError(message);
    // What the browser gets back from a failed action: the message is hidden, the digest kept.
    expect(formErrorFromDigest({ digest: e.digest })).toBe(message);
  });

  it("ignores ordinary errors and other digests", () => {
    expect(formErrorFromDigest(new Error("secret"))).toBeNull();
    expect(formErrorFromDigest({ digest: "123456789" })).toBeNull();
    expect(formErrorFromDigest({ digest: "gigsaw-form-error:%E0%A4%A" })).toBeNull();
    expect(formErrorFromDigest(null)).toBeNull();
  });

  it("is a FormError, so handleForm turns it into a message too", async () => {
    expect(new ShownFormError("x")).toBeInstanceOf(FormError);
    expect(
      await handleForm(async () => {
        throw new ShownFormError("Choose a plan");
      }),
    ).toEqual({ error: "Choose a plan" });
  });
});
