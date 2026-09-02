import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { passcodes } from "../db/schema.js";
import type * as schema from "../db/schema.js";
import {
  employeeDetailsMatch,
  normalizePasscodeCode,
  type EmployeeDetails,
} from "./passcode.js";

type Db = MySql2Database<typeof schema>;

export type ResolvedPasscode = {
  id: string;
  code: string;
  discountType: "PERCENTAGE" | "FREE";
  discountValue: number;
};

export async function findPasscodeByCode(db: Db, code: string) {
  const normalizedCode = normalizePasscodeCode(code);
  const [row] = await db
    .select()
    .from(passcodes)
    .where(eq(passcodes.code, normalizedCode))
    .limit(1);
  return row ?? null;
}

export async function resolvePasscodeForCheckout(
  db: Db,
  code: string,
  employeeDetails: EmployeeDetails,
): Promise<{ ok: true; passcode: ResolvedPasscode } | { ok: false; error: string }> {
  const row = await findPasscodeByCode(db, code);

  if (!row || row.isUsed) {
    return { ok: false, error: "Invalid or used passcode" };
  }

  if (
    !employeeDetailsMatch(
      {
        employeeName: row.employeeName,
        employeeEmail: row.employeeEmail,
        employeePhone: row.employeePhone,
      },
      employeeDetails,
    )
  ) {
    return { ok: false, error: "Employee details do not match the referral passcode" };
  }

  return {
    ok: true,
    passcode: {
      id: row.id,
      code: row.code,
      discountType: row.discountType,
      discountValue: row.discountValue,
    },
  };
}

export async function markPasscodeUsed(db: Db, passcodeId: string) {
  await db
    .update(passcodes)
    .set({ isUsed: true, usedAt: new Date() })
    .where(eq(passcodes.id, passcodeId));
}
