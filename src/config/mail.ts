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

export type MailTransportProfile = MailConfig & {
  /** Human-readable label for logs/diagnostics */
  label: string;
  /** TLS SNI hostname (important when connecting via localhost) */
  tlsServername: string;
  rejectUnauthorized: boolean;
};

function isLocalSmtpHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function deriveTlsServername(host: string): string {
  const configured = process.env.SMTP_TLS_SERVERNAME?.trim();
  if (configured) return configured;

  const from = process.env.MAIL_FROM?.trim();
  if (from?.includes("@")) {
    const domain = from.split("@")[1]?.trim();
    if (domain) return `mail.${domain}`;
  }

  return isLocalSmtpHost(host) ? "mail.fgco.in" : host;
}

function baseMailCredentials(): Omit<MailConfig, "host" | "port" | "secure"> | null {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM?.trim();

  if (!user || !pass || !from) {
    return null;
  }

  return {
    user,
    pass,
    from,
    fromName: process.env.MAIL_FROM_NAME?.trim() || "FG Media Hub",
  };
}

function buildProfile(
  host: string,
  port: number,
  secure: boolean,
  label: string,
  creds: Omit<MailConfig, "host" | "port" | "secure">,
): MailTransportProfile {
  const tlsServername = deriveTlsServername(host);
  const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "false" ? false : true;

  return {
    ...creds,
    host,
    port,
    secure,
    label,
    tlsServername,
    rejectUnauthorized: isLocalSmtpHost(host) ? false : rejectUnauthorized,
  };
}

/** Ordered SMTP endpoints to try. GoDaddy blocks outbound :465 to the public mail IP (EACCES). */
export function getSmtpTransportProfiles(): MailTransportProfile[] {
  const creds = baseMailCredentials();
  if (!creds) return [];

  const mailCreds = creds;
  const primaryHost = process.env.SMTP_HOST?.trim();
  if (!primaryHost) return [];

  const primaryPort = Number(process.env.SMTP_PORT) || 465;
  const primarySecure = process.env.SMTP_SECURE !== "false";
  const profiles: MailTransportProfile[] = [];
  const seen = new Set<string>();

  function add(host: string, port: number, secure: boolean, label: string) {
    const key = `${host}:${port}:${secure}`;
    if (seen.has(key)) return;
    seen.add(key);
    profiles.push(buildProfile(host, port, secure, label, mailCreds));
  }

  add(primaryHost, primaryPort, primarySecure, "primary");

  const fallbackHost = process.env.SMTP_FALLBACK_HOST?.trim();
  if (fallbackHost) {
    const fallbackPort = Number(process.env.SMTP_FALLBACK_PORT) || primaryPort;
    const fallbackSecure = process.env.SMTP_FALLBACK_SECURE
      ? process.env.SMTP_FALLBACK_SECURE !== "false"
      : primarySecure;
    add(fallbackHost, fallbackPort, fallbackSecure, "fallback-env");
  }

  // Auto-fallback for shared hosting: external mail hostname is often blocked outbound.
  if (!isLocalSmtpHost(primaryHost)) {
    add("localhost", primaryPort, primarySecure, "localhost-primary-port");
    if (primaryPort !== 587) {
      add("localhost", 587, false, "localhost-587-starttls");
    }
    if (primaryPort !== 25) {
      add("localhost", 25, false, "localhost-25");
    }
  }

  return profiles;
}

export function getMailConfig(): MailConfig | null {
  const profiles = getSmtpTransportProfiles();
  if (profiles.length === 0) return null;
  const primary = profiles[0];
  return {
    host: primary.host,
    port: primary.port,
    secure: primary.secure,
    user: primary.user,
    pass: primary.pass,
    from: primary.from,
    fromName: primary.fromName,
  };
}

export function logMailConfigStatus(): void {
  const profiles = getSmtpTransportProfiles();
  if (profiles.length === 0) {
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

  const primary = profiles[0];
  logger.info(
    {
      host: primary.host,
      port: primary.port,
      secure: primary.secure,
      from: primary.from,
      user: primary.user,
      fallbackCount: profiles.length - 1,
    },
    "SMTP configuration loaded",
  );
  console.log(
    `[mail] STARTUP — loaded ${primary.host}:${primary.port} as ${primary.user} (${profiles.length} profile(s) including fallbacks)`,
  );
}

export function getSmtpEaccesHint(host: string | null | undefined): string | null {
  if (!host || isLocalSmtpHost(host)) return null;
  return (
    "GoDaddy/cPanel often blocks outbound SMTP to the public mail server IP (EACCES). " +
    "Set SMTP_HOST=localhost and SMTP_TLS_SERVERNAME=mail.fgco.in on the host, or let the app auto-fallback to localhost."
  );
}
