export type PasscodeDiscountType = "PERCENTAGE" | "FREE";

export function applyPasscodeDiscountToInr(
  totalInr: number,
  discountType: PasscodeDiscountType,
  discountValue: number,
): number {
  if (discountType === "FREE") {
    return 0;
  }

  const discountInr = Math.round((totalInr * discountValue) / 100);
  return Math.max(0, totalInr - discountInr);
}

export function applyPasscodeDiscountToPaise(
  totalPaise: number,
  discountType: PasscodeDiscountType,
  discountValue: number,
): number {
  const totalInr = totalPaise / 100;
  const discountedInr = applyPasscodeDiscountToInr(totalInr, discountType, discountValue);
  return Math.round(discountedInr * 100);
}
