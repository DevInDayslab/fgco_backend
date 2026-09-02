import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getNominationFeePaise } from "../config/nomination.js";
import { getSponsorshipPaymentPlan, getSponsorshipTier, SPONSORSHIP_TIERS } from "../config/sponsorship.js";
import { invokeRouteHandler } from "../utils/invoke-handler.js";
import {
  postApplication,
  postNominationPayment,
  postSponsorshipPayment,
  postSponsorshipRegister,
} from "./public.js";

const ADMIN_TEST_PROFILE_KEY = "admin-test/profile-placeholder.jpg";

const nominationScenarioSchema = z.object({
  scenario: z.enum(["third_party_nomination", "self_nomination"]),
  nominatorName: z.string().min(1).max(255),
  nominatorEmail: z.string().email().max(255),
  nominatorPhone: z.string().min(10).max(32),
  nomineeName: z.string().min(1).max(255).optional(),
  nomineeEmail: z.string().email().max(255).optional(),
  nomineePhone: z.string().min(10).max(32).optional(),
  category: z.string().min(1).max(255).default("Remarkable Achievements"),
});

const sponsorshipScenarioSchema = z.object({
  scenario: z.literal("sponsorship"),
  tierId: z.enum(["super", "power", "golden", "silver", "circle"]),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().min(10).max(32),
  company: z.string().min(1).max(255).default("Admin Test Company Pvt Ltd"),
});

const runSchema = z.discriminatedUnion("scenario", [
  nominationScenarioSchema,
  sponsorshipScenarioSchema,
]);

type StepResult = {
  route: string;
  status: number;
  ok: boolean;
  body: Record<string, unknown>;
};

function isNotificationTestsAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.ALLOW_ADMIN_NOTIFICATION_TESTS === "true"
  );
}

function makeTestRazorpayIds(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const orderId = `order_ADMIN_${prefix}_${stamp}`;
  const paymentId = `pay_ADMIN_${prefix}_${stamp}`;
  return { orderId, paymentId };
}

function makeTestRazorpaySignature(orderId: string, paymentId: string): string {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) {
    return "admin-test-signature";
  }
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function summarizeNotifications(scenario: string): string[] {
  switch (scenario) {
    case "self_nomination":
      return [
        "Email: CEO letter + application acknowledgement (nominee email)",
        "SMS: SELF_NOMINATION_ACK (nominator phone)",
      ];
    case "third_party_nomination":
      return [
        "Email: payment receipt + nominator ack + CEO letter + nominee ack",
        "SMS: PAYMENT_RECEIPT + NOMINANT_ACK (nominator phone)",
        "SMS: NOMINEE_NOTIFICATION (nominee phone, if provided)",
      ];
    case "sponsorship":
      return [
        "Email: sponsorship confirmation (contact email)",
        "SMS: SPONSOR_CONFIRMATION (contact phone)",
      ];
    default:
      return [];
  }
}

async function runNominationScenario(
  input: z.infer<typeof nominationScenarioSchema>,
): Promise<{ steps: StepResult[]; summary: Record<string, unknown> }> {
  const isSelf = input.scenario === "self_nomination";
  const nomineeName = isSelf ? input.nominatorName : (input.nomineeName ?? input.nominatorName);
  const nomineeEmail = isSelf ? input.nominatorEmail : (input.nomineeEmail ?? input.nominatorEmail);
  const nomineePhone = isSelf ? input.nominatorPhone : (input.nomineePhone ?? input.nominatorPhone);
  const pricing = getNominationFeePaise(isSelf);
  const { orderId, paymentId } = makeTestRazorpayIds(isSelf ? "SELF" : "NOM");
  const signature = makeTestRazorpaySignature(orderId, paymentId);

  const steps: StepResult[] = [];

  const paymentResult = await invokeRouteHandler<Record<string, unknown>>(postNominationPayment, {
    body: {
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      amountPaise: pricing.totalPaise,
      basePaise: pricing.basePaise,
      gstPaise: pricing.gstPaise,
      nominatorName: input.nominatorName,
      nominatorEmail: input.nominatorEmail,
      nominatorPhone: input.nominatorPhone,
      nomineeName,
      nomineeEmail,
      category: input.category,
      relationship: isSelf ? "Self (Nominee)" : "Colleague / Professional Contact",
    },
  });

  steps.push({
    route: "POST /api/nominations/complete-payment",
    status: paymentResult.status,
    ok: paymentResult.status >= 200 && paymentResult.status < 300,
    body: paymentResult.body,
  });

  if (!steps[0]?.ok) {
    return {
      steps,
      summary: {
        scenario: input.scenario,
        failedAt: steps[0]?.route,
        notificationsExpected: summarizeNotifications(input.scenario),
      },
    };
  }

  const paymentRecordId =
    typeof paymentResult.body.paymentId === "string" ? paymentResult.body.paymentId : null;
  if (!paymentRecordId) {
    return {
      steps,
      summary: {
        scenario: input.scenario,
        error: "Payment step succeeded but paymentId was missing",
        notificationsExpected: summarizeNotifications(input.scenario),
      },
    };
  }

  const applicationResult = await invokeRouteHandler<Record<string, unknown>>(postApplication, {
    body: {
      paymentId: paymentRecordId,
      nominatorName: input.nominatorName,
      nominatorEmail: input.nominatorEmail,
      nominatorPhone: input.nominatorPhone,
      nomineeName,
      category: input.category,
      profilePhotoKey: ADMIN_TEST_PROFILE_KEY,
      formData: {
        nomineeEmail,
        nomineePhone,
        nominatorEmail: input.nominatorEmail,
        relationship: isSelf ? "Self (Nominee)" : "Colleague / Professional Contact",
        executiveSummary: "Admin notification test submission.",
        achievement: "Admin notification test achievement.",
        declaration: true,
        adminNotificationTest: true,
        submittedAt: new Date().toISOString(),
      },
    },
  });

  steps.push({
    route: "POST /api/applications",
    status: applicationResult.status,
    ok: applicationResult.status >= 200 && applicationResult.status < 300,
    body: applicationResult.body,
  });

  return {
    steps,
    summary: {
      scenario: input.scenario,
      isSelfNomination: isSelf,
      nominatorEmail: input.nominatorEmail,
      nominatorPhone: input.nominatorPhone,
      nomineeEmail,
      nomineePhone,
      category: input.category,
      paymentId: paymentRecordId,
      nominationId: applicationResult.body.id ?? null,
      referenceId: applicationResult.body.referenceId ?? null,
      notificationsQueued: summarizeNotifications(input.scenario),
      note: "Email and SMS are sent asynchronously using the same code paths as the public website.",
    },
  };
}

