#!/usr/bin/env node
// Make a new migration from your changes to prisma/schema.prisma:
//   npm run migration:new -- add_venue_notes
//
// It's named after the newest folder in prisma/migrations (now, or the day after the newest if
// that's later), never before it: some folders have future dates, and a migration named before
// one production has already run would be applied out of order. scripts/check-migrations.mjs
// checks this in CI.
//
// The SQL is the difference between the existing migrations and the schema, worked out by
// `prisma migrate diff`. That needs a scratch Postgres database to replay the migrations into:
// set SHADOW_DATABASE_URL (it is wiped each time). Without it, the diff is taken against
// DATABASE_URL instead, so run `npx prisma migrate deploy` first to bring that up to date.
// Pass --empty to make the folder with an empty migration.sql and write the SQL yourself.
//
// Then apply it locally with `npx prisma migrate deploy`.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR = "prisma/migrations";
const SCHEMA = "prisma/schema.prisma";

const args = process.argv.slice(2);
const empty = args.includes("--empty");
const raw = args.filter((a) => !a.startsWith("--")).join("_");
const name = raw
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
if (!name) {
  console.error("Usage: npm run migration:new -- <name> [--empty]   e.g. npm run migration:new -- add_venue_notes");
  process.exit(1);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const stampOf = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

const folders = readdirSync(DIR)
  .filter((f) => statSync(path.join(DIR, f)).isDirectory() && /^\d{14}_/.test(f))
  .sort();
const newest = folders.at(-1)?.slice(0, 14) ?? "";
let stamp = stampOf(new Date());
if (stamp <= newest) {
  // The day after the newest, at midnight, as the existing folders are named.
  const y = Number(newest.slice(0, 4));
  const mo = Number(newest.slice(4, 6));
  const d = Number(newest.slice(6, 8));
  stamp = stampOf(new Date(Date.UTC(y, mo - 1, d + 1)));
}

// Read .env as Prisma does (anything already set wins).
try {
  process.loadEnvFile();
} catch {
  // No .env file, or a Node without loadEnvFile: use the environment as it is.
}

let sql = "";
if (!empty) {
  const shadow = process.env.SHADOW_DATABASE_URL;
  if (!shadow && !process.env.DATABASE_URL) {
    console.error("Set SHADOW_DATABASE_URL (a scratch database) or DATABASE_URL (migrated up to date) so the changes can be worked out, or pass --empty.");
    process.exit(1);
  }
  const from = shadow ? ["--from-migrations", DIR, "--shadow-database-url", shadow] : ["--from-schema-datasource", SCHEMA];
  if (!shadow) console.log("No SHADOW_DATABASE_URL, so comparing with DATABASE_URL. Run `npx prisma migrate deploy` first if it's behind.");
  sql = execFileSync("npx", ["prisma", "migrate", "diff", ...from, "--to-schema-datamodel", SCHEMA, "--script"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  // Prisma writes "-- This is an empty migration." when nothing changed.
  if (!sql.split("\n").some((l) => l.trim() && !l.trim().startsWith("--"))) {
    console.error("No changes to the schema found, so no migration was made. (Pass --empty to make one anyway.)");
    process.exit(1);
  }
}

const folder = path.join(DIR, `${stamp}_${name}`);
mkdirSync(folder);
writeFileSync(path.join(folder, "migration.sql"), sql || "-- Write the SQL for this migration here.\n");
console.log(`Made ${folder}/migration.sql${newest ? ` (after ${newest})` : ""}. Check it, then apply it with: npx prisma migrate deploy`);
