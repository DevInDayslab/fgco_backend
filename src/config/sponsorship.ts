export const SPONSORSHIP_ADVANCE_PERCENT = 0.5;
export const SPONSORSHIP_ADVANCE_PERCENT_LABEL = "50%";

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
