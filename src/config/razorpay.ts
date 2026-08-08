/** Razorpay test keys reject orders above ~₹2.5L on many accounts. */
export const RAZORPAY_TEST_MAX_PAISE = 25_000_000;

export const DEFAULT_RAZORPAY_TEST_CHARGE_PAISE = 10_000;

export function isRazorpayTestKey(keyId: string) {
  return keyId.startsWith("rzp_test_");
}

export function resolveRazorpayChargeAmount(displayAmountPaise: number, keyId: string) {
  const testChargePaise = Number.parseInt(
    process.env.RAZORPAY_TEST_CHARGE_PAISE ?? String(DEFAULT_RAZORPAY_TEST_CHARGE_PAISE),
    10,
  );

  if (
    isRazorpayTestKey(keyId) &&
    displayAmountPaise > RAZORPAY_TEST_MAX_PAISE &&
    Number.isFinite(testChargePaise) &&
    testChargePaise > 0
  ) {
    return {
      chargeAmountPaise: testChargePaise,
      displayAmountPaise,
      isTestCharge: true,
    };
  }

  return {
    chargeAmountPaise: displayAmountPaise,
    displayAmountPaise,
    isTestCharge: false,
  };
}

export function parseRazorpayErrorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { description?: string; code?: string } };
    const description = parsed.error?.description?.trim();
    if (description) return description;
  } catch {
    // ignore parse errors
  }
  return "Unable to create payment order. Please try again or use bank transfer.";
}
