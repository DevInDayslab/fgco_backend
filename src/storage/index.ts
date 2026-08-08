import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readLocalFile, writeLocalFile } from "./local.js";
import { compressImageBuffer } from "./compress.js";

export type UploadPurpose = "profile" | "document" | "video";

export type StoredFileMeta = {
  key: string;
  contentType: string;
  size: number;
  originalName: string;
  originalSize: number;
  compressed: boolean;
};

function useR2(): boolean {
  return Boolean(
    process.env.R2_BUCKET_NAME?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_ACCOUNT_ID?.trim(),
  );
}

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!.trim();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    },
  });
}

function getR2Bucket(): string {
  return process.env.R2_BUCKET_NAME!.trim();
}

export function getStorageMode(): "local" | "r2" {
  return useR2() ? "r2" : "local";
}

export async function storeFile(
  key: string,
  buffer: Buffer,
  contentType: string,
  originalName: string,
  purpose: UploadPurpose,
): Promise<StoredFileMeta> {
  const originalSize = buffer.length;
  let output = buffer;
  let outputType = contentType;
  let compressed = false;

  if (purpose === "profile" || purpose === "document") {
    const result = await compressImageBuffer(buffer, contentType);
    output = result.buffer;
    outputType = result.contentType;
    compressed = result.compressed;
  }

  if (useR2()) {
    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        Body: output,
        ContentType: outputType,
      }),
    );
  } else {
    await writeLocalFile(key, output);
  }

  return {
    key,
    contentType: outputType,
    size: output.length,
    originalName,
    originalSize,
    compressed,
  };
}

export async function readStoredFile(key: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  if (key.includes("..")) {
    return null;
  }

  if (useR2()) {
    const client = getR2Client();
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: getR2Bucket(), Key: key }),
      );
      const body = response.Body;
      if (!body) return null;
      const bytes = await body.transformToByteArray();
      return {
        buffer: Buffer.from(bytes),
        contentType: response.ContentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  const buffer = await readLocalFile(key);
  if (!buffer) return null;

  const ext = key.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "pdf"
      ? "application/pdf"
      : ext === "mp4"
        ? "video/mp4"
        : ext === "mov"
          ? "video/quicktime"
          : ext === "webm"
            ? "video/webm"
            : "image/jpeg";

  return { buffer, contentType };
}

export function getPublicFileUrl(key: string): string | null {
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!useR2() || !publicBase) return null;
  return `${publicBase.replace(/\/$/, "")}/${key}`;
}

export { initLocalStorage } from "./local.js";
