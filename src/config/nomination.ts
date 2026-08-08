import {
  SPONSORSHIP_GST_PERCENT_LABEL,
  SPONSORSHIP_GST_RATE,
} from "./sponsorship.js";

export const NOMINATION_FEE_INR = 20_000;
export const NOMINATION_GST_RATE = SPONSORSHIP_GST_RATE;
export const NOMINATION_GST_PERCENT_LABEL = SPONSORSHIP_GST_PERCENT_LABEL;

export function getNominationFeeWithGstInr() {
  const baseInr = NOMINATION_FEE_INR;
  const gstInr = Math.round(baseInr * NOMINATION_GST_RATE);
  return {
    baseInr,
    gstInr,
    totalInr: baseInr + gstInr,
  };
}

export function getNominationFeeWithGstPaise() {
  const breakdown = getNominationFeeWithGstInr();
  const basePaise = breakdown.baseInr * 100;
  const gstPaise = breakdown.gstInr * 100;
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    ...breakdown,
  };
}
