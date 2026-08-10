import { getSponsorshipPaymentPlan } from "../config/sponsorship.js";

type LinkedPayment = {
  status: string;
  amountPaise: number;
  razorpayPaymentId: string | null;
} | null;

export type SponsorshipAdminPaymentSummary = {
  packageInr: number;
  packageGstInr: number;
  committedTotalInr: number;
  razorpayBaseInr: number;
  razorpayGstInr: number;
  razorpayTotalInr: number;
  balanceBaseInr: number;
  balanceGstInr: number;
  balanceTotalInr: number;
  paidViaRazorpayInr: number;
  razorpayPendingInr: number;
  balancePendingInr: number;
  totalOutstandingInr: number;
  razorpayPaymentId: string | null;
  paymentRecordStatus: string | null;
};

export function buildSponsorshipAdminPaymentSummary(
  tierId: string,
  reservationStatus: string,
  payment?: LinkedPayment,
): SponsorshipAdminPaymentSummary | null {
  const plan = getSponsorshipPaymentPlan(tierId);
  if (!plan) return null;

  const razorpayPaid = payment?.status === "paid" && reservationStatus === "confirmed";
  const paidViaRazorpayInr = razorpayPaid ? payment.amountPaise / 100 : 0;
  const razorpayPendingInr = razorpayPaid ? 0 : plan.razorpayTotalInr;
  const balancePendingInr = razorpayPaid ? plan.balanceTotalInr : plan.balanceTotalInr;

  return {
    packageInr: plan.packageInr,
    packageGstInr: plan.packageGstInr,
    committedTotalInr: plan.committedTotalInr,
    razorpayBaseInr: plan.razorpayBaseInr,
    razorpayGstInr: plan.razorpayGstInr,
    razorpayTotalInr: plan.razorpayTotalInr,
    balanceBaseInr: plan.balanceBaseInr,
    balanceGstInr: plan.balanceGstInr,
    balanceTotalInr: plan.balanceTotalInr,
    paidViaRazorpayInr,
    razorpayPendingInr,
    balancePendingInr,
    totalOutstandingInr: plan.committedTotalInr - paidViaRazorpayInr,
    razorpayPaymentId: payment?.razorpayPaymentId ?? null,
    paymentRecordStatus: payment?.status ?? null,
  };
}
