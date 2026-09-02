import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { passcodes } from "../db/schema.js";
import { generateUniquePasscodeCodes } from "../utils/passcode.js";

const passcodeGenerateSchema = z
  .object({
    employeeName: z.string().trim().min(1).max(255),
    employeeEmail: z.string().trim().email().max(255),
    employeePhone: z.string().trim().min(1).max(32),
    discountType: z.enum(["PERCENTAGE", "FREE"]),
    discountValue: z.number().int(),
    count: z.number().int().min(1).max(100),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === "PERCENTAGE") {
      if (data.discountValue < 1 || data.discountValue > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Percentage discount must be between 1 and 100",
          path: ["discountValue"],
        });
      }
      return;
    }

    if (data.discountValue !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Free passcodes must use discountValue 100",
        path: ["discountValue"],
      });
    }
  });

export async function postAdminPasscodesGenerate(req: Request, res: Response) {
  const parsed = passcodeGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const batchId = randomUUID();
  const { employeeName, employeeEmail, employeePhone, discountType, discountValue, count } =
    parsed.data;

  try {
    const codes = await generateUniquePasscodeCodes(db, count);
    const rows = codes.map((code) => ({
      id: randomUUID(),
      code,
      employeeName,
      employeeEmail,
      employeePhone,
      discountType,
      discountValue,
      batchId,
    }));

    await db.insert(passcodes).values(rows);

    res.status(201).json({
      batchId,
      codes: rows.map((row) => ({
        id: row.id,
        code: row.code,
        discountType: row.discountType,
        discountValue: row.discountValue,
      })),
    });
  } catch (err) {
    console.error("Passcode generation error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unable to generate passcodes",
    });
  }
}
