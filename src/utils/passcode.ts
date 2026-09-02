import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { passcodes } from "../db/schema.js";
import type * as schema from "../db/schema.js";

type Db = MySql2Database<typeof schema>;

export type EmployeeDetails = {
  employeeName: string;
  employeeEmail: string;
  employeePhone: string;
};

const PASSCODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizePasscodeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeEmployeeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeEmployeePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function normalizeEmployeeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function employeeDetailsMatch(
  stored: EmployeeDetails,
  provided: EmployeeDetails,
): boolean {
  return (
    normalizeEmployeeName(stored.employeeName) ===
      normalizeEmployeeName(provided.employeeName) &&
    normalizeEmployeeEmail(stored.employeeEmail) ===
      normalizeEmployeeEmail(provided.employeeEmail) &&
    normalizeEmployeePhone(stored.employeePhone) ===
      normalizeEmployeePhone(provided.employeePhone)
  );
}

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += PASSCODE_CHARS[bytes[i]! % PASSCODE_CHARS.length];
  }
  return result;
}

export function generatePasscodeCode(): string {
  return `HIT-${randomSegment(4)}-${randomSegment(4)}`;
}

export async function generateUniquePasscodeCodes(
  db: Db,
  count: number,
): Promise<string[]> {
  const codes: string[] = [];
  const seen = new Set<string>();
  const maxAttempts = count * 20;
  let attempts = 0;

  while (codes.length < count) {
    if (attempts >= maxAttempts) {
      throw new Error("Unable to generate enough unique passcodes");
    }

    attempts += 1;
    const code = generatePasscodeCode();
    if (seen.has(code)) {
      continue;
    }

    const [existing] = await db
      .select({ id: passcodes.id })
      .from(passcodes)
      .where(eq(passcodes.code, code))
      .limit(1);

    if (existing) {
      continue;
    }

    seen.add(code);
    codes.push(code);
  }

  return codes;
}
