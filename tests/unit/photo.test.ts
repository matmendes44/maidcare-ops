// Profile photos: real photos only.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { toAvatar } from "../../lib/photo";

test("a PNG becomes a 256x256 WebP", async () => {
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#3174e7" } }).png().toBuffer();
  const out = await toAvatar(png);
  assert.ok(out);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
});

test("SVG, PDF and junk are refused before decoding", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="file:///etc/passwd"/></svg>');
  assert.equal(await toAvatar(svg), null);
  assert.equal(await toAvatar(Buffer.from("%PDF-1.4\n%fake")), null);
  assert.equal(await toAvatar(Buffer.from("not an image at all")), null);
});
