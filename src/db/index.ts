import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import pino from "pino";

const logger = pino({ name: "fg-media-hub-db" });

type AppDb = ReturnType<typeof drizzle>;

let db: AppDb | null = null;
let dbReady = false;

/** Connect in the background — never throws; API can start without DB. */
export async function initDatabase(): Promise<boolean> {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    logger.warn("DATABASE_URL not set — running without database");
    return false;
  }

  try {
    const sql = neon(url);
    await sql`SELECT 1`;
    db = drizzle(sql);
    dbReady = true;
    logger.info("Database connection established");
    return true;
  } catch (err) {
    db = null;
    dbReady = false;
    logger.error({ err }, "Database connection failed — API will continue without DB");
    return false;
  }
}

export function getDb(): AppDb | null {
  return db;
}

export function isDbReady(): boolean {
  return dbReady;
}
