#!/usr/bin/env node
// Checks prisma/migrations before a deploy (run in CI, or by hand: npm run check:migrations).
//
//  - Every folder is named YYYYMMDDHHMMSS_name (a real date and time) and has a migration.sql.
//  - No two folders share a timestamp, so the order they run in is never in doubt.
//  - With --base <git ref> (the branch being merged into, or the commit before a push):
//      every migration added since then sorts after the newest one already there, because
//      production has run those and Prisma would apply an older-named one out of order;
//      and none already there has been renamed, removed or edited.
//
// New migrations: npm run migration:new -- <name> picks a name after the newest folder.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DIR = "prisma/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+$/;

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? (args[baseAt + 1] ?? "").trim() : "";

const errors = [];
const fail = (msg) => errors.push(msg);

/** True for a 14-digit stamp that is a real UTC date and time. */
function validStamp(s) {
  const [y, mo, d, h, mi, se] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)].map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi &&
    t.getUTCSeconds() === se
  );
}

const folders = readdirSync(DIR)
  .filter((f) => statSync(path.join(DIR, f)).isDirectory())
  .sort();

const seen = new Map();
for (const f of folders) {
  const m = NAME.exec(f);
  if (!m) {
    fail(
      `${f}: name it YYYYMMDDHHMMSS_name (lower case letters, digits and underscores), e.g. via npm run migration:new -- ${
        f
          .replace(/^[\d_]+/, "")
          .replace(/\W+/g, "_")
          .toLowerCase() || "name"
      }`,
    );
    continue;
  }
  if (!validStamp(m[1])) fail(`${f}: ${m[1]} isn't a real date and time`);
  if (seen.has(m[1])) fail(`${f}: same timestamp as ${seen.get(m[1])}, so their order is unclear`);
  seen.set(m[1], f);
  const sql = path.join(DIR, f, "migration.sql");
  if (!existsSync(sql)) fail(`${f}: has no migration.sql`);
  else if (!statSync(sql).size) fail(`${f}: migration.sql is empty`);
}

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

let compared = false;
if (base && !/^0+$/.test(base)) {
  compared = true;
  try {
    git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  } catch {
    compared = false;
    // e.g. the commit before a force push, which is no longer fetched. Not a reason to fail.
    console.log(`::warning::check-migrations: can't find ${base}, so only the names were checked`);
  }
  if (compared) {
    let listed = "";
    try {
      listed = git("ls-tree", "-d", "--name-only", `${base}:${DIR}`);
    } catch {
      // No migrations folder there yet.
    }
    const before = listed
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    const now = new Set(folders);
    const was = new Set(before);
    for (const f of before) if (!now.has(f)) fail(`${f}: was in ${base} but is gone or renamed. Production has run it, so put it back as it was.`);
    const newest = before.at(-1);
    for (const f of folders.filter((x) => !was.has(x))) {
      if (newest && f <= newest) fail(`${f}: new, but sorts before ${newest}, the newest in ${base}. Rename it after that (npm run migration:new does this).`);
    }
    const edited = before.length
      ? git("diff", "--name-only", base, "--", ...before.map((f) => path.posix.join(DIR, f)))
          .split("\n")
          .filter(Boolean)
      : [];
    for (const f of edited.filter((x) => now.has(x.split("/")[2]))) fail(`${f}: changed since ${base}. Production has run it, so add a new migration instead.`);
  }
}

if (errors.length) {
  console.error(`Migration check failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`Migrations OK: ${folders.length} folders, newest ${folders.at(-1) ?? "(none)"}${compared ? `, compared with ${base}` : ""}.`);
