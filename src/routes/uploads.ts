import type { Request, Response } from "express";
import { z } from "zod";
import { buildStorageKey, sanitizeFilename } from "../storage/local.js";
import { getPublicFileUrl, storeFile, type UploadPurpose } from "../storage/index.js";

const purposeSchema = z.enum(["profile", "document", "video"]);

const ALLOWED_TYPES: Record<UploadPurpose, Set<string>> = {
  profile: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]),
  document: new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
  ]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
};

const MAX_BYTES: Record<UploadPurpose, number> = {
  profile: 8 * 1024 * 1024,
  document: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

export async function postUpload(req: Request, res: Response) {
  const parsedPurpose = purposeSchema.safeParse(req.body?.purpose ?? req.query?.purpose);
  if (!parsedPurpose.success) {
    res.status(400).json({ error: "Invalid upload purpose" });
    return;
  }

  const purpose = parsedPurpose.data;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const contentType = file.mimetype.toLowerCase();
  if (!ALLOWED_TYPES[purpose].has(contentType)) {
    res.status(400).json({ error: `File type not allowed for ${purpose}` });
    return;
  }

  if (file.size > MAX_BYTES[purpose]) {
    res.status(400).json({
      error: `File too large. Max ${Math.round(MAX_BYTES[purpose] / (1024 * 1024))}MB for ${purpose}.`,
    });
    return;
  }

  const originalName = sanitizeFilename(file.originalname || "upload");
  const key = buildStorageKey(purpose, originalName);

  try {
    const stored = await storeFile(key, file.buffer, contentType, originalName, purpose);
    const publicUrl = getPublicFileUrl(stored.key);

    res.status(201).json({
      ok: true,
      key: stored.key,
      contentType: stored.contentType,
      size: stored.size,
      originalName: stored.originalName,
      originalSize: stored.originalSize,
      compressed: stored.compressed,
      publicUrl,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Upload failed",
    });
  }
}
