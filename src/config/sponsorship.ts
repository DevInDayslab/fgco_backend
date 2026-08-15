export const SPONSORSHIP_ADVANCE_PERCENT = 0.5;
export const SPONSORSHIP_ADVANCE_PERCENT_LABEL = "50%";
export const SPONSORSHIP_GST_RATE = 0.18;
export const SPONSORSHIP_GST_PERCENT_LABEL = "18%";

/** Razorpay per-order limit — sponsorship online payment is capped at this amount incl. GST. */
export const RAZORPAY_SPONSORSHIP_MAX_INR = 500_000;

export const SPONSORSHIP_TIERS = [
  { id: "super", name: "Super ViERA Sponsor", amountInr: 2000000 },
  { id: "power", name: "Power ViERA Sponsor", amountInr: 1500000 },
  { id: "golden", name: "Golden ViERA Sponsor", amountInr: 1000000 },
  { id: "silver", name: "Silver ViERA Sponsor", amountInr: 500000 },
  { id: "circle", name: "HIT ViERA Circle of Excellence", amountInr: 50000 },
] as const;

export type SponsorshipTierId = (typeof SPONSORSHIP_TIERS)[number]["id"];

export type SponsorshipPaymentPlan = {
  tierId: SponsorshipTierId;
  packageInr: number;
  packageGstInr: number;
  committedTotalInr: number;
  razorpayBaseInr: number;
  razorpayGstInr: number;
  razorpayTotalInr: number;
  balanceBaseInr: number;
  balanceGstInr: number;
  balanceTotalInr: number;
  baseInr: number;
  gstInr: number;
  totalInr: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
};

export function getSponsorshipTier(tierId: string) {
  return SPONSORSHIP_TIERS.find((tier) => tier.id === tierId);
}

export function splitInrInclGst(totalInclGst: number) {
  const baseInr = Math.round(totalInclGst / (1 + SPONSORSHIP_GST_RATE));
  const gstInr = totalInclGst - baseInr;
  return { baseInr, gstInr, totalInr: totalInclGst };
}

export function getSponsorshipPaymentPlan(tierId: string): SponsorshipPaymentPlan | null {
  const tier = getSponsorshipTier(tierId);
  if (!tier) return null;

  const packageGstInr = Math.round(tier.amountInr * SPONSORSHIP_GST_RATE);
  const committedTotalInr = tier.amountInr + packageGstInr;

  const razorpayTotalInr = Math.min(committedTotalInr, RAZORPAY_SPONSORSHIP_MAX_INR);
  const razorpay = splitInrInclGst(razorpayTotalInr);
  const balanceTotalInr = Math.max(0, committedTotalInr - razorpayTotalInr);
  const balance = splitInrInclGst(balanceTotalInr);

  return {
    tierId: tier.id,
    packageInr: tier.amountInr,
    packageGstInr,
    committedTotalInr,
    razorpayBaseInr: razorpay.baseInr,
    razorpayGstInr: razorpay.gstInr,
    razorpayTotalInr: razorpay.totalInr,
    balanceBaseInr: balance.baseInr,
    balanceGstInr: balance.gstInr,
    balanceTotalInr: balance.totalInr,
    baseInr: razorpay.baseInr,
    gstInr: razorpay.gstInr,
    totalInr: razorpay.totalInr,
    basePaise: razorpay.baseInr * 100,
    gstPaise: razorpay.gstInr * 100,
    totalPaise: razorpay.totalInr * 100,
  };
}

/** @deprecated Use getSponsorshipPaymentPlan for Razorpay checkout amounts. */
export function getSponsorshipAdvanceInr(tierId: string) {
  return getSponsorshipPaymentPlan(tierId)?.razorpayBaseInr ?? null;
}

/** @deprecated Use getSponsorshipPaymentPlan for Razorpay checkout amounts. */
export function getSponsorshipAdvanceWithGstInr(tierId: string) {
  const plan = getSponsorshipPaymentPlan(tierId);
  if (!plan) return null;
  return {
    baseInr: plan.razorpayBaseInr,
    gstInr: plan.razorpayGstInr,
    totalInr: plan.razorpayTotalInr,
  };
}

/** Razorpay order amount (₹5,00,000 incl. GST) and balance metadata. */
export function getSponsorshipAdvanceWithGstPaise(tierId: string) {
  return getSponsorshipPaymentPlan(tierId);
}
