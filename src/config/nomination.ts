import {
  SPONSORSHIP_GST_PERCENT_LABEL,
  SPONSORSHIP_GST_RATE,
} from "./sponsorship.js";

/** Self-nomination (nominee nominating themselves). */
export const NOMINATION_SELF_FEE_INR = 20_000;

/** Nominating someone else. */
export const NOMINATION_OTHER_FEE_INR = 5_000;

/** @deprecated Use NOMINATION_SELF_FEE_INR or NOMINATION_OTHER_FEE_INR */
export const NOMINATION_FEE_INR = NOMINATION_SELF_FEE_INR;

export const NOMINATION_GST_RATE = SPONSORSHIP_GST_RATE;
export const NOMINATION_GST_PERCENT_LABEL = SPONSORSHIP_GST_PERCENT_LABEL;

export function getNominationBaseFeeInr(isSelfNomination: boolean) {
  return isSelfNomination ? NOMINATION_SELF_FEE_INR : NOMINATION_OTHER_FEE_INR;
}

export function getNominationFeeWithGstInr(isSelfNomination: boolean) {
  const baseInr = getNominationBaseFeeInr(isSelfNomination);
  const gstInr = Math.round(baseInr * NOMINATION_GST_RATE);
  return {
    baseInr,
    gstInr,
    totalInr: baseInr + gstInr,
    isSelfNomination,
  };
}

export function getNominationFeeWithGstPaise(isSelfNomination: boolean) {
  const breakdown = getNominationFeeWithGstInr(isSelfNomination);
  const basePaise = breakdown.baseInr * 100;
  const gstPaise = breakdown.gstInr * 100;
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    ...breakdown,
  };
}
