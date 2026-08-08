import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import pino from "pino";

const logger = pino({ name: "fg-media-hub-db" });

let pool: mysql.Pool | null = null;
let db: MySql2Database | null = null;
let dbReady = false;

/** Connect in the background — never throws; API can start without DB. */
export async function initDatabase(): Promise<boolean> {
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASS;
  const database = process.env.DB_NAME?.trim();
  const port = Number(process.env.DB_PORT) || 3306;

  if (!host || !user || !database) {
    logger.warn("DB_HOST / DB_USER / DB_NAME not set — running without database");
    return false;
  }

  try {
    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10000,
    });

    await pool.query("SELECT 1");
    db = drizzle(pool);
    dbReady = true;
    logger.info({ host, database, port }, "MySQL connection established");
    return true;
  } catch (err) {
    pool = null;
    db = null;
    dbReady = false;
    logger.error({ err }, "MySQL connection failed — API will continue without DB");
    return false;
  }
}

export function getDb(): MySql2Database | null {
  return db;
}

export function getPool(): mysql.Pool | null {
  return pool;
}

export function isDbReady(): boolean {
  return dbReady;
}
