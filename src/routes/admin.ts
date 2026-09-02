import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  contactInquiries,
  nominations,
  payments,
  sponsorshipReservations,
} from "../db/schema.js";
import { sendEmail } from "../utils/mailer.js";
import { getNomineeEmail, getNomineePhone } from "../utils/nomination-email.js";
import {
  formatAwardDate,
  formatAwardDateTime,
  getCeoNominationEmail,
} from "../utils/templates.js";
import { buildSponsorshipAdminPaymentSummary } from "../utils/sponsorship-admin-payment.js";
import { resolvePaymentContactFields } from "../utils/payment-admin-contact.js";
import { getDevAdminAccessInfo } from "../bootstrap/admin.js";

type PaidNominationLookup = {
  nominationIds: Set<string>;
  referenceIds: Set<string>;
};

function buildPaidNominationLookup(
  rows: Array<{ metadata: unknown }>,
): PaidNominationLookup {
  const nominationIds = new Set<string>();
  const referenceIds = new Set<string>();

  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (typeof metadata.nominationId === "string") {
      nominationIds.add(metadata.nominationId);
    }
    if (typeof metadata.referenceId === "string") {
      referenceIds.add(metadata.referenceId);
    }
  }

  return { nominationIds, referenceIds };
}

function resolveNominationPaymentPaid(
  row: {
    id: string;
    referenceId: string | null;
    status: string;
    paymentId: string | null;
    nominationPaymentStatus: string | null;
    linkedPaymentStatus: string | null;
  },
  paidLookup?: PaidNominationLookup,
): boolean {
  if (row.nominationPaymentStatus === "paid") return true;
  if (row.linkedPaymentStatus === "paid") return true;
  if (row.status === "paid") return true;
  if (!paidLookup) return false;
  if (paidLookup.nominationIds.has(row.id)) return true;
  if (row.referenceId && paidLookup.referenceIds.has(row.referenceId)) return true;
  return false;
}

export async function getDashboard(_req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const [nominationCount] = await db.select({ value: count() }).from(nominations);

  const [inquiryCount] = await db.select({ value: count() }).from(contactInquiries);

  const [revenueRow] = await db
    .select({
      totalPaise: sql<number>`coalesce(sum(${payments.amountPaise}), 0)`,
    })
    .from(payments)
    .where(eq(payments.status, "paid"));

  res.json({
    nominations: Number(nominationCount?.value ?? 0),
    inquiries: Number(inquiryCount?.value ?? 0),
    revenueInr: Number(revenueRow?.totalPaise ?? 0) / 100,
  });
}

export async function getNominations(_req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const [rows, paidNominationPayments] = await Promise.all([
    db
      .select({
        id: nominations.id,
        referenceId: nominations.referenceId,
        nomineeName: nominations.nomineeName,
        nominatorName: nominations.nominatorName,
        nominatorEmail: nominations.nominatorEmail,
        nominatorPhone: nominations.nominatorPhone,
        nomineeEmail: nominations.nomineeEmail,
        category: nominations.category,
        status: nominations.status,
        reviewStatus: nominations.reviewStatus,
        paymentId: nominations.paymentId,
        nominationPaymentStatus: nominations.paymentStatus,
        linkedPaymentStatus: payments.status,
        formData: nominations.formData,
        createdAt: nominations.createdAt,
      })
      .from(nominations)
      .leftJoin(payments, eq(nominations.paymentId, payments.id))
      .orderBy(desc(nominations.createdAt)),
    db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(and(eq(payments.type, "nomination"), eq(payments.status, "paid"))),
  ]);

  const paidLookup = buildPaidNominationLookup(paidNominationPayments);

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      referenceId: row.referenceId,
      nomineeName: row.nomineeName,
      nominatorName: row.nominatorName,
      nominatorEmail: row.nominatorEmail,
      nominatorPhone: row.nominatorPhone,
      category: row.category,
      status: row.status,
      reviewStatus: row.reviewStatus,
      paymentId: row.paymentId,
      paymentStatus: row.nominationPaymentStatus,
      createdAt: row.createdAt,
      nomineeEmail: row.nomineeEmail || getNomineeEmail(row.formData),
      nomineePhone: getNomineePhone(row.formData),
      paymentPaid: resolveNominationPaymentPaid(
        {
          id: row.id,
          referenceId: row.referenceId,
          status: row.status,
          paymentId: row.paymentId,
          nominationPaymentStatus: row.nominationPaymentStatus,
          linkedPaymentStatus: row.linkedPaymentStatus,
        },
        paidLookup,
      ),
    })),
  });
}

