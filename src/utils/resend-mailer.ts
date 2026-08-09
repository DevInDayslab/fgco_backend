import { Resend } from "resend";
import { getResendConfig } from "../config/mail.js";

export function isResendConfigured(): boolean {
  return getResendConfig() !== null;
}

type ResendAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  inlineContentId?: string;
};

export async function sendViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: ResendAttachment[];
}): Promise<{ messageId: string; provider: "resend" }> {
  const cfg = getResendConfig();
  if (!cfg) {
    throw new Error("Resend is not configured — set RESEND_API_KEY");
  }

  const resend = new Resend(cfg.apiKey);
  const result = await resend.emails.send({
    from: cfg.from,
    to: [input.to],
    replyTo: cfg.fromEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  });

  if (result.error) {
    throw new Error(result.error.message || "Resend send failed");
  }

  const messageId = result.data?.id;
  if (!messageId) {
    throw new Error("Resend returned no message id");
  }

  return { messageId, provider: "resend" };
}

export async function verifyResendConnection(): Promise<{
  ok: boolean;
  provider: "resend";
  from: string;
  error?: string;
}> {
  const cfg = getResendConfig();
  if (!cfg) {
    return { ok: false, provider: "resend", from: "", error: "RESEND_API_KEY not set" };
  }

  return { ok: true, provider: "resend", from: cfg.from };
}
