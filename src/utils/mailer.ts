import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import pino from "pino";
import {
  getMailConfig,
  getSmtpEaccesHint,
  getSmtpTransportProfiles,
  type MailTransportProfile,
} from "../config/mail.js";
import { RAMESH_EMAIL_IMAGE_CID } from "./templates.js";

const logger = pino({ name: "fg-media-hub-mailer" });

let activeProfile: MailTransportProfile | null = null;
let transporter: Transporter | null = null;
let sendQueue: Promise<void> = Promise.resolve();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const RAMESH_EMAIL_IMAGE_PATH = path.resolve(__dirname, "../../assets/email/ramesh.jpg");

function mailConsole(message: string, details?: Record<string, unknown>) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[mail] ${message}${suffix}`);
}

function profileKey(profile: MailTransportProfile): string {
  return `${profile.label}:${profile.host}:${profile.port}:${profile.secure}`;
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

function createTransporter(profile: MailTransportProfile): Transporter {
  return nodemailer.createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: {
      user: profile.user,
      pass: profile.pass,
    },
    pool: false,
    maxConnections: 1,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    family: 4,
    tls: {
      minVersion: "TLSv1.2",
      servername: profile.tlsServername,
      rejectUnauthorized: profile.rejectUnauthorized,
    },
  } as nodemailer.TransportOptions);
}

function getTransporterForProfile(profile: MailTransportProfile): Transporter {
  if (activeProfile && transporter && profileKey(activeProfile) === profileKey(profile)) {
    return transporter;
  }

  resetTransporter();
  activeProfile = profile;
  transporter = createTransporter(profile);
  return transporter;
}

function isBlockedOutboundSmtpError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "EACCES" || code === "EPERM";
}

function isRetryableSmtpError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return (
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EENVELOPE" ||
    isBlockedOutboundSmtpError(error)
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

async function verifyProfile(profile: MailTransportProfile): Promise<void> {
  const transport = createTransporter(profile);
  try {
    await transport.verify();
  } finally {
    try {
      transport.close();
    } catch {
      // ignore
    }
  }
}

async function sendWithProfile(
  profile: MailTransportProfile,
  mail: { from: string; to: string; subject: string; html: string; attachments?: ReturnType<typeof buildInlineAttachments> },
) {
  const transport = getTransporterForProfile(profile);
  return transport.sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    ...(mail.attachments ? { attachments: mail.attachments } : {}),
  });
}

async function resolveWorkingProfile(
  purpose: "verify" | "send",
): Promise<{ profile: MailTransportProfile; attempted: string[] }> {
  const profiles = getSmtpTransportProfiles();
  if (profiles.length === 0) {
    throw new Error(`SMTP not configured — missing: ${getMissingMailEnvVars().join(", ") || "unknown"}`);
  }

  if (purpose === "send" && activeProfile) {
    return { profile: activeProfile, attempted: [profileKey(activeProfile)] };
  }

  const attempted: string[] = [];
  let lastError: unknown;

  for (const profile of profiles) {
    attempted.push(profileKey(profile));
    try {
      await verifyProfile(profile);
      mailConsole(`${purpose.toUpperCase()} profile OK`, {
        label: profile.label,
        host: profile.host,
        port: profile.port,
        secure: profile.secure,
        tlsServername: profile.tlsServername,
      });
      activeProfile = profile;
      return { profile, attempted };
    } catch (error) {
      lastError = error;
      const meta = smtpErrorMeta(error);
      mailConsole(`${purpose.toUpperCase()} profile failed`, {
        label: profile.label,
        host: profile.host,
        port: profile.port,
        ...meta,
      });
      resetTransporter();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All SMTP profiles failed");
}

export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  durationMs: number;
  host?: string;
  port?: number;
  user?: string;
  label?: string;
  attemptedProfiles?: string[];
  hint?: string | null;
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
  activeProfile = null;
  resetTransporter();

  try {
    const { profile, attempted } = await resolveWorkingProfile("verify");
    const durationMs = Date.now() - started;
    mailConsole("SMTP verify OK", {
      label: profile.label,
      host: profile.host,
      port: profile.port,
      user: profile.user,
      durationMs,
      attemptedProfiles: attempted,
    });
    logger.info(
      { label: profile.label, host: profile.host, port: profile.port, user: profile.user, durationMs },
      "SMTP verify OK",
    );
    return {
      ok: true,
      durationMs,
      host: profile.host,
      port: profile.port,
      user: profile.user,
      label: profile.label,
      attemptedProfiles: attempted,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const smtp = smtpErrorMeta(error);
    const errorMessage = smtp.message ?? "SMTP verify failed";
    const hint = isBlockedOutboundSmtpError(error) ? getSmtpEaccesHint(cfg.host) : null;
    mailConsole("SMTP verify FAILED (all profiles)", { ...smtp, host: cfg.host, port: cfg.port, durationMs, hint });
    logger.error({ err: error, smtp, host: cfg.host, port: cfg.port, durationMs, hint }, "SMTP verify failed");
    return {
      ok: false,
      durationMs,
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      hint,
      error: hint ? `${errorMessage} — ${hint}` : errorMessage,
      smtp,
      attemptedProfiles: getSmtpTransportProfiles().map((p) => profileKey(p)),
    };
  }
}

export async function getMailDiagnostics(options?: { verify?: boolean }) {
  const cfg = getMailConfig();
  const missing = getMissingMailEnvVars();
  const ceoImageExists = fs.existsSync(RAMESH_EMAIL_IMAGE_PATH);
  const profiles = getSmtpTransportProfiles();

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
    activeProfile: activeProfile
      ? {
          label: activeProfile.label,
          host: activeProfile.host,
          port: activeProfile.port,
          secure: activeProfile.secure,
          tlsServername: activeProfile.tlsServername,
        }
      : null,
    transportProfiles: profiles.map((p) => ({
      label: p.label,
      host: p.host,
      port: p.port,
      secure: p.secure,
      tlsServername: p.tlsServername,
    })),
    eaccesHint: getSmtpEaccesHint(cfg?.host),
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

  const fromAddress = `"${cfg.fromName}" <${cfg.from}>`;
  const attachments = buildInlineAttachments(html);

  async function attempt(retrying: boolean, tryAllProfiles: boolean): Promise<boolean> {
    try {
      if (tryAllProfiles) {
        activeProfile = null;
        resetTransporter();
      }

      const { profile } = await resolveWorkingProfile("send");
      mailConsole("SEND start", {
        to,
        subject,
        retrying,
        label: profile.label,
        host: profile.host,
        port: profile.port,
      });

      const info = await sendWithProfile(profile, {
        from: fromAddress,
        to,
        subject,
        html,
        attachments,
      });

      logger.info(
        {
          to,
          subject,
          messageId: info.messageId,
          attachedCeoPhoto: Boolean(attachments),
          profile: profile.label,
          host: profile.host,
        },
        "Email sent",
      );
      mailConsole("SEND ok", {
        to,
        subject,
        messageId: info.messageId,
        attachedCeoPhoto: Boolean(attachments),
        profile: profile.label,
        host: profile.host,
      });
      return true;
    } catch (error) {
      const meta = smtpErrorMeta(error);
      logger.warn({ err: meta, to, subject, retrying, tryAllProfiles }, "SMTP send failed");
      mailConsole("SEND failed", { to, subject, retrying, tryAllProfiles, ...meta });

      if (!retrying && isRetryableSmtpError(error)) {
        mailConsole("SEND retry with alternate SMTP profile(s)", { to, subject });
        resetTransporter();
        activeProfile = null;
        return attempt(true, true);
      }

      logger.error({ err: error, ...meta, to, subject }, "Error sending email");
      resetTransporter();
      activeProfile = null;
      return false;
    }
  }

  return attempt(false, false);
}

export async function sendSimpleTestEmail(to: string): Promise<{
  sent: boolean;
  subject: string;
  messageId?: string;
  error?: string;
  hint?: string | null;
  profile?: string;
  host?: string;
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

  const fromAddress = `"${cfg.fromName}" <${cfg.from}>`;

  try {
    activeProfile = null;
    resetTransporter();
    const { profile } = await resolveWorkingProfile("send");
    mailConsole("TEST SEND start", {
      to,
      label: profile.label,
      host: profile.host,
      port: profile.port,
    });
    const info = await sendWithProfile(profile, {
      from: fromAddress,
      to,
      subject,
      html,
    });
    mailConsole("TEST SEND ok", { to, messageId: info.messageId, profile: profile.label, host: profile.host });
    return {
      sent: true,
      subject,
      messageId: info.messageId,
      profile: profile.label,
      host: profile.host,
    };
  } catch (error) {
    const smtp = smtpErrorMeta(error);
    const hint = isBlockedOutboundSmtpError(error) ? getSmtpEaccesHint(cfg.host) : null;
    mailConsole("TEST SEND failed", { to, ...smtp, hint });
    resetTransporter();
    activeProfile = null;
    return {
      sent: false,
      subject,
      error: hint ? `${smtp.message ?? "Test send failed"} — ${hint}` : smtp.message ?? "Test send failed",
      hint,
      smtp,
    };
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
    profiles: diagnostics.transportProfiles,
    verifyOk: "verify" in diagnostics ? diagnostics.verify?.ok : undefined,
    verifyError: "verify" in diagnostics ? diagnostics.verify?.error : undefined,
    activeProfile: diagnostics.activeProfile,
  });
}
