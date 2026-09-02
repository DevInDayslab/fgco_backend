import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../db/index.js";
import { admins } from "../db/schema.js";

const logger = pino({ name: "fg-media-hub-admin-bootstrap" });
const BCRYPT_ROUNDS = 12;

/** Seed the first admin from env when the admins table is empty. */
export async function bootstrapAdminUser(): Promise<void> {
  const db = getDb();
  if (!db) {
    logger.warn("Skipping admin bootstrap — database unavailable");
    return;
  }

  const [row] = await db.select({ value: count() }).from(admins);
  if ((row?.value ?? 0) > 0) {
    logger.info("Admin user already present — skipping bootstrap");
    return;
  }

  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const password =
    process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_PASSCODE?.trim() || "";

  if (!password) {
    throw new Error(
      "Admin bootstrap failed: admins table is empty and neither ADMIN_PASSWORD nor ADMIN_PASSCODE is set",
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.insert(admins).values({
    id: randomUUID(),
    username,
    passwordHash,
    tokenVersion: 1,
  });

  logger.info({ username }, "Bootstrapped default admin user from environment");
}

function isDevAdminEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.ALLOW_ADMIN_DEV_ACCESS === "true"
  );
}

/** Ensure a separate dev admin account exists (upserted from env on each startup). */
export async function ensureDevAdminUser(): Promise<void> {
  if (!isDevAdminEnabled()) {
    return;
  }

  const password = process.env.ADMIN_DEV_PASSWORD?.trim();
  if (!password) {
    return;
  }

  const db = getDb();
  if (!db) {
    logger.warn("Skipping dev admin setup — database unavailable");
    return;
  }

  const username = process.env.ADMIN_DEV_USERNAME?.trim() || "dev";
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [existing] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.username, username))
    .limit(1);

  if (existing) {
    await db
      .update(admins)
      .set({ passwordHash })
      .where(eq(admins.id, existing.id));
    logger.info({ username }, "Updated dev admin password from environment");
    return;
  }

  await db.insert(admins).values({
    id: randomUUID(),
    username,
    passwordHash,
    tokenVersion: 1,
  });

  logger.info({ username }, "Created dev admin user from environment");
}

export function getDevAdminAccessInfo(): { enabled: boolean; username: string | null } {
  if (!isDevAdminEnabled() || !process.env.ADMIN_DEV_PASSWORD?.trim()) {
    return { enabled: false, username: null };
  }

  return {
    enabled: true,
    username: process.env.ADMIN_DEV_USERNAME?.trim() || "dev",
  };
}
