import type { Request, Response } from "express";
import { readStoredFile } from "../storage/index.js";

export async function getAdminFile(req: Request, res: Response) {
  const key = typeof req.query.key === "string" ? req.query.key.trim() : "";

  if (!key || key.includes("..")) {
    res.status(400).json({ error: "Invalid file key" });
    return;
  }

  const file = await readStoredFile(key);
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(file.buffer);
}
