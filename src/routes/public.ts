import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import pino from "pino";
import { z } from "zod";
import {
  getNominationFeePaise,
  NOMINATION_SELF_FEE_INR,
} from "../config/nomination.js";
import {
  getSponsorshipPaymentPlan,
  getSponsorshipTier,
  SPONSORSHIP_GST_PERCENT_LABEL,
} from "../config/sponsorship.js";
import {
  formatRazorpayOrderError,
  resolveRazorpayChargeAmount,
} from "../config/razorpay.js";
import { getDb } from "../db/index.js";
import {
  contactInquiries,
  nominations,
  payments,
  sponsorshipReservations,
} from "../db/schema.js";
import { sendEmail, sendEmailAsync } from "../utils/mailer.js";
import { getNomineeEmail, getNomineePhone, isSelfNomination } from "../utils/nomination-email.js";
import { sendLiveairSMSAsync } from "../utils/sms.js";
import {
  getApplicationReceivedEmail,
  getCeoNominationEmail,
  getNominantAcknowledgementEmail,
  getNomineeNominationAcknowledgementEmail,
  getPaymentReceiptEmail,
  getSponsorshipConfirmationEmail,
} from "../utils/templates.js";

const nominationEmailLogger = pino({ name: "fg-media-hub-nomination-emails" });

const contactSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  company: z.string().max(255).optional(),
  inquiryType: z.string().max(128).optional(),
  message: z.string().min(1).max(5000),
});

const applicationSchema = z.object({
  nominationId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  nominatorName: z.string().min(1).max(255),
  nominatorEmail: z.string().email().max(255),
  nominatorPhone: z.string().min(10).max(32),
  nomineeName: z.string().min(1).max(255),
  category: z.string().min(1).max(255),
  formData: z.record(z.unknown()),
  profilePhotoKey: z.string().min(1).max(512),
  supportingDocsKey: z.string().max(512).optional(),
  videoKey: z.string().max(512).optional(),
});

const nominationCreateOrderSchema = z.object({
  nominatorName: z.string().min(1).max(255),
  nominatorEmail: z.string().email().max(255),
  nominatorPhone: z.string().min(10).max(32),
  nomineeName: z.string().min(1).max(255),
  nomineeEmail: z.string().email().max(255),
  category: z.string().min(1).max(255),
  relationship: z.string().max(255).optional(),
});

const nominationPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  amountPaise: z.number().int().positive(),
  basePaise: z.number().int().nonnegative().optional(),
  gstPaise: z.number().int().nonnegative().optional(),
  nominatorName: z.string().min(1).max(255).optional(),
  nominatorEmail: z.string().email().max(255).optional(),
  nominatorPhone: z.string().min(10).max(32).optional(),
  nomineeName: z.string().min(1).max(255).optional(),
  nomineeEmail: z.string().email().max(255).optional(),
  category: z.string().max(255).optional(),
  relationship: z.string().max(255).optional(),
});

const sponsorshipRegisterSchema = z.object({
  tierId: z.string().min(1).max(64),
  tierName: z.string().min(1).max(255),
  company: z.string().min(1).max(255),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().min(10).max(32),
  message: z.string().max(2000).optional(),
});

const sponsorshipCreateOrderSchema = z.object({
  tierId: z.enum(["super", "power", "golden", "silver", "circle"]),
  company: z.string().min(1).max(255),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().min(10).max(32),
  reservationId: z.string().uuid().optional(),
});

const sponsorshipPaymentSchema = z.object({
  reservationId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  amountPaise: z.number().int().positive(),
  basePaise: z.number().int().nonnegative().optional(),
  gstPaise: z.number().int().nonnegative().optional(),
});

function makeReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const expected = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return expected === signature;
}

async function assertNominationPaymentUsable(
  db: NonNullable<ReturnType<typeof getDb>>,
  paymentId: string,
) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!payment || payment.type !== "nomination" || payment.status !== "paid") {
    return { ok: false as const, error: "Valid nomination payment is required" };
  }

  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
  if (metadata.nominationId) {
    return { ok: false as const, error: "This payment has already been used" };
  }

  return { ok: true as const, payment };
}

async function linkNominationPayment(
  db: NonNullable<ReturnType<typeof getDb>>,
  paymentId: string,
  nominationId: string,
  referenceId: string,
  existingMetadata: Record<string, unknown>,
) {
  await db
    .update(payments)
    .set({
      metadata: {
        ...existingMetadata,
        nominationId,
        referenceId,
      },
    })
    .where(eq(payments.id, paymentId));
}

