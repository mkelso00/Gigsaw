import { defineConfig } from "vitest/config";
import path from "node:path";

// Database tests (see tests/helpers/db.ts) run against TEST_DATABASE_URL when it's set, so the
// app's client is pointed there too, never at the database in DATABASE_URL.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Server-only modules (src/server/*, most of src/lib) can be imported by tests.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {} },
});