export async function getNominationById(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing nomination id" });
    return;
  }

  const [[row], paidNominationPayments] = await Promise.all([
    db
      .select({
        nomination: nominations,
        linkedPaymentStatus: payments.status,
      })
      .from(nominations)
      .leftJoin(payments, eq(nominations.paymentId, payments.id))
      .where(eq(nominations.id, id))
      .limit(1),
    db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(and(eq(payments.type, "nomination"), eq(payments.status, "paid"))),
  ]);

  if (!row) {
    res.status(404).json({ error: "Nomination not found" });
    return;
  }

  const paidLookup = buildPaidNominationLookup(paidNominationPayments);

  res.json({
    ...row.nomination,
    nomineeEmail: row.nomination.nomineeEmail || getNomineeEmail(row.nomination.formData),
    paymentPaid: resolveNominationPaymentPaid(
      {
        id: row.nomination.id,
        referenceId: row.nomination.referenceId,
        status: row.nomination.status,
        paymentId: row.nomination.paymentId,
        nominationPaymentStatus: row.nomination.paymentStatus,
        linkedPaymentStatus: row.linkedPaymentStatus,
      },
      paidLookup,
    ),
  });
}

const patchNominationSchema = z.object({
  reviewStatus: z.enum(["pending", "approved"]).optional(),
  status: z
    .enum(["draft", "pending_payment", "paid", "under_review"])
    .optional(),
  paymentStatus: z.enum(["unpaid", "paid"]).optional(),
  nominatorName: z.string().min(1).max(255).optional(),
  nominatorEmail: z.string().email().max(255).optional(),
  nominatorPhone: z.string().min(10).max(32).optional(),
  nomineeName: z.string().min(1).max(255).optional(),
  nomineeEmail: z.string().email().max(255).optional(),
  category: z.string().min(1).max(255).optional(),
  profilePhotoKey: z.string().max(512).nullable().optional(),
  supportingDocsKey: z.string().max(512).nullable().optional(),
  videoKey: z.string().max(512).nullable().optional(),
  formData: z.record(z.unknown()).optional(),
});

export async function patchNomination(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = patchNominationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing nomination id" });
    return;
  }

  const [existing] = await db.select().from(nominations).where(eq(nominations.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Nomination not found" });
    return;
  }

  const updates: Partial<typeof nominations.$inferInsert> = {};
  if (parsed.data.reviewStatus) updates.reviewStatus = parsed.data.reviewStatus;
  if (parsed.data.status) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "paid") {
      updates.paymentStatus = "paid";
    }
  }
  if (parsed.data.paymentStatus) updates.paymentStatus = parsed.data.paymentStatus;
  if (parsed.data.nominatorName) updates.nominatorName = parsed.data.nominatorName;
  if (parsed.data.nominatorEmail) updates.nominatorEmail = parsed.data.nominatorEmail;
  if (parsed.data.nominatorPhone) updates.nominatorPhone = parsed.data.nominatorPhone;
  if (parsed.data.nomineeName) updates.nomineeName = parsed.data.nomineeName;
  if (parsed.data.nomineeEmail) updates.nomineeEmail = parsed.data.nomineeEmail.trim().toLowerCase();
  if (parsed.data.category) updates.category = parsed.data.category;
  if (parsed.data.profilePhotoKey !== undefined) {
    updates.profilePhotoKey = parsed.data.profilePhotoKey;
  }
  if (parsed.data.supportingDocsKey !== undefined) {
    updates.supportingDocsKey = parsed.data.supportingDocsKey;
  }
  if (parsed.data.videoKey !== undefined) updates.videoKey = parsed.data.videoKey;
  if (parsed.data.formData) {
    updates.formData = {
      ...(existing.formData as Record<string, unknown>),
      ...parsed.data.formData,
    };
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }

  await db.update(nominations).set(updates).where(eq(nominations.id, id));

  res.json({ ok: true });
}