async function sendPaymentReceiptOnce(
  db: NonNullable<ReturnType<typeof getDb>>,
  payment: { id: string; amountPaise: number; metadata: unknown },
  payerName: string,
  payerEmail: string | null | undefined,
  razorpayPaymentId: string,
) {
  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
  if (metadata.receiptEmailSent === true || !payerEmail) {
    return;
  }

  const receipt = getPaymentReceiptEmail(
    payerName,
    payment.amountPaise / 100,
    razorpayPaymentId,
  );
  sendEmailAsync(payerEmail, receipt.subject, receipt.html);

  const contactPhone =
    typeof metadata.contactPhone === "string" ? metadata.contactPhone : null;
  if (contactPhone) {
    sendLiveairSMSAsync(contactPhone, "PAYMENT_RECEIPT", [
      payerName,
      payment.amountPaise / 100,
      razorpayPaymentId,
    ]);
  }

  await db
    .update(payments)
    .set({
      metadata: {
        ...metadata,
        receiptEmailSent: true,
      },
    })
    .where(eq(payments.id, payment.id));
}

async function sendSponsorshipConfirmationOnce(
  db: NonNullable<ReturnType<typeof getDb>>,
  payment: {
    id: string;
    amountPaise: number;
    basePaise: number;
    gstPaise: number;
    metadata: unknown;
  },
  reservation: {
    referenceId: string | null;
    tierId: string;
    tierName: string;
    company: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
  },
  razorpayPaymentId: string,
) {
  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
  if (metadata.receiptEmailSent === true || !reservation.contactEmail) {
    return;
  }

  const tier = getSponsorshipTier(reservation.tierId);
  const plan = getSponsorshipPaymentPlan(reservation.tierId);
  const committedAmountInr = plan?.packageInr ?? tier?.amountInr ?? Math.round(payment.basePaise / 100);
  const advanceBaseInr = plan?.razorpayBaseInr ?? Math.round(payment.basePaise / 100);
  const gstPaidInr = plan?.razorpayGstInr ?? Math.round(payment.gstPaise / 100);
  const amountPaidInr = plan?.razorpayTotalInr ?? Math.round(payment.amountPaise / 100);
  const balanceTotalInr = plan?.balanceTotalInr ?? 0;
  const committedTotalInr = plan?.committedTotalInr ?? committedAmountInr;

  const confirmation = getSponsorshipConfirmationEmail({
    contactName: reservation.contactName,
    company: reservation.company,
    tierName: reservation.tierName || tier?.name || "HIT ViERA Sponsor",
    referenceId: reservation.referenceId ?? reservation.tierId,
    committedAmountInr,
    committedTotalInr,
    advanceBaseInr,
    gstPaidInr,
    amountPaidInr,
    balanceTotalInr,
    transactionId: razorpayPaymentId,
  });

  sendEmailAsync(reservation.contactEmail, confirmation.subject, confirmation.html);

  sendLiveairSMSAsync(reservation.contactPhone, "SPONSOR_CONFIRMATION", [
    reservation.contactName,
    reservation.tierName || tier?.name || "HIT ViERA Sponsor",
  ]);

  await db
    .update(payments)
    .set({
      metadata: {
        ...metadata,
        receiptEmailSent: true,
        sponsorshipConfirmationSent: true,
      },
    })
    .where(eq(payments.id, payment.id));
}

