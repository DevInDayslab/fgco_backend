import pino from "pino";

const logger = pino({ name: "fg-media-hub-mail" });

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

export function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM?.trim();

  if (!host || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== "false",
    user,
    pass,
    from,
    fromName: process.env.MAIL_FROM_NAME?.trim() || "FG Media Hub",
  };
}

export function logMailConfigStatus(): void {
  const cfg = getMailConfig();
  if (!cfg) {
    logger.warn("SMTP not fully configured — email sending disabled until env is set");
    return;
  }
  logger.info({ host: cfg.host, port: cfg.port, from: cfg.from }, "SMTP configuration loaded");
}
