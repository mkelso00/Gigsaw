import type { Prisma } from "@prisma/client";
import { describe } from "vitest";
import type { prisma } from "@/lib/db";

// Database tests run only when TEST_DATABASE_URL names a throwaway database that has the
// migrations, e.g.
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gigsaw_test npx vitest run
// vitest.config.ts points the app's client (DATABASE_URL) at it for the whole run. Without it,
// every describeDb block is skipped and nothing touches a database.
//
// Each test makes its own agencies and data and removes them afterwards, so it never relies on
// the seed and can run again and again on the same database, alongside other test files.
// Load the app's modules inside beforeAll (await import(...)), so a skipped run never loads them.

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

/** The database's name, from its URL. */
function databaseName(url: string) {
  return decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
}

/** A name that says it's for tests: has "test" in it, or is an agent worktree's own (gigsaw_w…). */
function isTestDatabaseName(name: string) {
  return /test/i.test(name) || /^gigsaw_w\w+$/.test(name);
}

if (testDatabaseUrl && !isTestDatabaseName(databaseName(testDatabaseUrl))) {
  // These tests create and delete rows, so refuse a database that might be a real one.
  throw new Error(`TEST_DATABASE_URL names "${databaseName(testDatabaseUrl)}". Use a throwaway database with "test" in its name, e.g. gigsaw_test.`);
}

/** describe() for tests that need the test database: skipped when TEST_DATABASE_URL isn't set. */
export const describeDb = describe.skipIf(!testDatabaseUrl);

type Db = typeof prisma;

/**
 * A new agency (with its settings) and an admin login in it, for one test file. `tag` keeps
 * names and emails unique, so runs never collide. Pass settings to change the defaults.
 */
export async function createTestAgency(db: Db, tag: string, settings: Prisma.SettingsCreateWithoutAgencyInput = {}) {
  const stamp = `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const agency = await db.agency.create({ data: { name: `Test agency ${stamp}`, settings: { create: settings } } });
  const admin = await db.user.create({
    data: { email: `admin-${stamp}@gigsaw.invalid`, name: "Test admin", passwordHash: "x", role: "ADMIN", agencyId: agency.id },
  });
  return { agency, admin, user: { ...admin, agencyId: agency.id }, stamp };
}

/** Remove a test agency and everything in it (the schema cascades from the agency). */
export async function removeTestAgency(db: Db, agencyId: string) {
  if (!agencyId) return;
  await db.agency.deleteMany({ where: { id: agencyId } });
}