function verifyRazorpayWebhookSignature(body: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isCompletedNominationStatus(status: string): boolean {
  return status === "under_review" || status === "paid";
}

async function findNominationByNomineeEmail(
  db: NonNullable<ReturnType<typeof getDb>>,
  nomineeEmail: string,
) {
  const normalized = normalizeEmail(nomineeEmail);
  const [row] = await db
    .select()
    .from(nominations)
    .where(eq(nominations.nomineeEmail, normalized))
    .limit(1);
  return row ?? null;
}

function queueApplicationEmails(params: {
  isSelf: boolean;
  nomineeName: string;
  nomineeEmail: string;
  nominatorName: string;
  nominatorEmail: string;
  nominatorPhone: string;
  nomineePhone: string;
  category: string;
  referenceId?: string;
  paymentId?: string;
  paymentAmountPaise?: number;
  razorpayPaymentId?: string;
  skipReceipt?: boolean;
  paymentMetadata?: Record<string, unknown>;
}) {
  void (async () => {
    const messages: Array<{ to: string; subject: string; html: string; label: string }> = [];

    if (params.isSelf) {
      const ceo = getCeoNominationEmail(params.nomineeName, params.nominatorName);
      messages.push({
        to: params.nomineeEmail,
        subject: ceo.subject,
        html: ceo.html,
        label: "ceo_letter",
      });
      const app = getApplicationReceivedEmail(params.nomineeName);
      messages.push({
        to: params.nomineeEmail,
        subject: app.subject,
        html: app.html,
        label: "application_ack",
      });
      if (params.nominatorPhone) {
        sendLiveairSMSAsync(params.nominatorPhone, "SELF_NOMINATION_ACK", [
          params.nomineeName,
          params.category,
          params.referenceId ?? "Pending",
        ]);
      }
    } else {
      if (!params.skipReceipt && params.paymentAmountPaise != null && params.razorpayPaymentId) {
        const receipt = getPaymentReceiptEmail(
          params.nominatorName,
          params.paymentAmountPaise / 100,
          params.razorpayPaymentId,
        );
        messages.push({
          to: params.nominatorEmail,
          subject: receipt.subject,
          html: receipt.html,
          label: "payment_receipt",
        });
        if (params.nominatorPhone) {
          sendLiveairSMSAsync(params.nominatorPhone, "PAYMENT_RECEIPT", [
            params.nominatorName,
            params.paymentAmountPaise / 100,
            params.razorpayPaymentId,
          ]);
        }
      }
      const ack = getNominantAcknowledgementEmail(params.nominatorName, params.nomineeName);
      messages.push({
        to: params.nominatorEmail,
        subject: ack.subject,
        html: ack.html,
        label: "nominator_ack",
      });
      if (params.nominatorPhone) {
        sendLiveairSMSAsync(params.nominatorPhone, "NOMINANT_ACK", [
          params.nominatorName,
          params.nomineeName,
          params.category,
        ]);
      }
      const ceo = getCeoNominationEmail(params.nomineeName, params.nominatorName);
      messages.push({
        to: params.nomineeEmail,
        subject: ceo.subject,
        html: ceo.html,
        label: "ceo_letter",
      });
      const nomineeAck = getNomineeNominationAcknowledgementEmail(
        params.nomineeName,
        params.nominatorName,
        params.category,
      );
      messages.push({
        to: params.nomineeEmail,
        subject: nomineeAck.subject,
        html: nomineeAck.html,
        label: "nominee_ack",
      });
      if (params.nomineePhone) {
        sendLiveairSMSAsync(params.nomineePhone, "NOMINEE_NOTIFICATION", [
          params.nomineeName,
          params.category,
          params.nominatorName,
        ]);
      }
    }

    let receiptDelivered = params.skipReceipt === true || params.isSelf;

    console.log(
      `[mail] QUEUE nomination emails — ${messages.length} message(s)`,
      JSON.stringify({
        isSelf: params.isSelf,
        nomineeEmail: params.nomineeEmail,
        nominatorEmail: params.nominatorEmail,
        labels: messages.map((m) => m.label),
      }),
    );

    for (const message of messages) {
      try {
        const sent = await sendEmail(message.to, message.subject, message.html);
        if (sent) {
          nominationEmailLogger.info(
            { to: message.to, label: message.label },
            "Nomination email sent",
          );
          if (message.label === "payment_receipt") {
            receiptDelivered = true;
          }
        } else {
          nominationEmailLogger.warn(
            { to: message.to, label: message.label },
            "Nomination email skipped or failed",
          );
        }
      } catch (err) {
        nominationEmailLogger.error(
          { err, to: message.to, label: message.label },
          "Nomination email send error",
        );
      }
    }

    if (receiptDelivered && params.paymentId) {
      const db = getDb();
      if (db) {
        const metadata = params.paymentMetadata ?? {};
        await db
          .update(payments)
          .set({
            metadata: {
              ...metadata,
              receiptEmailSent: true,
            },
          })
          .where(eq(payments.id, params.paymentId));
      }
    }
  })();
}

export async function postContact(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { name, email, company, inquiryType, message } = parsed.data;

  await db.insert(contactInquiries).values({
    id: randomUUID(),
    name,
    email,
    company: company ?? null,
    inquiryType: inquiryType ?? null,
    message,
  });

  res.status(201).json({ ok: true });
}

export async function postApplication(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const applicantEmail = getNomineeEmail(data.formData);
  if (!applicantEmail) {
    res.status(400).json({ error: "Nominee email is required in formData" });
    return;
  }

  const nomineeEmail = normalizeEmail(applicantEmail);
  const nominatorEmail = normalizeEmail(data.nominatorEmail);
  const selfNomination = isSelfNomination(data.formData, nominatorEmail, nomineeEmail);

  async function dispatchApplicationEmails(
    payment:
      | {
          id: string;
          amountPaise: number;
          razorpayPaymentId: string | null;
          metadata: unknown;
        }
      | null,
    referenceId?: string | null,
  ) {
    const nomineePhone = getNomineePhone(data.formData);
    const commonParams = {
      isSelf: selfNomination,
      nomineeName: data.nomineeName,
      nomineeEmail,
      nominatorName: data.nominatorName,
      nominatorEmail,
      nominatorPhone: data.nominatorPhone,
      nomineePhone,
      category: data.category,
      referenceId: referenceId ?? undefined,
    };

    if (!payment) {
      queueApplicationEmails({
        ...commonParams,
        skipReceipt: true,
      });
      return;
    }

    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
    const skipReceipt = metadata.receiptEmailSent === true;
    const razorpayPaymentId =
      payment.razorpayPaymentId ??
      (typeof metadata.razorpayPaymentId === "string" ? metadata.razorpayPaymentId : undefined);

    queueApplicationEmails({
      ...commonParams,
      paymentId: payment.id,
      paymentAmountPaise: payment.amountPaise,
      razorpayPaymentId: typeof razorpayPaymentId === "string" ? razorpayPaymentId : undefined,
      skipReceipt,
      paymentMetadata: metadata,
    });
  }

  async function finalizePaidApplication(params: {
    nominationId: string;
    referenceId: string | null;
    existingFormData?: Record<string, unknown>;
    existingPaymentId?: string | null;
  }) {
    let paymentId = params.existingPaymentId ?? null;
    let paymentRow:
      | {
          id: string;
          amountPaise: number;
          razorpayPaymentId: string | null;
          metadata: unknown;
        }
      | null = null;

    if (paymentId) {
      const [existingPayment] = await db!
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1);
      paymentRow = existingPayment ?? null;
    } else {
      if (!data.paymentId) {
        res.status(400).json({ error: "Nomination fee payment is required" });
        return null;
      }

      const paymentCheck = await assertNominationPaymentUsable(db!, data.paymentId);
      if (!paymentCheck.ok) {
        res.status(400).json({ error: paymentCheck.error });
        return null;
      }

      paymentId = data.paymentId;
      paymentRow = paymentCheck.payment;
      await linkNominationPayment(
        db!,
        paymentId,
        params.nominationId,
        params.referenceId ?? makeReference("APP"),
        (paymentCheck.payment.metadata ?? {}) as Record<string, unknown>,
      );
    }

    const referenceId = params.referenceId ?? makeReference("APP");
    await db!
      .update(nominations)
      .set({
        status: "under_review",
        reviewStatus: "pending",
        paymentId,
        paymentStatus: "paid",
        nomineeEmail,
        nominatorName: data.nominatorName,
        nominatorEmail,
        nominatorPhone: data.nominatorPhone,
        nomineeName: data.nomineeName,
        category: data.category,
        profilePhotoKey: data.profilePhotoKey,
        supportingDocsKey: data.supportingDocsKey ?? null,
        videoKey: data.videoKey ?? null,
        formData: {
          ...(params.existingFormData ?? {}),
          ...data.formData,
          nomineeEmail,
          nominatorEmail,
          submissionType: "full_application",
        },
        referenceId,
      })
      .where(eq(nominations.id, params.nominationId));

    await dispatchApplicationEmails(paymentRow, referenceId);
    return { id: params.nominationId, referenceId };
  }

  if (data.nominationId) {
    const [existing] = await db
      .select()
      .from(nominations)
      .where(eq(nominations.id, data.nominationId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Linked nomination not found" });
      return;
    }

    const existingFormData =
      existing.formData && typeof existing.formData === "object" && !Array.isArray(existing.formData)
        ? (existing.formData as Record<string, unknown>)
        : {};

    const result = await finalizePaidApplication({
      nominationId: existing.id,
      referenceId: existing.referenceId,
      existingFormData,
      existingPaymentId: existing.paymentId,
    });
    if (!result) return;

    res.status(200).json({ ok: true, id: result.id, referenceId: result.referenceId });
    return;
  }

  const existingByEmail = await findNominationByNomineeEmail(db, nomineeEmail);
  if (existingByEmail) {
    if (
      isCompletedNominationStatus(existingByEmail.status) ||
      existingByEmail.paymentStatus === "paid"
    ) {
      res.status(409).json({
        error: "An application for this email has already been completed and is under review.",
        code: "ALREADY_COMPLETED",
      });
      return;
    }

    if (
      existingByEmail.status === "draft" ||
      existingByEmail.status === "pending_payment"
    ) {
      const existingFormData =
        existingByEmail.formData &&
        typeof existingByEmail.formData === "object" &&
        !Array.isArray(existingByEmail.formData)
          ? (existingByEmail.formData as Record<string, unknown>)
          : {};

      const result = await finalizePaidApplication({
        nominationId: existingByEmail.id,
        referenceId: existingByEmail.referenceId,
        existingFormData,
        existingPaymentId: existingByEmail.paymentId,
      });
      if (!result) return;

      res.status(200).json({ ok: true, id: result.id, referenceId: result.referenceId });
      return;
    }

    res.status(409).json({
      error: "A nomination for this email already exists.",
      code: "DUPLICATE_NOMINEE",
    });
    return;
  }

  if (!data.paymentId) {
    res.status(400).json({ error: "Nomination fee payment is required" });
    return;
  }

  const paymentCheck = await assertNominationPaymentUsable(db, data.paymentId);
  if (!paymentCheck.ok) {
    res.status(400).json({ error: paymentCheck.error });
    return;
  }

  const nominationId = randomUUID();
  const referenceId = makeReference("APP");

  await db.insert(nominations).values({
    id: nominationId,
    referenceId,
    status: "under_review",
    reviewStatus: "pending",
    paymentId: data.paymentId,
    paymentStatus: "paid",
    nomineeEmail,
    nominatorName: data.nominatorName,
    nominatorEmail,
    nominatorPhone: data.nominatorPhone,
    nomineeName: data.nomineeName,
    category: data.category,
    profilePhotoKey: data.profilePhotoKey,
    supportingDocsKey: data.supportingDocsKey ?? null,
    videoKey: data.videoKey ?? null,
    formData: {
      ...data.formData,
      nomineeEmail,
      nominatorEmail,
      submissionType: "full_application",
    },
  });

  await linkNominationPayment(
    db,
    data.paymentId,
    nominationId,
    referenceId,
    (paymentCheck.payment.metadata ?? {}) as Record<string, unknown>,
  );

  await dispatchApplicationEmails(paymentCheck.payment, referenceId);

  res.status(201).json({ ok: true, id: nominationId, referenceId });
}

const checkNomineeEmailSchema = z.object({
  email: z.string().email().max(255),
});

export async function postCheckNomineeEmail(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = checkNomineeEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email", details: parsed.error.flatten() });
    return;
  }

  const nomineeEmail = normalizeEmail(parsed.data.email);
  const existing = await findNominationByNomineeEmail(db, nomineeEmail);

  if (!existing) {
    res.json({ ok: true, available: true });
    return;
  }

  if (isCompletedNominationStatus(existing.status) || existing.paymentStatus === "paid") {
    res.status(409).json({
      ok: false,
      available: false,
      code: "ALREADY_COMPLETED",
      error: "An application for this email has already been completed and is under review.",
    });
    return;
  }

  if (existing.status === "draft" || existing.status === "pending_payment") {
    res.json({ ok: true, available: true, resumable: true });
    return;
  }

  res.status(409).json({
    ok: false,
    available: false,
    code: "DUPLICATE_NOMINEE",
    error: "A nomination for this email already exists.",
  });
}

