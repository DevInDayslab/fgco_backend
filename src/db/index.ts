import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import pino from "pino";
import { getDbCredentials, getMissingDbEnvMessage } from "./credentials.js";
import * as schema from "./schema.js";

const logger = pino({ name: "fg-media-hub-db" });

type AppDb = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: AppDb | null = null;
let dbReady = false;
let lastDbError: { error_message: string; error_code: string } | null = null;

function captureDbError(err: unknown): { error_message: string; error_code: string } {
  const e = err as { message?: string; code?: string | number };
  return {
    error_message: e?.message ?? String(err),
    error_code: String(e?.code ?? "UNKNOWN"),
  };
}

export type DatabaseHealth = {
  ok: boolean;
  error_message?: string;
  error_code?: string;
};

/** Live ping — used by /health for browser diagnostics. */
export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  if (!pool) {
    if (lastDbError) {
      return { ok: false, ...lastDbError };
    }
    const credentials = getDbCredentials();
    if (!credentials) {
      return {
        ok: false,
        error_message: getMissingDbEnvMessage(),
        error_code: "ENV_MISSING",
      };
    }
    return {
      ok: false,
      error_message: "Database pool not initialized",
      error_code: "NOT_INITIALIZED",
    };
  }

  try {
    await pool.query("SELECT 1");
    lastDbError = null;
    dbReady = true;
    return { ok: true };
  } catch (err) {
    dbReady = false;
    lastDbError = captureDbError(err);
    return { ok: false, ...lastDbError };
  }
}

/** Connect in the background — never throws; API can start without DB. */
export async function initDatabase(): Promise<boolean> {
  const credentials = getDbCredentials();

  if (!credentials) {
    logger.warn(getMissingDbEnvMessage() + " — running without database");
    return false;
  }

  const { host, user, password, database, port, source } = credentials;

  try {
    pool = mysql.createPool({
      host,
      user,
      password,
      database,
      port,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10000,
    });

    await pool.query("SELECT 1");
    db = drizzle(pool, { schema, mode: "default" });
    dbReady = true;
    logger.info({ host, database, port, source }, "MySQL connection established");
    return true;
  } catch (err) {
    pool = null;
    db = null;
    dbReady = false;
    lastDbError = captureDbError(err);
    logger.error({ err }, "MySQL connection failed — API will continue without DB");
    return false;
  }
}

export function getDb(): AppDb | null {
  return db;
}

export function getPool(): mysql.Pool | null {
  return pool;
}

export function isDbReady(): boolean {
  return dbReady;
}
