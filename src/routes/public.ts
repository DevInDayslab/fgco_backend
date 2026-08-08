import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  getNominationFeeWithGstPaise,
  NOMINATION_GST_PERCENT_LABEL,
} from "../config/nomination.js";
import {
  getSponsorshipAdvanceWithGstPaise,
  getSponsorshipTier,
  SPONSORSHIP_ADVANCE_PERCENT_LABEL,
  SPONSORSHIP_GST_PERCENT_LABEL,
} from "../config/sponsorship.js";
import {
  parseRazorpayErrorMessage,
  resolveRazorpayChargeAmount,
} from "../config/razorpay.js";
import { getDb } from "../db/index.js";
import {
  contactInquiries,
  nominations,
  payments,
  sponsorshipReservations,
} from "../db/schema.js";
import { sendEmailAsync } from "../utils/mailer.js";
import {
  getNomineeEmail,
  getNomineePhone,
  hasNominationAttachments,
  isSelfNomination,
} from "../utils/nomination-email.js";
import {
  buildNominationCompletionUrl,
  formatAwardDate,
  formatAwardDateTime,
  getApplicationReceivedEmail,
  getCeoNominationEmail,
  getNominantAcknowledgementEmail,
  getNominatorNomineeCompletedEmail,
  getPaymentReceiptEmail,
  getSponsorshipConfirmationEmail,
} from "../utils/templates.js";

const contactSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  company: z.string().max(255).optional(),
  inquiryType: z.string().max(128).optional(),
  message: z.string().min(1).max(5000),
});

const referralNominationSchema = z.object({
  nominatorName: z.string().min(1).max(255),
  nominatorOrg: z.string().max(255).optional(),
  nominatorEmail: z.string().email().max(255),
  nominatorPhone: z.string().min(10).max(32),
  relationship: z.string().min(1).max(128),
  nomineeType: z.string().min(1).max(128),
  nomineeName: z.string().min(1).max(255),
  nomineeDesignation: z.string().max(255).optional(),
  nomineeEmail: z.string().email().max(255),
  nomineePhone: z.string().min(10).max(32),
  nomineeLocation: z.string().min(1).max(255),
  nomineeSocial: z.string().max(512).optional(),
  category: z.string().min(1).max(255),
  publications: z.array(z.string()).min(1),
  executiveSummary: z.string().max(5000).optional(),
  achievement: z.string().max(10000).optional(),
  impact: z.string().max(10000).optional(),
  futureGoals: z.string().max(10000).optional(),
});

const resendCompletionLinkSchema = z.object({
  email: z.string().email().max(255),
});

const completeNominationSchema = z.object({
  token: z.string().min(1).max(64),
  paymentId: z.string().uuid(),
  profilePhotoKey: z.string().min(1).max(512),
  supportingDocsKey: z.string().max(512).optional(),
  videoKey: z.string().max(512).optional(),
  altVideoLink: z.string().max(512).optional(),
  formData: z.record(z.unknown()).optional(),
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
  category: z.string().min(1).max(255),
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
  category: z.string().max(255).optional(),
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
  tierId: z.enum(["super", "power", "golden", "silver"]),
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
  },
  razorpayPaymentId: string,
) {
  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
  if (metadata.receiptEmailSent === true || !reservation.contactEmail) {
    return;
  }

  const tier = getSponsorshipTier(reservation.tierId);
  const committedAmountInr = tier?.amountInr ?? Math.round(payment.basePaise / 50); // 50% advance fallback
  const advanceBaseInr = Math.round(payment.basePaise / 100);
  const gstPaidInr = Math.round(payment.gstPaise / 100);
  const amountPaidInr = Math.round(payment.amountPaise / 100);

  const confirmation = getSponsorshipConfirmationEmail({
    contactName: reservation.contactName,
    company: reservation.company,
    tierName: reservation.tierName || tier?.name || "HIT ViERA Sponsor",
    referenceId: reservation.referenceId ?? reservation.tierId,
    committedAmountInr,
    advanceBaseInr,
    gstPaidInr,
    amountPaidInr,
    transactionId: razorpayPaymentId,
  });

  sendEmailAsync(reservation.contactEmail, confirmation.subject, confirmation.html);

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
    .where(sql`lower(${nominations.nomineeEmail}) = ${normalized}`)
    .limit(1);
  return row ?? null;
}

