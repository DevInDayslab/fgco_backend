import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { findPasscodeByCode, resolvePasscodeForCheckout } from "../utils/passcode-resolve.js";

const passcodeCheckSchema = z.object({
  code: z.string().trim().min(1),
});

const passcodeValidateSchema = z.object({
  code: z.string().trim().min(1),
  employeeName: z.string().trim().min(1).max(255),
  employeeEmail: z.string().trim().email().max(255),
  employeePhone: z.string().trim().min(1).max(32),
});

export async function postPasscodesCheck(req: Request, res: Response) {
  const parsed = passcodeCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const row = await findPasscodeByCode(db, parsed.data.code);
  if (!row || row.isUsed) {
    res.status(400).json({ error: "Invalid or used passcode" });
    return;
  }

  res.json({ valid: true });
}

export async function postPasscodesValidate(req: Request, res: Response) {
  const parsed = passcodeValidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const result = await resolvePasscodeForCheckout(db, parsed.data.code, {
    employeeName: parsed.data.employeeName,
    employeeEmail: parsed.data.employeeEmail,
    employeePhone: parsed.data.employeePhone,
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    valid: true,
    discountType: result.passcode.discountType,
    discountValue: result.passcode.discountValue,
  });
}
