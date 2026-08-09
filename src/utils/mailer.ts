import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import pino from "pino";
import { getMailConfig, type MailConfig } from "../config/mail.js";
import { RAMESH_EMAIL_IMAGE_CID } from "./templates.js";

const logger = pino({ name: "fg-media-hub-mailer" });

let transporter: Transporter | null = null;
let sendQueue: Promise<void> = Promise.resolve();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const RAMESH_EMAIL_IMAGE_PATH = path.resolve(__dirname, "../../assets/email/ramesh.jpg");

function mailConsole(message: string, details?: Record<string, unknown>) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[mail] ${message}${suffix}`);
}

function resetTransporter() {
  if (transporter) {
    try {
      transporter.close();
    } catch {
      // ignore close errors on dead sockets
    }
  }
  transporter = null;
}

function createTransporter(cfg: MailConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    pool: false,
    maxConnections: 1,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    family: 4,
    tls: {
      minVersion: "TLSv1.2",
      servername: cfg.host,
    },
  } as nodemailer.TransportOptions);
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const cfg = getMailConfig();
  if (!cfg) return null;

  transporter = createTransporter(cfg);
  return transporter;
}

function isRetryableSmtpError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return (
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EENVELOPE"
  );
}

export function smtpErrorMeta(error: unknown) {
  const err = error as {
    code?: string;
    command?: string;
    response?: string;
    responseCode?: number;
    message?: string;
  };
  return {
    code: err?.code,
    command: err?.command,
    response: err?.response,
    responseCode: err?.responseCode,
    message: err?.message,
  };
}

function getMissingMailEnvVars(): string[] {
  return [
    !process.env.SMTP_HOST?.trim() && "SMTP_HOST",
    !process.env.SMTP_USER?.trim() && "SMTP_USER",
    !process.env.SMTP_PASS && "SMTP_PASS",
    !process.env.MAIL_FROM?.trim() && "MAIL_FROM",
  ].filter(Boolean) as string[];
}

function buildInlineAttachments(html: string) {
  if (!html.includes(`cid:${RAMESH_EMAIL_IMAGE_CID}`)) {
    return undefined;
  }

  if (!fs.existsSync(RAMESH_EMAIL_IMAGE_PATH)) {
    logger.warn({ path: RAMESH_EMAIL_IMAGE_PATH }, "CEO email image missing — sending without photo");
    mailConsole("CEO email image missing", { path: RAMESH_EMAIL_IMAGE_PATH });
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

export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  durationMs: number;
  host?: string;
  port?: number;
  user?: string;
  error?: string;
  smtp?: ReturnType<typeof smtpErrorMeta>;
}> {
  const cfg = getMailConfig();
  if (!cfg) {
    return {
      ok: false,
      durationMs: 0,
      error: `SMTP not configured — missing: ${getMissingMailEnvVars().join(", ") || "unknown"}`,
    };
  }

  const started = Date.now();
  const transport = createTransporter(cfg);

  try {
    await transport.verify();
    const durationMs = Date.now() - started;
    mailConsole("SMTP verify OK", {
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      durationMs,
    });
    logger.info({ host: cfg.host, port: cfg.port, user: cfg.user, durationMs }, "SMTP verify OK");
    transport.close();
    return {
      ok: true,
      durationMs,
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const smtp = smtpErrorMeta(error);
    const errorMessage = smtp.message ?? "SMTP verify failed";
    mailConsole("SMTP verify FAILED", { ...smtp, host: cfg.host, port: cfg.port, durationMs });
    logger.error({ err: error, smtp, host: cfg.host, port: cfg.port, durationMs }, "SMTP verify failed");
    try {
      transport.close();
    } catch {
      // ignore
    }
    return {
      ok: false,
      durationMs,
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      error: errorMessage,
      smtp,
    };
  }
}

export async function getMailDiagnostics(options?: { verify?: boolean }) {
  const cfg = getMailConfig();
  const missing = getMissingMailEnvVars();
  const ceoImageExists = fs.existsSync(RAMESH_EMAIL_IMAGE_PATH);

  const base = {
    configured: Boolean(cfg),
    missing,
    host: cfg?.host ?? null,
    port: cfg?.port ?? null,
    secure: cfg?.secure ?? null,
    user: cfg?.user ?? null,
    from: cfg?.from ?? null,
    fromName: cfg?.fromName ?? null,
    passSet: Boolean(process.env.SMTP_PASS),
    ceoImageExists,
    ceoImagePath: RAMESH_EMAIL_IMAGE_PATH,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  };

  if (!options?.verify) {
    return base;
  }

  const verify = await verifySmtpConnection();
  return { ...base, verify };
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = getMailConfig();
  if (!cfg) {
    logger.warn({ to, subject }, "SMTP not configured — email skipped");
    mailConsole("SKIP — SMTP not configured", { to, subject });
    return false;
  }

  const mailCfg = cfg;
  const fromAddress = `"${mailCfg.fromName}" <${mailCfg.from}>`;
  const attachments = buildInlineAttachments(html);

  async function attempt(retrying: boolean): Promise<boolean> {
    const transport = getTransporter();
    if (!transport) {
      logger.warn({ to, subject }, "SMTP not configured — email skipped");
      mailConsole("SKIP — no transporter", { to, subject });
      return false;
    }

    try {
      mailConsole("SEND start", { to, subject, retrying, host: mailCfg.host });
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
      mailConsole("SEND ok", {
        to,
        subject,
        messageId: info.messageId,
        attachedCeoPhoto: Boolean(attachments),
      });
      return true;
    } catch (error) {
      const meta = smtpErrorMeta(error);
      logger.warn({ err: meta, to, subject, retrying }, "SMTP send failed");
      mailConsole("SEND failed", { to, subject, retrying, ...meta });

      if (!retrying && isRetryableSmtpError(error)) {
        logger.warn({ to, subject }, "SMTP connection error — retrying with fresh connection");
        mailConsole("SEND retry with fresh connection", { to, subject });
        resetTransporter();
        return attempt(true);
      }

      logger.error({ err: error, ...meta, to, subject }, "Error sending email");
      resetTransporter();
      return false;
    }
  }

  return attempt(false);
}

export async function sendSimpleTestEmail(to: string): Promise<{
  sent: boolean;
  subject: string;
  messageId?: string;
  error?: string;
  smtp?: ReturnType<typeof smtpErrorMeta>;
}> {
  const subject = `FG Media Hub SMTP test — ${new Date().toISOString()}`;
  const html = `<p>This is a test email from the FG Media Hub API.</p><p>Time: ${new Date().toISOString()}</p>`;
  const cfg = getMailConfig();

  if (!cfg) {
    return {
      sent: false,
      subject,
      error: `SMTP not configured — missing: ${getMissingMailEnvVars().join(", ")}`,
    };
  }

  const transport = createTransporter(cfg);
  const fromAddress = `"${cfg.fromName}" <${cfg.from}>`;

  try {
    mailConsole("TEST SEND start", { to, host: cfg.host, port: cfg.port });
    const info = await transport.sendMail({ from: fromAddress, to, subject, html });
    mailConsole("TEST SEND ok", { to, messageId: info.messageId });
    transport.close();
    return { sent: true, subject, messageId: info.messageId };
  } catch (error) {
    const smtp = smtpErrorMeta(error);
    mailConsole("TEST SEND failed", { to, ...smtp });
    try {
      transport.close();
    } catch {
      // ignore
    }
    return { sent: false, subject, error: smtp.message ?? "Test send failed", smtp };
  }
}

export function sendEmailAsync(to: string, subject: string, html: string): void {
  mailConsole("QUEUE email", { to, subject });
  sendQueue = sendQueue
    .then(() => sendEmail(to, subject, html))
    .then(() => undefined)
    .catch((error) => {
      logger.error({ err: error, to, subject }, "Queued email task failed");
      mailConsole("QUEUE failed", { to, subject, error: smtpErrorMeta(error) });
    });
}

export async function runStartupMailCheck(): Promise<void> {
  const diagnostics = await getMailDiagnostics({ verify: true });
  if (!diagnostics.configured) {
    mailConsole("STARTUP — SMTP not configured", { missing: diagnostics.missing });
    return;
  }

  mailConsole("STARTUP — SMTP configured", {
    host: diagnostics.host,
    port: diagnostics.port,
    user: diagnostics.user,
    from: diagnostics.from,
    ceoImageExists: diagnostics.ceoImageExists,
    verifyOk: "verify" in diagnostics ? diagnostics.verify?.ok : undefined,
    verifyError: "verify" in diagnostics ? diagnostics.verify?.error : undefined,
  });
}
