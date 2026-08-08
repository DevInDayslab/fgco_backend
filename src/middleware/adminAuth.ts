import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { admins } from "../db/schema.js";

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = "8h";

export type AdminJwtPayload = {
  adminId: string;
  tokenVersion: number;
};

declare global {
  namespace Express {
    interface Request {
      adminId?: string;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET is not configured");
  }
  return secret;
}

export function signAdminToken(adminId: string, tokenVersion: number): string {
  const payload: AdminJwtPayload = { adminId, tokenVersion };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRY });
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  const adminId = typeof decoded.adminId === "string" ? decoded.adminId : null;
  const tokenVersion =
    typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : null;

  if (!adminId || tokenVersion === null) {
    throw new Error("Invalid token payload");
  }

  return { adminId, tokenVersion };
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("Authorization")?.trim();
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let payload: AdminJwtPayload;
    try {
      payload = verifyAdminToken(token);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const db = getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const [admin] = await db
      .select({
        id: admins.id,
        tokenVersion: admins.tokenVersion,
      })
      .from(admins)
      .where(eq(admins.id, payload.adminId))
      .limit(1);

    if (!admin || admin.tokenVersion !== payload.tokenVersion) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.adminId = admin.id;
    next();
  } catch (err) {
    if (err instanceof Error && err.message.includes("ADMIN_JWT_SECRET")) {
      res.status(503).json({ error: "Admin auth not configured" });
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  }
}

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function postAdminLogin(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  try {
    getJwtSecret();
  } catch {
    res.status(503).json({ error: "Admin auth not configured" });
    return;
  }

  const { username, password } = parsed.data;

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.username, username))
    .limit(1);

  if (!admin) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = signAdminToken(admin.id, admin.tokenVersion);
  res.json({ token });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function postAdminChangePassword(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Current password and a new password of at least 8 characters are required",
    });
    return;
  }

  const adminId = req.adminId;
  if (!adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const [admin] = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
  if (!admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;
  const matches = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!matches) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(admins)
    .set({
      passwordHash,
      tokenVersion: sql`${admins.tokenVersion} + 1`,
    })
    .where(eq(admins.id, adminId));

  res.json({ ok: true });
}