export async function getPayments(_req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rows = await db
    .select({
      id: payments.id,
      razorpayOrderId: payments.razorpayOrderId,
      razorpayPaymentId: payments.razorpayPaymentId,
      amountInr: sql<number>`${payments.amountPaise} / 100`,
      status: payments.status,
      type: payments.type,
      metadata: payments.metadata,
      createdAt: payments.createdAt,
      nominatorName: nominations.nominatorName,
      nominatorEmail: nominations.nominatorEmail,
      nominatorPhone: nominations.nominatorPhone,
      nomineeName: nominations.nomineeName,
      nomineeEmail: nominations.nomineeEmail,
      nominationCategory: nominations.category,
      nominationReferenceId: nominations.referenceId,
      sponsorshipCompany: sponsorshipReservations.company,
      sponsorshipContactName: sponsorshipReservations.contactName,
      sponsorshipContactEmail: sponsorshipReservations.contactEmail,
      sponsorshipContactPhone: sponsorshipReservations.contactPhone,
      sponsorshipReferenceId: sponsorshipReservations.referenceId,
      sponsorshipTierName: sponsorshipReservations.tierName,
    })
    .from(payments)
    .leftJoin(nominations, eq(nominations.paymentId, payments.id))
    .leftJoin(sponsorshipReservations, eq(sponsorshipReservations.paymentId, payments.id))
    .orderBy(desc(payments.createdAt));

  res.json({
    items: rows.map((row) => {
      const contact = resolvePaymentContactFields({
        metadata: row.metadata,
        type: row.type,
        nomination: row.nominatorName
          ? {
              nominatorName: row.nominatorName,
              nominatorEmail: row.nominatorEmail,
              nominatorPhone: row.nominatorPhone,
              nomineeName: row.nomineeName,
              nomineeEmail: row.nomineeEmail,
              category: row.nominationCategory,
              referenceId: row.nominationReferenceId,
            }
          : null,
        sponsorship: row.sponsorshipContactName
          ? {
              company: row.sponsorshipCompany,
              contactName: row.sponsorshipContactName,
              contactEmail: row.sponsorshipContactEmail,
              contactPhone: row.sponsorshipContactPhone,
              referenceId: row.sponsorshipReferenceId,
              tierName: row.sponsorshipTierName,
            }
          : null,
      });

      return {
        id: row.id,
        razorpayOrderId: row.razorpayOrderId,
        razorpayPaymentId: row.razorpayPaymentId,
        amountInr: row.amountInr,
        status: row.status,
        type: row.type,
        createdAt: row.createdAt,
        ...contact,
      };
    }),
  });
}

export async function getPaymentById(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing payment id" });
    return;
  }

  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const [nomination] = await db
    .select()
    .from(nominations)
    .where(eq(nominations.paymentId, id))
    .limit(1);

  const [sponsorship] = await db
    .select()
    .from(sponsorshipReservations)
    .where(eq(sponsorshipReservations.paymentId, id))
    .limit(1);

  const contact = resolvePaymentContactFields({
    metadata: row.metadata,
    type: row.type,
    nomination: nomination
      ? {
          nominatorName: nomination.nominatorName,
          nominatorEmail: nomination.nominatorEmail,
          nominatorPhone: nomination.nominatorPhone,
          nomineeName: nomination.nomineeName,
          nomineeEmail: nomination.nomineeEmail,
          category: nomination.category,
          referenceId: nomination.referenceId,
        }
      : null,
    sponsorship: sponsorship
      ? {
          company: sponsorship.company,
          contactName: sponsorship.contactName,
          contactEmail: sponsorship.contactEmail,
          contactPhone: sponsorship.contactPhone,
          referenceId: sponsorship.referenceId,
          tierName: sponsorship.tierName,
        }
      : null,
  });

  res.json({
    ...row,
    amountInr: row.amountPaise / 100,
    baseInr: row.basePaise / 100,
    gstInr: row.gstPaise / 100,
    ...contact,
    linkedNominationId: nomination?.id ?? null,
    linkedSponsorshipId: sponsorship?.id ?? null,
  });
}

