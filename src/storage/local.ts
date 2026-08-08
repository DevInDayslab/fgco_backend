import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function getLocalUploadRoot(): string {
  const configured = process.env.LOCAL_UPLOAD_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(backendRoot, configured);
  }
  return path.join(backendRoot, "uploads");
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export function buildStorageKey(purpose: string, originalName: string): string {
  const safeName = sanitizeFilename(originalName);
  return `nominations/${purpose}/${randomUUID()}-${safeName}`;
}

export function resolveLocalPath(key: string): string {
  if (key.includes("..")) {
    throw new Error("Invalid storage key");
  }
  return path.join(getLocalUploadRoot(), key);
}

export async function ensureDirForKey(key: string): Promise<string> {
  const fullPath = resolveLocalPath(key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  return fullPath;
}

export async function writeLocalFile(key: string, buffer: Buffer): Promise<void> {
  const fullPath = await ensureDirForKey(key);
  await fs.writeFile(fullPath, buffer);
}

export async function readLocalFile(key: string): Promise<Buffer | null> {
  try {
    const fullPath = resolveLocalPath(key);
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
}

export async function initLocalStorage(): Promise<void> {
  await fs.mkdir(getLocalUploadRoot(), { recursive: true });
}
