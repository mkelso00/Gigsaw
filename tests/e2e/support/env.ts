// Where the end-to-end tests find the app and its database. Shared by playwright.config.ts and the
// test helpers, so the browser and the data set-up always point at the same place.

export const port = Number(process.env.E2E_PORT ?? 3154);
export const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

/** The database the app under test uses. E2E_DATABASE_URL wins, so a local .env never decides it. */
export const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

/** The database's name, from its URL. */
export function databaseName(url: string) {
  return decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
}

/**
 * The tests add rows to this database and expect the demo seed in it, so only a throwaway one
 * will do: its name has to say so (e2e or test in it, e.g. gigsaw_e2e).
 */
export function checkDatabaseUrl() {
  if (!databaseUrl) {
    throw new Error(
      "Set E2E_DATABASE_URL to a throwaway, seeded database, e.g. postgresql://postgres:postgres@localhost:5432/gigsaw_e2e (see README, Checks).",
    );
  }
  const name = databaseName(databaseUrl);
  if (!/e2e|test/i.test(name)) {
    throw new Error(`The end-to-end tests won't use the database "${name}". Use a throwaway one with e2e or test in its name, e.g. gigsaw_e2e.`);
  }
}

/** The seeded staff login (prisma/seed.ts). */
export const ADMIN = { email: "admin@gigsaw.test", password: "gigsaw123", firstName: "Alex" };
export const AGENCY_NAME = "Northern Lights Agency";
export const ADMIN_STATE = "tests/e2e/.auth/admin.json";
