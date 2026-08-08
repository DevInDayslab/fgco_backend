import { count, desc, eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  contactInquiries,
  nominations,
  payments,
  sponsorshipReservations,
} from "../db/schema.js";

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

  const rows = await db
    .select({
      id: nominations.id,
      referenceId: nominations.referenceId,
      nomineeName: nominations.nomineeName,
      nominatorName: nominations.nominatorName,
      nominatorEmail: nominations.nominatorEmail,
      category: nominations.category,
      status: nominations.status,
      reviewStatus: nominations.reviewStatus,
      paymentId: nominations.paymentId,
      createdAt: nominations.createdAt,
    })
    .from(nominations)
    .orderBy(desc(nominations.createdAt));

  res.json({
    items: rows.map((row) => ({
      ...row,
      paymentPaid: row.status === "paid",
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

  const [row] = await db.select().from(nominations).where(eq(nominations.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Nomination not found" });
    return;
  }

  res.json({
    ...row,
    paymentPaid: row.status === "paid",
  });
}

const patchNominationSchema = z.object({
  reviewStatus: z.enum(["pending", "approved"]).optional(),
  status: z.enum(["draft", "pending_payment", "paid", "under_review"]).optional(),
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

  const updates: Partial<typeof nominations.$inferInsert> = {};
  if (parsed.data.reviewStatus) updates.reviewStatus = parsed.data.reviewStatus;
  if (parsed.data.status) updates.status = parsed.data.status;

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
      createdAt: payments.createdAt,
    })
    .from(payments)
    .orderBy(desc(payments.createdAt));

  res.json({ items: rows });
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

  res.json({
    ...row,
    amountInr: row.amountPaise / 100,
    baseInr: row.basePaise / 100,
    gstInr: row.gstPaise / 100,
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
      createdAt: sponsorshipReservations.createdAt,
    })
    .from(sponsorshipReservations)
    .orderBy(desc(sponsorshipReservations.createdAt));

  res.json({
    items: rows.map((row) => ({
      ...row,
      paymentPaid: row.status === "confirmed" && Boolean(row.paymentId),
    })),
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

  res.json({
    ...row,
    paymentPaid: row.status === "confirmed" && Boolean(row.paymentId),
  });
}
