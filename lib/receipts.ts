import sharp from "sharp";

// Receipt uploads. Photos are decoded and re-encoded as WebP (at most 2000px
// on the long side): that strips location and other metadata, and anything
// that isn't really a photo fails to decode. PDFs are checked by their
// signature and kept as uploaded. Everything else (SVG, HTML, Office files…)
// is refused.
export const MAX_RECEIPT_BYTES = 4_000_000; // each request must stay under Vercel's 4.5MB
export const MAX_RECEIPTS_PER_EXPENSE = 10;
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif", "gif", "tiff"]);
const LIMIT = { limitInputPixels: 60_000_000 };

export type Receipt = { fileName: string; contentType: "image/webp" | "application/pdf"; data: Buffer };

// A safe display name: no folders, control characters or quotes, at most 100
// characters, with the extension of what's actually stored.
export function receiptName(original: string, ext: "webp" | "pdf") {
  const base = (original.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .trim()
    .slice(0, 100);
  return `${base || "receipt"}.${ext}`;
}

export async function toReceipt(input: Buffer, originalName: string): Promise<Receipt | null> {
  if (input.length === 0 || input.length > MAX_RECEIPT_BYTES) return null;
  if (input.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { fileName: receiptName(originalName, "pdf"), contentType: "application/pdf", data: input };
  }
  try {
    const { format } = await sharp(input, LIMIT).metadata();
    if (!format || !PHOTO_FORMATS.has(format)) return null;
    const data = await sharp(input, LIMIT)
      .rotate() // respect the phone's orientation
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { fileName: receiptName(originalName, "webp"), contentType: "image/webp", data };
  } catch {
    return null;
  }
}