export async function postNominationCreateOrder(req: Request, res: Response) {
  try {
    const parsed = nominationCreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      res.status(503).json({ error: "Payment gateway is not configured" });
      return;
    }

    const nominatorEmail = normalizeEmail(parsed.data.nominatorEmail);
    const nomineeEmail = normalizeEmail(parsed.data.nomineeEmail);
    const isSelf = isSelfNomination(
      { relationship: parsed.data.relationship },
      nominatorEmail,
      nomineeEmail,
    );

    const pricing = getNominationFeePaise(isSelf);
    const { chargeAmountPaise, displayAmountPaise, isTestCharge } = resolveRazorpayChargeAmount(
      pricing.totalPaise,
      keyId,
    );
    const receipt = `nomination_${Date.now()}`;
    const feeTypeLabel = isSelf ? "Self-nomination" : "Nominating another person";

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: chargeAmountPaise,
        currency: "INR",
        receipt,
        notes: {
          nominatorName: parsed.data.nominatorName,
          nominatorEmail: parsed.data.nominatorEmail,
          nominatorPhone: parsed.data.nominatorPhone,
          nomineeName: parsed.data.nomineeName,
          nomineeEmail: parsed.data.nomineeEmail,
          category: parsed.data.category,
          isSelfNomination: isSelf ? "true" : "false",
          paymentType: "nomination_fee",
          basePaise: String(pricing.basePaise),
          gstPaise: String(pricing.gstPaise),
          totalPaise: String(pricing.totalPaise),
          displayAmountPaise: String(displayAmountPaise),
          isTestCharge: isTestCharge ? "true" : "false",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Razorpay nomination order error:", errorBody);
      res.status(400).json({
        error: formatRazorpayOrderError(errorBody, keyId, chargeAmountPaise),
      });
      return;
    }

    const order = (await response.json()) as { id: string };

    res.json({
      orderId: order.id,
      amount: chargeAmountPaise,
      displayAmountPaise,
      basePaise: pricing.basePaise,
      gstPaise: pricing.gstPaise,
      totalPaise: pricing.totalPaise,
      isTestCharge,
      currency: "INR",
      keyId,
      feeLabel: `${feeTypeLabel} — ₹ ${pricing.totalInr.toLocaleString("en-IN")}`,
      isSelfNomination: isSelf,
    });
  } catch (err) {
    console.error("Nomination create-order error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unable to create payment order",
    });
  }
}

