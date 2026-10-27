// Receipt uploads: photos are re-encoded, PDFs kept, everything else refused.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { MAX_RECEIPT_BYTES, receiptName, toReceipt } from "../../lib/receipts";

test("a photo becomes a WebP no larger than 2000px, without its metadata", async () => {
  const jpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#cde" } })
    .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
    .jpeg()
    .toBuffer();
  const r = await toReceipt(jpeg, "IMG_1234.JPG");
  assert.ok(r);
  assert.equal(r.contentType, "image/webp");
  assert.equal(r.fileName, "IMG_1234.webp");
  const meta = await sharp(r.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width!, meta.height!), 2000);
  assert.equal(meta.exif, undefined);
});

test("a PDF is kept as uploaded", async () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  const r = await toReceipt(pdf, "Sams Club receipt.pdf");
  assert.deepEqual(r, { fileName: "Sams Club receipt.pdf", contentType: "application/pdf", data: pdf });
});

test("SVG, HTML, empty and oversized files are refused", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(await toReceipt(svg, "r.svg"), null);
  assert.equal(await toReceipt(Buffer.from("<html><script>alert(1)</script>"), "r.pdf"), null);
  assert.equal(await toReceipt(Buffer.alloc(0), "r.jpg"), null);
  assert.equal(await toReceipt(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_RECEIPT_BYTES)]), "big.pdf"), null);
});

test("file names lose folders, quotes and control characters", () => {
  assert.equal(receiptName("../../etc/passwd", "pdf"), "passwd.pdf");
  assert.equal(receiptName('C:\\Users\\me\\a"b\r\n.png', "webp"), "ab.webp");
  assert.equal(receiptName("", "pdf"), "receipt.pdf");
  assert.equal(receiptName("x".repeat(300) + ".jpg", "webp").length, 105);
});
