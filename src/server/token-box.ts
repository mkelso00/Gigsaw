import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/server/env";

// Encrypts secrets kept in the database, such as connected calendars' tokens: AES-256-GCM with
// CALENDAR_TOKEN_KEY. Stored as "v1.<iv>.<tag>.<ciphertext>" in base64url, so a changed or
// truncated value fails to open instead of giving back rubbish.

const VERSION = "v1";

function keyOrThrow(key?: Buffer | null) {
  const k = key === undefined ? env().calendarTokenKey : key;
  if (!k || k.length !== 32) throw new Error("CALENDAR_TOKEN_KEY isn't set (32 random bytes, base64)");
  return k;
}

/** Encrypt a secret for storage. `key` is for tests; the server uses CALENDAR_TOKEN_KEY. */
export function sealToken(plain: string, key?: Buffer | null) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOrThrow(key), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Decrypt a value from sealToken. Throws if it was changed, cut short or sealed with another key. */
export function openToken(sealed: string, key?: Buffer | null) {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Not a sealed token");
  const decipher = createDecipheriv("aes-256-gcm", keyOrThrow(key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