export async function getInquiries(_req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rows = await db
    .select({
      id: contactInquiries.id,
      name: contactInquiries.name,
      email: contactInquiries.email,
      company: contactInquiries.company,
      inquiryType: contactInquiries.inquiryType,
      message: contactInquiries.message,
      createdAt: contactInquiries.createdAt,
    })
    .from(contactInquiries)
    .orderBy(desc(contactInquiries.createdAt));

  res.json({ items: rows });
}

export async function getInquiryById(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing inquiry id" });
    return;
  }

  const [row] = await db.select().from(contactInquiries).where(eq(contactInquiries.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Inquiry not found" });
    return;
  }

  res.json(row);
}

const patchInquirySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  company: z.string().max(255).nullable().optional(),
  inquiryType: z.string().max(128).nullable().optional(),
  message: z.string().min(1).max(5000).optional(),
});

export async function patchInquiry(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = patchInquirySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing inquiry id" });
    return;
  }

  const updates: Partial<typeof contactInquiries.$inferInsert> = {};
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.email) updates.email = parsed.data.email;
  if (parsed.data.company !== undefined) updates.company = parsed.data.company;
  if (parsed.data.inquiryType !== undefined) updates.inquiryType = parsed.data.inquiryType;
  if (parsed.data.message) updates.message = parsed.data.message;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }

  await db.update(contactInquiries).set(updates).where(eq(contactInquiries.id, id));

  res.json({ ok: true });
}

export async function getSponsorships(_req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rows = await db
    .select({
      id: sponsorshipReservations.id,
      referenceId: sponsorshipReservations.referenceId,
      tierId: sponsorshipReservations.tierId,
      tierName: sponsorshipReservations.tierName,
      company: sponsorshipReservations.company,
      contactName: sponsorshipReservations.contactName,
      contactEmail: sponsorshipReservations.contactEmail,
      contactPhone: sponsorshipReservations.contactPhone,
      message: sponsorshipReservations.message,
      status: sponsorshipReservations.status,
      paymentId: sponsorshipReservations.paymentId,
      spots: sponsorshipReservations.spots,
      createdAt: sponsorshipReservations.createdAt,
      paymentStatus: payments.status,
      paymentAmountPaise: payments.amountPaise,
      razorpayPaymentId: payments.razorpayPaymentId,
    })
    .from(sponsorshipReservations)
    .leftJoin(payments, eq(sponsorshipReservations.paymentId, payments.id))
    .orderBy(desc(sponsorshipReservations.createdAt));

  res.json({
    items: rows.map((row) => {
      const paymentPaid = row.status === "confirmed" && Boolean(row.paymentId);
      const payment =
        row.paymentId && row.paymentStatus
          ? {
              status: row.paymentStatus,
              amountPaise: row.paymentAmountPaise ?? 0,
              razorpayPaymentId: row.razorpayPaymentId,
            }
          : null;

      return {
        id: row.id,
        referenceId: row.referenceId,
        tierId: row.tierId,
        tierName: row.tierName,
        company: row.company,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        message: row.message,
        status: row.status,
        paymentId: row.paymentId,
        spots: row.spots,
        createdAt: row.createdAt,
        paymentPaid,
        payment: buildSponsorshipAdminPaymentSummary(row.tierId, row.status, payment),
      };
    }),
  });
}

