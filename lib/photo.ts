import sharp from "sharp";

// Profile photos: only real photo formats are decoded (SVG and document
// formats can reference files and have a history of parser bugs), with a
// pixel limit against decompression bombs. Returns a 256x256 WebP, or null
// for anything that isn't a readable photo.
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif", "gif"]);
const LIMIT = { limitInputPixels: 50_000_000 };

export async function toAvatar(input: Buffer): Promise<Buffer | null> {
  try {
    const { format } = await sharp(input, LIMIT).metadata();
    if (!format || !PHOTO_FORMATS.has(format)) return null;
    return await sharp(input, LIMIT)
      .rotate() // respect the phone's orientation
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}