export async function postNominationPayment(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = nominationPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    amountPaise,
    basePaise,
    gstPaise,
    nominatorName,
    nominatorEmail,
    nominatorPhone,
    nomineeName,
    nomineeEmail,
    category,
    relationship,
  } = parsed.data;

  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    res.status(400).json({ error: "Payment verification failed" });
    return;
  }

  const [existingPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  if (existingPayment) {
    if (existingPayment.status !== "paid") {
      res.status(400).json({ error: "Payment verification failed" });
      return;
    }

    res.json({ ok: true, paymentId: existingPayment.id });
    return;
  }

  const paymentId = randomUUID();
  const isSelf =
    nominatorEmail && nomineeEmail
      ? isSelfNomination({ relationship }, normalizeEmail(nominatorEmail), normalizeEmail(nomineeEmail))
      : basePaise === NOMINATION_SELF_FEE_INR * 100;
  const pricing = getNominationFeePaise(isSelf);
  const base = basePaise ?? pricing.basePaise;
  const gst = gstPaise ?? pricing.gstPaise;
  const paymentMetadata = {
    paymentType: "nomination_fee",
    baseInr: pricing.baseInr,
    gstInr: pricing.gstInr,
    isSelfNomination: isSelf,
    contactName: nominatorName ?? null,
    contactEmail: nominatorEmail ?? null,
    contactPhone: nominatorPhone ?? null,
    nomineeName: nomineeName ?? null,
    nomineeEmail: nomineeEmail ?? null,
    category: category ?? null,
    receiptEmailSent: false,
  };

  await db.insert(payments).values({
    id: paymentId,
    type: "nomination",
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise,
    basePaise: base,
    gstPaise: gst,
    status: "paid",
    metadata: paymentMetadata,
  });

  res.json({ ok: true, paymentId });
}