export async function getSponsorshipById(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing sponsorship id" });
    return;
  }

  const [row] = await db
    .select()
    .from(sponsorshipReservations)
    .where(eq(sponsorshipReservations.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Sponsorship not found" });
    return;
  }

  let linkedPayment: {
    status: string;
    amountPaise: number;
    razorpayPaymentId: string | null;
    razorpayOrderId: string;
    basePaise: number;
    gstPaise: number;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null = null;

  if (row.paymentId) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, row.paymentId))
      .limit(1);
    linkedPayment = payment ?? null;
  }

  const paymentPaid = row.status === "confirmed" && Boolean(row.paymentId);
  const paymentSummary = buildSponsorshipAdminPaymentSummary(
    row.tierId,
    row.status,
    linkedPayment
      ? {
          status: linkedPayment.status,
          amountPaise: linkedPayment.amountPaise,
          razorpayPaymentId: linkedPayment.razorpayPaymentId,
        }
      : null,
  );

  res.json({
    ...row,
    paymentPaid,
    payment: paymentSummary,
    paymentRecord: linkedPayment
      ? {
          id: row.paymentId,
          razorpayOrderId: linkedPayment.razorpayOrderId,
          razorpayPaymentId: linkedPayment.razorpayPaymentId,
          status: linkedPayment.status,
          amountInr: linkedPayment.amountPaise / 100,
          baseInr: linkedPayment.basePaise / 100,
          gstInr: linkedPayment.gstPaise / 100,
          createdAt: linkedPayment.createdAt,
          updatedAt: linkedPayment.updatedAt,
          metadata: linkedPayment.metadata,
        }
      : null,
  });
}

const patchSponsorshipSchema = z.object({
  company: z.string().min(1).max(255).optional(),
  contactName: z.string().min(1).max(255).optional(),
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().min(10).max(32).optional(),
  message: z.string().max(2000).nullable().optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  tierId: z.string().min(1).max(64).optional(),
  tierName: z.string().min(1).max(255).optional(),
});

export async function patchSponsorship(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = patchSponsorshipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  if (!id) {
    res.status(400).json({ error: "Missing sponsorship id" });
    return;
  }

  const updates: Partial<typeof sponsorshipReservations.$inferInsert> = {};
  if (parsed.data.company) updates.company = parsed.data.company;
  if (parsed.data.contactName) updates.contactName = parsed.data.contactName;
  if (parsed.data.contactEmail) updates.contactEmail = parsed.data.contactEmail;
  if (parsed.data.contactPhone) updates.contactPhone = parsed.data.contactPhone;
  if (parsed.data.message !== undefined) updates.message = parsed.data.message;
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.tierId) updates.tierId = parsed.data.tierId;
  if (parsed.data.tierName) updates.tierName = parsed.data.tierName;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }

  await db.update(sponsorshipReservations).set(updates).where(eq(sponsorshipReservations.id, id));

  res.json({ ok: true });
}

const sendInviteSchema = z.object({
  nominationId: z.string().uuid(),
});

export async function postSendInvite(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = sendInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const [row] = await db
    .select()
    .from(nominations)
    .where(eq(nominations.id, parsed.data.nominationId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Nomination not found" });
    return;
  }

  const nomineeEmail = row.nomineeEmail || getNomineeEmail(row.formData);
  if (!nomineeEmail) {
    res.status(400).json({ error: "Nominee email not found on this nomination" });
    return;
  }

  const invite = getCeoNominationEmail(
    row.nomineeName,
    row.nominatorName,
    formatAwardDate(),
    formatAwardDateTime(),
  );

  const sent = await sendEmail(nomineeEmail, invite.subject, invite.html);

  if (sent) {
    const existingFormData =
      row.formData && typeof row.formData === "object" && !Array.isArray(row.formData)
        ? (row.formData as Record<string, unknown>)
        : {};

    await db
      .update(nominations)
      .set({
        reviewStatus: "approved",
        formData: {
          ...existingFormData,
          formalInviteSentAt: new Date().toISOString(),
        },
      })
      .where(eq(nominations.id, parsed.data.nominationId));
  }

  res.json({ ok: true, sent });
}

export async function getDevAccess(_req: Request, res: Response) {
  const info = getDevAdminAccessInfo();
  if (!info.enabled || !info.username) {
    res.json({ enabled: false });
    return;
  }

  res.json({
    enabled: true,
    username: info.username,
    password: process.env.ADMIN_DEV_PASSWORD?.trim() ?? null,
  });
}
