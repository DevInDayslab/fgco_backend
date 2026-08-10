/** Razorpay test keys reject orders above ~₹2.5L on many accounts. */
export const RAZORPAY_TEST_MAX_PAISE = 25_000_000;

/** Razorpay test mode hard cap per order (₹5,00,000). */
export const RAZORPAY_TEST_HARD_MAX_PAISE = 50_000_000;

/** Default fallback when test keys cannot charge full sponsorship amounts. */
export const DEFAULT_RAZORPAY_TEST_CHARGE_PAISE = 10_000;

export function isRazorpayTestKey(keyId: string) {
  return keyId.startsWith("rzp_test_");
}

export function getRazorpayKeyMode(keyId: string | undefined) {
  if (!keyId?.trim()) return "unconfigured" as const;
  return isRazorpayTestKey(keyId) ? ("test" as const) : ("live" as const);
}

function parsePositivePaise(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveRazorpayChargeAmount(displayAmountPaise: number, keyId: string) {
  const overridePaise = parsePositivePaise(process.env.RAZORPAY_CHARGE_OVERRIDE_PAISE);
  if (overridePaise != null) {
    return {
      chargeAmountPaise: overridePaise,
      displayAmountPaise,
      isTestCharge: overridePaise !== displayAmountPaise,
    };
  }

  const testChargePaise =
    parsePositivePaise(process.env.RAZORPAY_TEST_CHARGE_PAISE) ??
    DEFAULT_RAZORPAY_TEST_CHARGE_PAISE;

  if (
    isRazorpayTestKey(keyId) &&
    displayAmountPaise > RAZORPAY_TEST_MAX_PAISE &&
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

export function formatRazorpayOrderError(
  body: string,
  keyId: string,
  amountPaise: number,
) {
  const base = parseRazorpayErrorMessage(body);
  const amountInr = (amountPaise / 100).toLocaleString("en-IN");
  const lower = base.toLowerCase();

  if (!lower.includes("maximum amount")) {
    return base;
  }

  if (isRazorpayTestKey(keyId)) {
    return `Razorpay test keys cannot charge ₹${amountInr} (limit is ₹5,00,000 per order). Use live keys (rzp_live_…) in backend/.env and restart the API, or test with the Silver tier (₹2,95,000).`;
  }

  return `Razorpay rejected ₹${amountInr}: your live account's per-transaction limit is too low for this sponsorship advance. Raise the limit in the Razorpay Dashboard (Settings → Transaction limits) or contact Razorpay support.`;
}

export function logRazorpayConfigStatus() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const mode = getRazorpayKeyMode(keyId);
  const override = process.env.RAZORPAY_CHARGE_OVERRIDE_PAISE?.trim();

  if (mode === "unconfigured") {
    console.warn("[razorpay] Not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env");
    return;
  }

  const modeLabel = mode === "test" ? "TEST (max ₹5,00,000/order)" : "LIVE";
  const overrideLabel = override ? ` — charge override ₹${(Number(override) / 100).toLocaleString("en-IN")}` : "";
  console.log(`[razorpay] ${modeLabel} keys loaded (${keyId?.slice(0, 12)}…)${overrideLabel}`);
}
