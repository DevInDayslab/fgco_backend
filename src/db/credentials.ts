export type DbCredentials = {
  host: string;
  user: string;
  password: string | undefined;
  database: string;
  port: number;
  source: "local" | "godaddy";
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

  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const database = process.env.DB_NAME?.trim();

  if (!host || !user || !database) {
    return null;
  }

  return {
    host,
    user,
    password: process.env.DB_PASSWORD,
    database,
    port: Number(process.env.DB_PORT) || 3306,
    source: "godaddy",
  };
}

export function getMissingDbEnvMessage(): string {
  if (shouldUseLocalDb()) {
    return "LOCAL_DB_HOST / LOCAL_DB_USER / LOCAL_DB_NAME not set";
  }
  return "DB_HOST / DB_USER / DB_NAME not set";
}
