import sharp from "sharp";

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isImageContentType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType.toLowerCase());
}

export async function compressImageBuffer(
  buffer: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string; compressed: boolean }> {
  if (!isImageContentType(contentType)) {
    return { buffer, contentType, compressed: false };
  }

  const compressed = await sharp(buffer)
    .rotate()
    .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return { buffer: compressed, contentType: "image/jpeg", compressed: true };
}
