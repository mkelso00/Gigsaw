import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CURRENCY, EXTRA_USER_MONTHLY_MINOR, EXTRA_USER_YEARLY_MINOR, planByKey, type PlanKey } from "./plans";

// A small Stripe client over its REST API (no SDK needed). Setup is just two settings on the
// server: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Products and prices are made in Stripe
// the first time they're needed, found again by their lookup key, so nothing has to be set up
// by hand in the Stripe dashboard. A price change in src/lib/plans.ts makes a new Stripe price;
// existing subscriptions keep theirs until the plan is changed.

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

export class StripeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Stripe wants form encoding with nested keys: items[0][price]=… */
export function encodeForm(params: Params, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") parts.push(encodeForm(item as Params, `${name}[${i}]`));
        else parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      parts.push(encodeForm(v as Params, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("Stripe isn't connected yet");
  const body = encodeForm(params);
  // STRIPE_API_BASE is only for testing against a stand-in server.
  const url = `${process.env.STRIPE_API_BASE ?? "https://api.stripe.com"}/v1/${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as T & { error?: { message: string; code?: string } };
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe error ${res.status}`, json.error?.code);
  return json;
}

/**
 * Check a webhook really came from Stripe: the Stripe-Signature header is "t=<time>,v1=<hmac>",
 * an HMAC-SHA256 of "<time>.<body>" with the webhook secret. Old events are refused.
 */
export function verifyWebhook(body: string, header: string | null, secret: string, now = Date.now(), toleranceSeconds = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!t || !signatures.length || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export type PriceKind = PlanKey | "EXTRA_USER";
export type Interval = "month" | "year";

/** The lookup key for a price; it includes the amount, so a new price in plans.ts makes a new Stripe price. */
export function priceLookupKey(kind: PriceKind, interval: Interval) {
  const amount = priceAmount(kind, interval);
  return `gigsaw_${kind.toLowerCase()}_${interval}_${amount}`;
}

export function priceAmount(kind: PriceKind, interval: Interval) {
  if (kind === "EXTRA_USER") return interval === "year" ? EXTRA_USER_YEARLY_MINOR : EXTRA_USER_MONTHLY_MINOR;
  const plan = planByKey(kind)!;
  return interval === "year" ? plan.yearlyMinor : plan.monthlyMinor;
}

/** Which plan and interval a Stripe price is, from its lookup key. */
export function parseLookupKey(key: string | null | undefined): { kind: PriceKind; interval: Interval } | null {
  const m = /^gigsaw_(starter|growth|agency|extra_user)_(month|year)_\d+$/.exec(key ?? "");
  return m ? { kind: m[1].toUpperCase() as PriceKind, interval: m[2] as Interval } : null;
}

/** Find this price in Stripe, or make it (and its product) the first time. */
export async function ensurePrice(kind: PriceKind, interval: Interval): Promise<string> {
  const lookup = priceLookupKey(kind, interval);
  const found = await stripe<{ data: { id: string }[] }>("GET", "prices", { lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const productId = `gigsaw_${kind.toLowerCase()}`;
  try {
    await stripe("POST", "products", {
      id: productId,
      name: kind === "EXTRA_USER" ? "Gigsaw extra internal user" : `Gigsaw ${planByKey(kind)!.name}`,
    });
  } catch (e) {
    // Already made on an earlier run.
    if (!(e instanceof StripeError && e.code === "resource_already_exists")) throw e;
  }
  const price = await stripe<{ id: string }>("POST", "prices", {
    product: productId,
    currency: CURRENCY.toLowerCase(),
    unit_amount: priceAmount(kind, interval),
    recurring: { interval },
    lookup_key: lookup,
    transfer_lookup_key: true,
  });
  return price.id;
}
