import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { getDbCredentials } from "./src/db/credentials.ts";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const credentials = getDbCredentials();

if (!credentials) {
  throw new Error(
    "Database credentials missing. Set LOCAL_DB_* for development or CPANEL_DB_* for production.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password ?? "",
    database: credentials.database,
  },
});
