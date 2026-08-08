import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import pino from "pino";
import { getMailConfig } from "../config/mail.js";
import { RAMESH_EMAIL_IMAGE_CID } from "./templates.js";

const logger = pino({ name: "fg-media-hub-mailer" });

let transporter: Transporter | null = null;
let sendQueue: Promise<void> = Promise.resolve();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAMESH_EMAIL_IMAGE_PATH = path.resolve(__dirname, "../../assets/email/ramesh.jpg");

function resetTransporter() {
  transporter = null;
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const cfg = getMailConfig();
  if (!cfg) return null;

  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  return transporter;
}

function isRetryableSmtpError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return code === "ESOCKET" || code === "ECONNECTION" || code === "ETIMEDOUT";
}

function buildInlineAttachments(html: string) {
  if (!html.includes(`cid:${RAMESH_EMAIL_IMAGE_CID}`)) {
    return undefined;
  }

  if (!fs.existsSync(RAMESH_EMAIL_IMAGE_PATH)) {
    logger.warn({ path: RAMESH_EMAIL_IMAGE_PATH }, "CEO email image missing — sending without photo");
    return undefined;
  }

  return [
    {
      filename: "ramesh.jpg",
      path: RAMESH_EMAIL_IMAGE_PATH,
      cid: RAMESH_EMAIL_IMAGE_CID,
      contentType: "image/jpeg",
      contentDisposition: "inline" as const,
    },
  ];
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = getMailConfig();
  if (!cfg) {
    logger.warn({ to, subject }, "SMTP not configured — email skipped");
    return false;
  }

  const fromAddress = `"${cfg.fromName}" <${cfg.from}>`;
  const attachments = buildInlineAttachments(html);

  async function attempt(retrying: boolean): Promise<boolean> {
    const transport = getTransporter();
    if (!transport) {
      logger.warn({ to, subject }, "SMTP not configured — email skipped");
      return false;
    }

    try {
      const info = await transport.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        ...(attachments ? { attachments } : {}),
      });
      logger.info(
        { to, subject, messageId: info.messageId, attachedCeoPhoto: Boolean(attachments) },
        "Email sent",
      );
      return true;
    } catch (error) {
      if (!retrying && isRetryableSmtpError(error)) {
        logger.warn({ to, subject }, "SMTP connection error — retrying with fresh connection");
        resetTransporter();
        return attempt(true);
      }

      logger.error({ err: error, to, subject }, "Error sending email");
      return false;
    }
  }

  return attempt(false);
}

export function sendEmailAsync(to: string, subject: string, html: string): void {
  sendQueue = sendQueue
    .then(() => sendEmail(to, subject, html))
    .then(() => undefined)
    .catch((error) => {
      logger.error({ err: error, to, subject }, "Queued email task failed");
    });
}
