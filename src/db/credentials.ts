export type DbCredentials = {
  host: string;
  user: string;
  password: string | undefined;
  database: string;
  port: number;
  source: "local" | "cpanel";
};

export function shouldUseLocalDb(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.LOCAL_DB_HOST?.trim());
}

export function getDbCredentials(): DbCredentials | null {
  const useLocal = shouldUseLocalDb();

  if (useLocal) {
    const host = process.env.LOCAL_DB_HOST?.trim();
    const user = process.env.LOCAL_DB_USER?.trim();
    const database = process.env.LOCAL_DB_NAME?.trim();

    if (!host || !user || !database) {
      return null;
    }

    return {
      host,
      user,
      password: process.env.LOCAL_DB_PASS,
      database,
      port: Number(process.env.LOCAL_DB_PORT) || 3306,
      source: "local",
    };
  }

  const host = process.env.CPANEL_DB_HOST?.trim();
  const user = process.env.CPANEL_DB_USER?.trim();
  const database = process.env.CPANEL_DB_NAME?.trim();

  if (!host || !user || !database) {
    return null;
  }

  return {
    host,
    user,
    password: process.env.CPANEL_DB_PASS,
    database,
    port: Number(process.env.CPANEL_DB_PORT) || 3306,
    source: "cpanel",
  };
}

export function getMissingDbEnvMessage(): string {
  if (shouldUseLocalDb()) {
    return "LOCAL_DB_HOST / LOCAL_DB_USER / LOCAL_DB_NAME not set";
  }
  return "CPANEL_DB_HOST / CPANEL_DB_USER / CPANEL_DB_NAME not set";
}