async function runSponsorshipScenario(
  input: z.infer<typeof sponsorshipScenarioSchema>,
): Promise<{ steps: StepResult[]; summary: Record<string, unknown> }> {
  const tier = getSponsorshipTier(input.tierId);
  const plan = getSponsorshipPaymentPlan(input.tierId);
  if (!tier || !plan) {
    return {
      steps: [],
      summary: { error: "Invalid sponsorship tier" },
    };
  }

  const steps: StepResult[] = [];

  const registerResult = await invokeRouteHandler<Record<string, unknown>>(postSponsorshipRegister, {
    body: {
      tierId: input.tierId,
      tierName: tier.name,
      company: input.company,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      message: "Admin notification test registration",
    },
  });

  steps.push({
    route: "POST /api/sponsorship/register",
    status: registerResult.status,
    ok: registerResult.status >= 200 && registerResult.status < 300,
    body: registerResult.body,
  });

  if (!steps[0]?.ok) {
    return {
      steps,
      summary: {
        scenario: input.scenario,
        tierId: input.tierId,
        failedAt: steps[0]?.route,
        notificationsExpected: summarizeNotifications("sponsorship"),
      },
    };
  }

  const reservationId =
    typeof registerResult.body.id === "string" ? registerResult.body.id : null;
  if (!reservationId) {
    return {
      steps,
      summary: {
        scenario: input.scenario,
        error: "Registration succeeded but reservation id was missing",
      },
    };
  }

  const { orderId, paymentId } = makeTestRazorpayIds(`SPON_${input.tierId.toUpperCase()}`);
  const signature = makeTestRazorpaySignature(orderId, paymentId);

  const paymentResult = await invokeRouteHandler<Record<string, unknown>>(postSponsorshipPayment, {
    body: {
      reservationId,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      amountPaise: plan.totalPaise,
      basePaise: plan.basePaise,
      gstPaise: plan.gstPaise,
    },
  });

  steps.push({
    route: "POST /api/sponsorship/complete-payment",
    status: paymentResult.status,
    ok: paymentResult.status >= 200 && paymentResult.status < 300,
    body: paymentResult.body,
  });

  return {
    steps,
    summary: {
      scenario: input.scenario,
      tierId: input.tierId,
      tierName: tier.name,
      company: input.company,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      reservationId,
      referenceId: registerResult.body.referenceId ?? null,
      paymentId: paymentResult.body.paymentId ?? null,
      notificationsQueued: summarizeNotifications("sponsorship"),
      note: "Email and SMS are sent asynchronously using the same code paths as the public website.",
    },
  };
}

export async function getNotificationScenarios(_req: Request, res: Response) {
  if (!isNotificationTestsAllowed()) {
    res.status(403).json({
      error: "Notification flow tests are disabled. Set ALLOW_ADMIN_NOTIFICATION_TESTS=true to enable in production.",
    });
    return;
  }

  res.json({
    scenarios: [
      {
        id: "third_party_nomination",
        label: "Third-party nomination (full registration)",
        routes: [
          "POST /api/nominations/complete-payment",
          "POST /api/applications",
        ],
        notifications: summarizeNotifications("third_party_nomination"),
      },
      {
        id: "self_nomination",
        label: "Self nomination (full registration)",
        routes: [
          "POST /api/nominations/complete-payment",
          "POST /api/applications",
        ],
        notifications: summarizeNotifications("self_nomination"),
      },
      {
        id: "sponsorship",
        label: "Sponsorship registration + payment",
        routes: [
          "POST /api/sponsorship/register",
          "POST /api/sponsorship/complete-payment",
        ],
        tiers: SPONSORSHIP_TIERS.map((tier) => ({
          id: tier.id,
          name: tier.name,
          amountInr: tier.amountInr,
        })),
        notifications: summarizeNotifications("sponsorship"),
      },
    ],
    phoneNote:
      "Phone numbers can be 10 digits without country code. +91, 91, or a leading 0 are normalized automatically.",
  });
}

export async function postNotificationRun(req: Request, res: Response) {
  if (!isNotificationTestsAllowed()) {
    res.status(403).json({
      error: "Notification flow tests are disabled. Set ALLOW_ADMIN_NOTIFICATION_TESTS=true to enable in production.",
    });
    return;
  }

  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const input = parsed.data;
  const started = Date.now();

  try {
    const result =
      input.scenario === "sponsorship"
        ? await runSponsorshipScenario(input)
        : await runNominationScenario(input);

    const allOk = result.steps.length > 0 && result.steps.every((step) => step.ok);

    res.status(allOk ? 200 : 502).json({
      ok: allOk,
      durationMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Notification test failed",
      durationMs: Date.now() - started,
    });
  }
}
