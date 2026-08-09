import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RAMESH_EMAIL_IMAGE_CID } from "./templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RAMESH_EMAIL_IMAGE_PATH = path.resolve(__dirname, "../../assets/email/ramesh.jpg");

export function ceoImageExists(): boolean {
  return fs.existsSync(RAMESH_EMAIL_IMAGE_PATH);
}

export function htmlUsesCeoImage(html: string): boolean {
  return html.includes(`cid:${RAMESH_EMAIL_IMAGE_CID}`);
}

export function readCeoImageBuffer(): Buffer | null {
  if (!ceoImageExists()) return null;
  return fs.readFileSync(RAMESH_EMAIL_IMAGE_PATH);
}

export function buildNodemailerCeoAttachments(html: string) {
  if (!htmlUsesCeoImage(html)) return undefined;

  const buffer = readCeoImageBuffer();
  if (!buffer) return undefined;

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

export function buildResendCeoAttachments(html: string) {
  if (!htmlUsesCeoImage(html)) return undefined;

  const buffer = readCeoImageBuffer();
  if (!buffer) return undefined;

  return [
    {
      filename: "ramesh.jpg",
      content: buffer,
      contentType: "image/jpeg",
      inlineContentId: RAMESH_EMAIL_IMAGE_CID,
    },
  ];
}
