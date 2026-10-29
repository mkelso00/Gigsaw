// Prisma CLI settings (migrate, generate, studio). Prisma 7 no longer reads .env on its own.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Not env("DATABASE_URL"): that throws when it's unset, and `prisma generate` (run on
  // npm install) doesn't need a database.
  datasource: { url: process.env.DATABASE_URL },
});