export async function postSponsorshipCreateOrder(req: Request, res: Response) {
  try {
    const parsed = sponsorshipCreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const tier = getSponsorshipTier(parsed.data.tierId);
    if (!tier) {
      res.status(400).json({ error: "Invalid sponsorship tier" });
      return;
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      res.status(503).json({ error: "Payment gateway is not configured" });
      return;
    }

    const pricing = getSponsorshipPaymentPlan(parsed.data.tierId);
    if (!pricing) {
      res.status(400).json({ error: "Invalid sponsorship tier" });
      return;
    }

    const chargeAmountPaise = pricing.totalPaise;
    const displayAmountPaise = pricing.totalPaise;
    const isTestCharge = false;
    const receipt = `sponsor_${parsed.data.tierId}_${Date.now()}`;

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: chargeAmountPaise,
        currency: "INR",
        receipt,
        notes: {
          tierId: parsed.data.tierId,
          tierName: tier.name,
          company: parsed.data.company,
          contactName: parsed.data.contactName,
          contactEmail: parsed.data.contactEmail,
          contactPhone: parsed.data.contactPhone,
          ...(parsed.data.reservationId ? { reservationId: parsed.data.reservationId } : {}),
          paymentType: "sponsorship_advance",
          basePaise: String(pricing.basePaise),
          gstPaise: String(pricing.gstPaise),
          totalPaise: String(pricing.totalPaise),
          committedTotalPaise: String(pricing.committedTotalInr * 100),
          balanceTotalPaise: String(pricing.balanceTotalInr * 100),
          displayAmountPaise: String(displayAmountPaise),
          isTestCharge: "false",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Razorpay order error:", errorBody);
      res.status(400).json({
        error: formatRazorpayOrderError(errorBody, keyId, chargeAmountPaise),
      });
      return;
    }

    const order = (await response.json()) as { id: string };

    res.json({
      orderId: order.id,
      amount: chargeAmountPaise,
      displayAmountPaise,
      basePaise: pricing.basePaise,
      gstPaise: pricing.gstPaise,
      totalPaise: pricing.totalPaise,
      isTestCharge,
      currency: "INR",
      keyId,
      tierName: tier.name,
      advanceLabel: `Razorpay payment — ₹ ${pricing.razorpayTotalInr.toLocaleString("en-IN")} incl. ${SPONSORSHIP_GST_PERCENT_LABEL} GST (balance ₹ ${pricing.balanceTotalInr.toLocaleString("en-IN")} via bank transfer)`,
    });
  } catch (err) {
    console.error("Sponsorship create-order error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unable to create payment order",
    });
  }
}

