import "server-only";
import { env } from "@/server/env";
import { prisma } from "./db";

// Gigsaw's own Stripe keys. The owner can paste them in the Owner area (kept in AppSecret, never
// shown back in full); anything not set there falls back to the server's environment variables
// (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, read in src/server/env.ts).
// Read often, so cached for half a minute and cleared straight away when the owner saves.

export const STRIPE_KEY_NAMES = {
  secretKey: "stripe_secret_key",
  webhookSecret: "stripe_webhook_secret",
  connectWebhookSecret: "stripe_connect_webhook_secret",
} as const;

export type StripeKeys = { secretKey: string; webhookSecret: string; connectWebhookSecret: string };
export type StripeKeySource = Record<keyof StripeKeys, "owner" | "server" | "none">;

let cache: { at: number; keys: StripeKeys; source: StripeKeySource } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < 30_000) return cache;
  // If the database can't be read, carry on with the server's own variables rather than failing.
  const rows = await prisma.appSecret.findMany({ where: { key: { in: Object.values(STRIPE_KEY_NAMES) } } }).catch(() => []);
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  const fromEnv = env().stripe;
  const keys = {} as StripeKeys;
  const source = {} as StripeKeySource;
  for (const k of Object.keys(STRIPE_KEY_NAMES) as (keyof StripeKeys)[]) {
    const own = saved.get(STRIPE_KEY_NAMES[k]) ?? "";
    keys[k] = own || fromEnv[k];
    source[k] = own ? "owner" : fromEnv[k] ? "server" : "none";
  }
  cache = { at: Date.now(), keys, source };
  return cache;
}

export async function stripeKeys(): Promise<StripeKeys> {
  return (await load()).keys;
}

/** Where each key comes from, for the Owner area. */
export async function stripeKeySources(): Promise<StripeKeySource> {
  return (await load()).source;
}

export function clearStripeKeyCache() {
  cache = null;
}

/** The last few characters of a key, so the owner can tell which one is in use without it being shown. */
export function maskKey(key: string) {
  if (!key) return "";
  const prefix = key.match(/^(sk|rk|whsec)_(live|test)?_?/)?.[0] ?? "";
  return `${prefix}…${key.slice(-4)}`;
}
