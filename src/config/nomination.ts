/** Self-nomination (nominee nominating themselves). */
export const NOMINATION_SELF_FEE_INR = 20_000;

/** Nominating someone else. */
export const NOMINATION_OTHER_FEE_INR = 5_000;

/** @deprecated Use NOMINATION_SELF_FEE_INR or NOMINATION_OTHER_FEE_INR */
export const NOMINATION_FEE_INR = NOMINATION_SELF_FEE_INR;

export function getNominationBaseFeeInr(isSelfNomination: boolean) {
  return isSelfNomination ? NOMINATION_SELF_FEE_INR : NOMINATION_OTHER_FEE_INR;
}

export function getNominationFeeInr(isSelfNomination: boolean) {
  const totalInr = getNominationBaseFeeInr(isSelfNomination);
  return {
    baseInr: totalInr,
    gstInr: 0,
    totalInr,
    isSelfNomination,
  };
}

/** @deprecated Use getNominationFeeInr — nominations are flat fees with no GST split */
export function getNominationFeeWithGstInr(isSelfNomination: boolean) {
  return getNominationFeeInr(isSelfNomination);
}

export function getNominationFeePaise(isSelfNomination: boolean) {
  const breakdown = getNominationFeeInr(isSelfNomination);
  const totalPaise = breakdown.totalInr * 100;
  return {
    basePaise: totalPaise,
    gstPaise: 0,
    totalPaise,
    ...breakdown,
  };
}

/** @deprecated Use getNominationFeePaise */
export function getNominationFeeWithGstPaise(isSelfNomination: boolean) {
  return getNominationFeePaise(isSelfNomination);
}