export async function postSponsorshipRegister(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = sponsorshipRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const id = randomUUID();
  const referenceId = makeReference("SPON");

  await db.insert(sponsorshipReservations).values({
    id,
    referenceId,
    tierId: parsed.data.tierId,
    tierName: parsed.data.tierName,
    company: parsed.data.company,
    contactName: parsed.data.contactName,
    contactEmail: parsed.data.contactEmail,
    contactPhone: parsed.data.contactPhone,
    message: parsed.data.message ?? null,
    status: "pending",
  });

  res.status(201).json({ ok: true, id, referenceId });
}

export async function postSponsorshipPayment(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = sponsorshipPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const {
    reservationId,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    amountPaise,
    basePaise,
    gstPaise,
  } = parsed.data;

  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    res.status(400).json({ error: "Payment verification failed" });
    return;
  }

  const [reservation] = await db
    .select()
    .from(sponsorshipReservations)
    .where(eq(sponsorshipReservations.id, reservationId))
    .limit(1);

  if (!reservation) {
    res.status(404).json({ error: "Sponsorship reservation not found" });
    return;
  }

  const [existingPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  if (existingPayment) {
    if (existingPayment.status !== "paid") {
      res.status(400).json({ error: "Payment verification failed" });
      return;
    }

    await sendSponsorshipConfirmationOnce(
      db,
      existingPayment,
      reservation,
      razorpayPaymentId,
    );

    await db
      .update(sponsorshipReservations)
      .set({ status: "confirmed", paymentId: existingPayment.id })
      .where(eq(sponsorshipReservations.id, reservationId));

    res.json({ ok: true, paymentId: existingPayment.id });
    return;
  }

  const paymentId = randomUUID();
  const pricing = getSponsorshipPaymentPlan(reservation.tierId);
  const base = pricing?.basePaise ?? basePaise ?? amountPaise;
  const gst = pricing?.gstPaise ?? gstPaise ?? 0;
  const recordedAmount = pricing?.totalPaise ?? amountPaise;
  const paymentMetadata = {
    reservationId,
    tierId: reservation.tierId,
    company: reservation.company,
    contactName: reservation.contactName,
    contactEmail: reservation.contactEmail,
    contactPhone: reservation.contactPhone,
    committedTotalInr: pricing?.committedTotalInr,
    balanceTotalInr: pricing?.balanceTotalInr,
    receiptEmailSent: false,
  };

  await db.insert(payments).values({
    id: paymentId,
    type: "sponsorship",
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise: recordedAmount,
    basePaise: base,
    gstPaise: gst,
    status: "paid",
    metadata: paymentMetadata,
  });

  await sendSponsorshipConfirmationOnce(
    db,
    { id: paymentId, amountPaise: recordedAmount, basePaise: base, gstPaise: gst, metadata: paymentMetadata },
    reservation,
    razorpayPaymentId,
  );

  await db
    .update(sponsorshipReservations)
    .set({ status: "confirmed", paymentId })
    .where(eq(sponsorshipReservations.id, reservationId));

  res.json({ ok: true, paymentId });
}

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        email?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

