import type { Request, Response } from "express";
import { z } from "zod";
import { getMailConfig, getResendConfig } from "../config/mail.js";
import {
  getMailDiagnostics,
  sendEmailDetailed,
  sendSimpleTestEmail,
  verifySmtpConnection,
} from "../utils/mailer.js";
import {
  formatAwardDateTime,
  getApplicationReceivedEmail,
  getCeoNominationEmail,
  getNominantAcknowledgementEmail,
  getNomineeNominationAcknowledgementEmail,
  getPaymentReceiptEmail,
  getSponsorshipConfirmationEmail,
} from "../utils/templates.js";

const mailTestSchema = z.object({
  to: z.string().email(),
  template: z.enum([
    "ping",
    "ceo_letter",
    "application_ack",
    "nominator_ack",
    "nominee_ack",
    "payment_receipt",
    "sponsorship_confirmation",
  ]),
});

const SAMPLE = {
  nomineeName: "Sample Nominee",
  nominatorName: "Sample Nominator",
  category: "Innovation & Technology",
  transactionId: "pay_TEST123456",
};

function buildTestEmail(template: Exclude<z.infer<typeof mailTestSchema>["template"], "ping">) {
  switch (template) {
    case "ceo_letter":
      return getCeoNominationEmail(SAMPLE.nomineeName, SAMPLE.nominatorName);
    case "application_ack":
      return getApplicationReceivedEmail(SAMPLE.nomineeName);
    case "nominator_ack":
      return getNominantAcknowledgementEmail(SAMPLE.nominatorName, SAMPLE.nomineeName);
    case "nominee_ack":
      return getNomineeNominationAcknowledgementEmail(
        SAMPLE.nomineeName,
        SAMPLE.nominatorName,
        SAMPLE.category,
      );
    case "payment_receipt":
      return getPaymentReceiptEmail(SAMPLE.nominatorName, 20_000, SAMPLE.transactionId);
    case "sponsorship_confirmation":
      return getSponsorshipConfirmationEmail({
        contactName: SAMPLE.nominatorName,
        company: "Sample Company Pvt Ltd",
        tierName: "Golden Partner",
        referenceId: "SPN-TEST-001",
        committedAmountInr: 1000000,
        committedTotalInr: 1180000,
        advanceBaseInr: 423729,
        gstPaidInr: 76271,
        amountPaidInr: 500000,
        balanceTotalInr: 680000,
        transactionId: SAMPLE.transactionId,
        date: formatAwardDateTime(),
      });
  }
}

export async function getMailStatus(_req: Request, res: Response) {
  const diagnostics = await getMailDiagnostics({ verify: true });
  res.json(diagnostics);
}

export async function postMailTest(req: Request, res: Response) {
  const parsed = mailTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { to, template } = parsed.data;
  const cfg = getMailConfig();
  const resend = getResendConfig();
  if (!cfg && !resend) {
    res.status(503).json({
      ok: false,
      sent: false,
      template,
      to,
      error: "No mail provider configured — set RESEND_API_KEY or SMTP_*",
      diagnostics: await getMailDiagnostics({ verify: false }),
    });
    return;
  }

  const started = Date.now();

  try {
    if (template === "ping") {
      const result = await sendSimpleTestEmail(to);
      res.json({
        ok: result.sent,
        template,
        to,
        ...result,
        durationMs: Date.now() - started,
      });
      return;
    }

    const email = buildTestEmail(template);
    const result = await sendEmailDetailed(to, email.subject, email.html);

    res.json({
      ok: result.sent,
      template,
      to,
      subject: email.subject,
      ...result,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      sent: false,
      template,
      to,
      error: err instanceof Error ? err.message : "Mail test failed",
      durationMs: Date.now() - started,
    });
  }
}

export async function postMailVerify(_req: Request, res: Response) {
  const result = await verifySmtpConnection();
  res.status(result.ok ? 200 : 502).json(result);
}
