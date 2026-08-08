import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  getSponsorshipAdvanceInr,
  getSponsorshipTier,
  SPONSORSHIP_ADVANCE_PERCENT_LABEL,
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

const contactSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  company: z.string().max(255).optional(),
  inquiryType: z.string().max(128).optional(),
  message: z.string().min(1).max(5000),
});

const nominationSchema = z.object({
  nominatorName: z.string().min(1).max(255),
  nominatorEmail: z.string().email().max(255),
  nominatorPhone: z.string().min(10).max(32),
  nomineeName: z.string().min(1).max(255),
  category: z.string().min(1).max(255),
  formData: z.record(z.unknown()),
  profilePhotoKey: z.string().max(512).optional(),
  supportingDocsKey: z.string().max(512).optional(),
  videoKey: z.string().max(512).optional(),
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

export async function postNomination(req: Request, res: Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const parsed = nominationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const id = randomUUID();
  const referenceId = makeReference("NOM");

  await db.insert(nominations).values({
    id,
    referenceId,
    status: "pending_payment",
    reviewStatus: "pending",
    nominatorName: parsed.data.nominatorName,
    nominatorEmail: parsed.data.nominatorEmail,
    nominatorPhone: parsed.data.nominatorPhone,
    nomineeName: parsed.data.nomineeName,
    category: parsed.data.category,
    profilePhotoKey: parsed.data.profilePhotoKey ?? null,
    supportingDocsKey: parsed.data.supportingDocsKey ?? null,
    videoKey: parsed.data.videoKey ?? null,
    formData: parsed.data.formData,
  });

  res.status(201).json({ ok: true, id, referenceId });
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

    const advanceInr = getSponsorshipAdvanceInr(parsed.data.tierId);
    if (!advanceInr) {
      res.status(400).json({ error: "Invalid sponsorship tier" });
      return;
    }

    const amountInPaise = advanceInr * 100;
    const { chargeAmountPaise, displayAmountPaise, isTestCharge } = resolveRazorpayChargeAmount(
      amountInPaise,
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
          paymentType: "sponsorship_advance",
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
      isTestCharge,
      currency: "INR",
      keyId,
      tierName: tier.name,
      advanceLabel: `${SPONSORSHIP_ADVANCE_PERCENT_LABEL} advance — ₹ ${advanceInr.toLocaleString("en-IN")}`,
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

  const paymentId = randomUUID();
  const base = basePaise ?? amountPaise;
  const gst = gstPaise ?? 0;

  await db.insert(payments).values({
    id: paymentId,
    type: "sponsorship",
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise,
    basePaise: base,
    gstPaise: gst,
    status: "paid",
    metadata: {
      reservationId,
      tierId: reservation.tierId,
      company: reservation.company,
    },
  });

  await db
    .update(sponsorshipReservations)
    .set({ status: "confirmed", paymentId })
    .where(eq(sponsorshipReservations.id, reservationId));

  res.json({ ok: true, paymentId });
}
