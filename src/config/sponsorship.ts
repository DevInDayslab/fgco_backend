export const SPONSORSHIP_ADVANCE_PERCENT = 0.5;
export const SPONSORSHIP_ADVANCE_PERCENT_LABEL = "50%";
export const SPONSORSHIP_GST_RATE = 0.18;
export const SPONSORSHIP_GST_PERCENT_LABEL = "18%";

export const SPONSORSHIP_TIERS = [
  { id: "super", name: "Super ViERA Sponsor", amountInr: 2000000 },
  { id: "power", name: "Power ViERA Sponsor", amountInr: 1500000 },
  { id: "golden", name: "Golden ViERA Sponsor", amountInr: 1000000 },
  { id: "silver", name: "Silver ViERA Sponsor", amountInr: 500000 },
] as const;

export type SponsorshipTierId = (typeof SPONSORSHIP_TIERS)[number]["id"];

export function getSponsorshipTier(tierId: string) {
  return SPONSORSHIP_TIERS.find((tier) => tier.id === tierId);
}

export function getSponsorshipAdvanceInr(tierId: string) {
  const tier = getSponsorshipTier(tierId);
  if (!tier) return null;
  return Math.round(tier.amountInr * SPONSORSHIP_ADVANCE_PERCENT);
}

export function getSponsorshipAdvanceWithGstInr(tierId: string) {
  const baseInr = getSponsorshipAdvanceInr(tierId);
  if (baseInr == null) return null;
  const gstInr = Math.round(baseInr * SPONSORSHIP_GST_RATE);
  return {
    baseInr,
    gstInr,
    totalInr: baseInr + gstInr,
  };
}

export function getSponsorshipAdvanceWithGstPaise(tierId: string) {
  const breakdown = getSponsorshipAdvanceWithGstInr(tierId);
  if (!breakdown) return null;
  const basePaise = breakdown.baseInr * 100;
  const gstPaise = breakdown.gstInr * 100;
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    ...breakdown,
  };
}