function sendReferralEmails(params: {
  nomineeEmail: string;
  nomineeName: string;
  nominatorEmail: string;
  nominatorName: string;
  completionToken: string;
  includeNominatorAck?: boolean;
}) {
  const date = formatAwardDate();
  const issuedAt = formatAwardDateTime();
  const completionUrl = buildNominationCompletionUrl(params.completionToken);
  const ceo = getCeoNominationEmail(
    params.nomineeName,
    params.nominatorName,
    date,
    issuedAt,
    completionUrl,
  );

  sendEmailAsync(params.nomineeEmail, ceo.subject, ceo.html);

  if (params.includeNominatorAck !== false) {
    const ack = getNominantAcknowledgementEmail(
      params.nominatorName,
      params.nomineeName,
      issuedAt,
    );
    sendEmailAsync(params.nominatorEmail, ack.subject, ack.html);
  }
}

async function ensureCompletionToken(
  db: NonNullable<ReturnType<typeof getDb>>,
  row: { id: string; completionToken: string | null },
): Promise<string> {
  if (row.completionToken) {
    return row.completionToken;
  }
  const completionToken = randomUUID();
  await db
    .update(nominations)
    .set({ completionToken })
    .where(eq(nominations.id, row.id));
  return completionToken;
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

/** @deprecated Prefer POST /api/nominations/refer */
export async function postNomination(req: Request, res: Response) {
  return postNominationRefer(req, res);
}

export async function postNominationRefer(req: Request, res: Response) {
  try {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const parsed = referralNominationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const nomineeEmail = normalizeEmail(data.nomineeEmail);
    const nominatorEmail = normalizeEmail(data.nominatorEmail);

    if (isSelfNomination(data, nominatorEmail, nomineeEmail)) {
      res.status(400).json({
        error: "Self-nominations must use the full application flow with payment.",
        code: "SELF_NOMINATION_REQUIRED",
      });
      return;
    }

    const existing = await findNominationByNomineeEmail(db, nomineeEmail);
    if (existing) {
      if (isCompletedNominationStatus(existing.status) || existing.paymentStatus === "paid") {
        res.status(409).json({
          error: "An application for this email has already been completed and is under review.",
          code: "ALREADY_COMPLETED",
        });
        return;
      }

      if (existing.status === "referral_pending") {
        const completionToken = await ensureCompletionToken(db, existing);
        const inviteSentAt = new Date();
        await db
          .update(nominations)
          .set({ completionToken, inviteSentAt })
          .where(eq(nominations.id, existing.id));

        sendReferralEmails({
          nomineeEmail: existing.nomineeEmail,
          nomineeName: existing.nomineeName,
          nominatorEmail,
          nominatorName: data.nominatorName,
          completionToken,
          includeNominatorAck: false,
        });

        res.status(200).json({
          ok: true,
          alreadyNominated: true,
          message:
            "This candidate has already been nominated. A fresh completion link has been sent to their email.",
          id: existing.id,
          referenceId: existing.referenceId,
        });
        return;
      }

      res.status(409).json({
        error: "A nomination for this email already exists.",
        code: "DUPLICATE_NOMINEE",
      });
      return;
    }

    const id = randomUUID();
    const referenceId = makeReference("NOM");
    const completionToken = randomUUID();
    const inviteSentAt = new Date();

    const formData = {
      ...data,
      nomineeEmail,
      nominatorEmail,
      submissionType: "referral",
    };

    await db.insert(nominations).values({
      id,
      referenceId,
      status: "referral_pending",
      reviewStatus: "pending",
      paymentStatus: "unpaid",
      completionToken,
      nomineeEmail,
      inviteSentAt,
      nominatorName: data.nominatorName,
      nominatorEmail,
      nominatorPhone: data.nominatorPhone,
      nomineeName: data.nomineeName,
      category: data.category,
      profilePhotoKey: null,
      supportingDocsKey: null,
      videoKey: null,
      formData,
    });

    sendReferralEmails({
      nomineeEmail,
      nomineeName: data.nomineeName,
      nominatorEmail,
      nominatorName: data.nominatorName,
      completionToken,
    });

    res.status(201).json({ ok: true, id, referenceId });
  } catch (err) {
    console.error("Nomination refer error:", err);
    const message = err instanceof Error ? err.message : "Unable to submit nomination";
    const isMissingColumn =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ER_BAD_FIELD_ERROR";
    res.status(isMissingColumn ? 503 : 500).json({
      error: isMissingColumn
        ? "Database schema is out of date. Run npm run db:push in the backend."
        : message,
    });
  }
}

export async function getValidateNominationToken(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawToken = req.params.token;
  const token = typeof rawToken === "string" ? rawToken : rawToken?.[0];
  if (!token) {
    res.status(400).json({ error: "Missing completion token" });
    return;
  }

  const [row] = await db
    .select()
    .from(nominations)
    .where(eq(nominations.completionToken, token))
    .limit(1);

  if (!row || row.status !== "referral_pending" || row.paymentStatus === "paid") {
    res.status(400).json({ error: "Invalid or expired completion link" });
    return;
  }

  const formData =
    row.formData && typeof row.formData === "object" && !Array.isArray(row.formData)
      ? (row.formData as Record<string, unknown>)
      : {};

  const str = (key: string) => (typeof formData[key] === "string" ? (formData[key] as string) : "");
  const publications = Array.isArray(formData.publications)
    ? formData.publications.filter((v): v is string => typeof v === "string")
    : [];

  res.json({
    ok: true,
    referenceId: row.referenceId,
    nominatorName: row.nominatorName,
    nominatorEmail: row.nominatorEmail,
    nominatorOrg: str("nominatorOrg"),
    relationship: str("relationship"),
    nomineeName: row.nomineeName,
    nomineeType: str("nomineeType"),
    nomineeDesignation: str("nomineeDesignation"),
    nomineeEmail: row.nomineeEmail || str("nomineeEmail"),
    nomineePhone: getNomineePhone(row.formData) || str("nomineePhone"),
    nomineeLocation: str("nomineeLocation"),
    nomineeSocial: str("nomineeSocial"),
    category: row.category,
    publications,
  });
}

export async function postNominationResendLink(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = resendCompletionLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await findNominationByNomineeEmail(db, email);

  if (!existing) {
    res.status(200).json({
      ok: true,
      message: "If a pending nomination exists for this email, a completion link has been sent.",
    });
    return;
  }

  if (isCompletedNominationStatus(existing.status) || existing.paymentStatus === "paid") {
    res.status(409).json({
      error: "An application for this email has already been completed and is under review.",
      code: "ALREADY_COMPLETED",
    });
    return;
  }

  if (existing.status !== "referral_pending") {
    res.status(200).json({
      ok: true,
      message: "If a pending nomination exists for this email, a completion link has been sent.",
    });
    return;
  }

  const completionToken = await ensureCompletionToken(db, existing);
  const inviteSentAt = new Date();
  await db
    .update(nominations)
    .set({ completionToken, inviteSentAt })
    .where(eq(nominations.id, existing.id));

  sendReferralEmails({
    nomineeEmail: existing.nomineeEmail,
    nomineeName: existing.nomineeName,
    nominatorEmail: existing.nominatorEmail,
    nominatorName: existing.nominatorName,
    completionToken,
    includeNominatorAck: false,
  });

  res.status(200).json({
    ok: true,
    message: "If a pending nomination exists for this email, a completion link has been sent.",
  });
}

export async function postNominationLookupByEmail(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = resendCompletionLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await findNominationByNomineeEmail(db, email);

  if (!existing || existing.status !== "referral_pending") {
    if (existing && (isCompletedNominationStatus(existing.status) || existing.paymentStatus === "paid")) {
      res.status(409).json({
        ok: false,
        found: true,
        error: "An application for this email has already been completed and is under review.",
        code: "ALREADY_COMPLETED",
      });
      return;
    }

    if (existing) {
      res.status(409).json({
        ok: false,
        found: true,
        error:
          "A nomination for this email exists but cannot be continued on site in its current state. Use Email me the link, or contact support with your reference ID.",
        code: "NOT_CONTINUABLE",
        status: existing.status,
      });
      return;
    }

    res.status(404).json({
      ok: false,
      found: false,
      error:
        "No incomplete nomination was found for this nominee email. Use the nominee's email (not the nominator's), or submit a new nomination first.",
      code: "NOT_FOUND",
    });
    return;
  }

  if (existing.paymentStatus === "paid") {
    res.status(409).json({
      ok: false,
      found: true,
      error: "An application for this email has already been completed and is under review.",
      code: "ALREADY_COMPLETED",
    });
    return;
  }

  const completionToken = await ensureCompletionToken(db, existing);
  const inviteSentAt = new Date();
  await db
    .update(nominations)
    .set({ completionToken, inviteSentAt })
    .where(eq(nominations.id, existing.id));

  // Continue-on-site: return the token so the client can open the completion page.
  // Email delivery is handled separately by POST /nominations/resend-link.
  res.status(200).json({
    ok: true,
    found: true,
    nomineeName: existing.nomineeName,
    category: existing.category,
    completionToken,
    completionUrl: buildNominationCompletionUrl(completionToken),
  });
}

export async function postNominationComplete(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = completeNominationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const [existing] = await db
    .select()
    .from(nominations)
    .where(eq(nominations.completionToken, data.token))
    .limit(1);

  if (!existing || existing.status !== "referral_pending") {
    res.status(400).json({ error: "Invalid or expired completion link" });
    return;
  }

  if (existing.paymentStatus === "paid" || existing.paymentId) {
    res.status(400).json({ error: "This nomination has already been paid" });
    return;
  }

  const paymentCheck = await assertNominationPaymentUsable(db, data.paymentId);
  if (!paymentCheck.ok) {
    res.status(400).json({ error: paymentCheck.error });
    return;
  }

  const existingFormData =
    existing.formData && typeof existing.formData === "object" && !Array.isArray(existing.formData)
      ? (existing.formData as Record<string, unknown>)
      : {};

  const incoming = data.formData ?? {};
  const correctedName =
    typeof incoming.nomineeName === "string" && incoming.nomineeName.trim()
      ? incoming.nomineeName.trim()
      : existing.nomineeName;
  const correctedCategory =
    typeof incoming.category === "string" && incoming.category.trim()
      ? incoming.category.trim()
      : existing.category;

  let correctedEmail = existing.nomineeEmail;
  if (typeof incoming.nomineeEmail === "string" && incoming.nomineeEmail.trim()) {
    const nextEmail = normalizeEmail(incoming.nomineeEmail);
    if (nextEmail !== existing.nomineeEmail) {
      const conflict = await findNominationByNomineeEmail(db, nextEmail);
      if (conflict && conflict.id !== existing.id) {
        res.status(409).json({
          error: "Another nomination already uses that email address.",
          code: "DUPLICATE_NOMINEE",
        });
        return;
      }
      correctedEmail = nextEmail;
    }
  }

  const mergedFormData = {
    ...existingFormData,
    ...incoming,
    nomineeName: correctedName,
    nomineeEmail: correctedEmail,
    category: correctedCategory,
    altVideoLink: data.altVideoLink,
    submissionType: "full_application",
    completedViaToken: true,
  };

  const referenceId = existing.referenceId ?? makeReference("APP");

  await db
    .update(nominations)
    .set({
      status: "under_review",
      reviewStatus: "pending",
      paymentId: data.paymentId,
      paymentStatus: "paid",
      completionToken: null,
      nomineeName: correctedName,
      nomineeEmail: correctedEmail,
      category: correctedCategory,
      profilePhotoKey: data.profilePhotoKey,
      supportingDocsKey: data.supportingDocsKey ?? null,
      videoKey: data.videoKey ?? null,
      formData: mergedFormData,
      referenceId,
    })
    .where(eq(nominations.id, existing.id));

  await linkNominationPayment(
    db,
    data.paymentId,
    existing.id,
    referenceId,
    (paymentCheck.payment.metadata ?? {}) as Record<string, unknown>,
  );

  const applicationEmail = getApplicationReceivedEmail(correctedName);
  sendEmailAsync(correctedEmail, applicationEmail.subject, applicationEmail.html);

  if (existing.nominatorEmail) {
    const nominatorNotice = getNominatorNomineeCompletedEmail(
      existing.nominatorName,
      correctedName,
      referenceId,
      formatAwardDateTime(),
    );
    sendEmailAsync(existing.nominatorEmail, nominatorNotice.subject, nominatorNotice.html);
  }

  const razorpayPaymentId =
    paymentCheck.payment.razorpayPaymentId ??
    ((paymentCheck.payment.metadata ?? {}) as Record<string, unknown>).razorpayPaymentId;

  await sendPaymentReceiptOnce(
    db,
    paymentCheck.payment,
    correctedName,
    correctedEmail,
    typeof razorpayPaymentId === "string" ? razorpayPaymentId : existing.id,
  );

  res.status(200).json({ ok: true, id: existing.id, referenceId });
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

  if (!selfNomination) {
    res.status(400).json({
      error:
        "Third-party nominations must use the referral flow. The nominee completes payment via their email link.",
      code: "REFERRAL_REQUIRED",
    });
    return;
  }

  function sendSelfApplicationEmails() {
    const applicationEmail = getApplicationReceivedEmail(data.nomineeName);
    sendEmailAsync(nomineeEmail, applicationEmail.subject, applicationEmail.html);
  }

  async function finalizePaidApplication(params: {
    nominationId: string;
    referenceId: string | null;
    existingFormData?: Record<string, unknown>;
    existingPaymentId?: string | null;
  }) {
    let paymentId = params.existingPaymentId ?? null;
    if (!paymentId) {
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
        completionToken: null,
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

    sendSelfApplicationEmails();
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

    if (existingByEmail.status === "referral_pending") {
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
    completionToken: null,
    nomineeEmail,
    inviteSentAt: null,
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

  sendSelfApplicationEmails();

  res.status(201).json({ ok: true, id: nominationId, referenceId });
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

    const pricing = getNominationFeeWithGstPaise();
    const { chargeAmountPaise, displayAmountPaise, isTestCharge } = resolveRazorpayChargeAmount(
      pricing.totalPaise,
      keyId,
    );
    const receipt = `nomination_${Date.now()}`;

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
          category: parsed.data.category,
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
      res.status(502).json({
        error: parseRazorpayErrorMessage(errorBody),
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
      feeLabel: `Nomination fee — ₹ ${pricing.baseInr.toLocaleString("en-IN")} + ${NOMINATION_GST_PERCENT_LABEL} GST — ₹ ${pricing.totalInr.toLocaleString("en-IN")} total`,
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
    category,
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

    const metadata = (existingPayment.metadata ?? {}) as Record<string, unknown>;
    await sendPaymentReceiptOnce(
      db,
      existingPayment,
      typeof metadata.contactName === "string" ? metadata.contactName : (nominatorName ?? "Valued Customer"),
      typeof metadata.contactEmail === "string" ? metadata.contactEmail : nominatorEmail,
      razorpayPaymentId,
    );

    res.json({ ok: true, paymentId: existingPayment.id });
    return;
  }

  const paymentId = randomUUID();
  const base = basePaise ?? amountPaise;
  const gst = gstPaise ?? 0;
  const pricing = getNominationFeeWithGstPaise();
  const paymentMetadata = {
    paymentType: "nomination_fee",
    baseInr: pricing.baseInr,
    gstInr: pricing.gstInr,
    contactName: nominatorName ?? null,
    contactEmail: nominatorEmail ?? null,
    contactPhone: nominatorPhone ?? null,
    nomineeName: nomineeName ?? null,
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

  await sendPaymentReceiptOnce(
    db,
    { id: paymentId, amountPaise, metadata: paymentMetadata },
    nominatorName ?? "Valued Customer",
    nominatorEmail,
    razorpayPaymentId,
  );

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

    const pricing = getSponsorshipAdvanceWithGstPaise(parsed.data.tierId);
    if (!pricing) {
      res.status(400).json({ error: "Invalid sponsorship tier" });
      return;
    }

    const { chargeAmountPaise, displayAmountPaise, isTestCharge } = resolveRazorpayChargeAmount(
      pricing.totalPaise,
      keyId,
    );
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
          displayAmountPaise: String(displayAmountPaise),
          isTestCharge: isTestCharge ? "true" : "false",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Razorpay order error:", errorBody);
      res.status(502).json({
        error: parseRazorpayErrorMessage(errorBody),
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
      advanceLabel: `${SPONSORSHIP_ADVANCE_PERCENT_LABEL} advance — ₹ ${pricing.baseInr.toLocaleString("en-IN")} + ${SPONSORSHIP_GST_PERCENT_LABEL} GST — ₹ ${pricing.totalInr.toLocaleString("en-IN")} total`,
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
  const pricing = getSponsorshipAdvanceWithGstPaise(reservation.tierId);
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

  await sendPaymentReceiptOnce(
    db,
    { id: paymentId, amountPaise, metadata: paymentMetadata },
    payerName,
    payerEmail,
    razorpayPaymentId,
  );

  res.status(200).json({ ok: true });
}

// Re-export for tests or guards
export { hasNominationAttachments };
