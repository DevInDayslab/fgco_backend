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
    const missing = [
      !process.env.SMTP_HOST?.trim() && "SMTP_HOST",
      !process.env.SMTP_USER?.trim() && "SMTP_USER",
      !process.env.SMTP_PASS && "SMTP_PASS",
      !process.env.MAIL_FROM?.trim() && "MAIL_FROM",
    ].filter(Boolean);
    logger.warn(
      { missing },
      "SMTP not fully configured — email sending disabled until env is set",
    );
    console.log(`[mail] STARTUP — missing env: ${missing.join(", ") || "unknown"}`);
    return;
  }
  logger.info(
    { host: cfg.host, port: cfg.port, secure: cfg.secure, from: cfg.from, user: cfg.user },
    "SMTP configuration loaded",
  );
  console.log(
    `[mail] STARTUP — loaded ${cfg.host}:${cfg.port} as ${cfg.user} (from ${cfg.from})`,
  );
}
