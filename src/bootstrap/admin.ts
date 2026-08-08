import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
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