export async function postPaymentsWebhook(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Invalid webhook body" });
    return;
  }

  const signature = req.headers["x-razorpay-signature"];
  if (typeof signature !== "string" || !verifyRazorpayWebhookSignature(rawBody, signature)) {
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  if (payload.event !== "payment.captured") {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const paymentEntity = payload.payload?.payment?.entity;
  const razorpayPaymentId = paymentEntity?.id;
  const razorpayOrderId = paymentEntity?.order_id;
  const amountPaise = paymentEntity?.amount;
  const notes = paymentEntity?.notes ?? {};

  if (!razorpayPaymentId || !razorpayOrderId || !amountPaise) {
    res.status(400).json({ error: "Incomplete payment payload" });
    return;
  }

  const [existingPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  if (existingPayment) {
    const metadata = (existingPayment.metadata ?? {}) as Record<string, unknown>;
    const payerEmail =
      typeof metadata.contactEmail === "string"
        ? metadata.contactEmail
        : (paymentEntity.email ?? notes.contactEmail ?? notes.nominatorEmail);
    const payerName =
      typeof metadata.contactName === "string"
        ? metadata.contactName
        : (notes.contactName ?? notes.nominatorName ?? "Valued Customer");

    if (existingPayment.type === "sponsorship") {
      const reservationId =
        typeof metadata.reservationId === "string" ? metadata.reservationId : null;
      if (reservationId) {
        const [reservation] = await db
          .select()
          .from(sponsorshipReservations)
          .where(eq(sponsorshipReservations.id, reservationId))
          .limit(1);
        if (reservation) {
          await sendSponsorshipConfirmationOnce(
            db,
            existingPayment,
            reservation,
            razorpayPaymentId,
          );
          await db
            .update(sponsorshipReservations)
            .set({ status: "confirmed", paymentId: existingPayment.id })
            .where(eq(sponsorshipReservations.id, reservation.id));
          res.status(200).json({ ok: true });
          return;
        }
      }
    }

    if (existingPayment.type === "nomination") {
      res.status(200).json({ ok: true });
      return;
    }

    await sendPaymentReceiptOnce(
      db,
      existingPayment,
      payerName,
      payerEmail,
      razorpayPaymentId,
    );

    res.status(200).json({ ok: true });
    return;
  }

  const payerEmail = paymentEntity.email ?? notes.contactEmail ?? notes.nominatorEmail;
  const payerName = notes.contactName ?? notes.nominatorName ?? notes.company ?? "Valued Customer";
  const paymentType = notes.paymentType === "nomination_fee" ? "nomination" : "sponsorship";
  const basePaise = notes.basePaise ? Number.parseInt(notes.basePaise, 10) : amountPaise;
  const gstPaise = notes.gstPaise ? Number.parseInt(notes.gstPaise, 10) : 0;

  const paymentId = randomUUID();
  const paymentMetadata = {
    contactName: payerName,
    contactEmail: payerEmail ?? null,
    contactPhone: notes.contactPhone ?? notes.nominatorPhone ?? null,
    company: notes.company ?? null,
    tierId: notes.tierId ?? null,
    nomineeName: notes.nomineeName ?? null,
    category: notes.category ?? null,
    reservationId: notes.reservationId ?? null,
    receiptEmailSent: false,
    source: "webhook",
  };

  await db.insert(payments).values({
    id: paymentId,
    type: paymentType,
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise,
    basePaise: Number.isFinite(basePaise) ? basePaise : amountPaise,
    gstPaise: Number.isFinite(gstPaise) ? gstPaise : 0,
    status: "paid",
    metadata: paymentMetadata,
  });

  if (paymentType === "sponsorship" && typeof notes.reservationId === "string") {
    const [reservation] = await db
      .select()
      .from(sponsorshipReservations)
      .where(eq(sponsorshipReservations.id, notes.reservationId))
      .limit(1);
    if (reservation) {
      await sendSponsorshipConfirmationOnce(
        db,
        {
          id: paymentId,
          amountPaise,
          basePaise: Number.isFinite(basePaise) ? basePaise : amountPaise,
          gstPaise: Number.isFinite(gstPaise) ? gstPaise : 0,
          metadata: paymentMetadata,
        },
        reservation,
        razorpayPaymentId,
      );
      await db
        .update(sponsorshipReservations)
        .set({ status: "confirmed", paymentId })
        .where(eq(sponsorshipReservations.id, reservation.id));
      res.status(200).json({ ok: true });
      return;
    }
  }

  if (paymentType === "nomination") {
    res.status(200).json({ ok: true });
    return;
  }

  await sendPaymentReceiptOnce(
    db,
    { id: paymentId, amountPaise, metadata: paymentMetadata },
    payerName,
    payerEmail,
    razorpayPaymentId,
  );

  res.status(200).json({ ok: true });
}
