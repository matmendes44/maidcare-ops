// Two-step login codes (RFC 6238).
import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, codeAt, generateSecret, otpauthUri, verifyCode } from "../../lib/auth/totp";

const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("matches the RFC 6238 test vectors", () => {
  assert.equal(codeAt(RFC_SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(codeAt(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(codeAt(RFC_SECRET, Math.floor(1234567890 / 30)), "005924");
  assert.equal(codeAt(RFC_SECRET, Math.floor(2000000000 / 30)), "279037");
});

test("base32 round-trips", () => {
  assert.equal(base32Decode(RFC_SECRET).toString(), "12345678901234567890");
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
});

test("accepts the current code and one step either side, nothing older", () => {
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step), null, now), step);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), null, now), step - 1);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step + 1), null, now), step + 1);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 2), null, now), null);
  assert.equal(verifyCode(RFC_SECRET, "12345", null, now), null);
  assert.equal(verifyCode(RFC_SECRET, "abcdef", null, now), null);
});

test("a code can't be used twice", () => {
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const code = codeAt(RFC_SECRET, step);
  assert.equal(verifyCode(RFC_SECRET, code, step, now), null);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), step - 1, now), null);
});

test("otpauth URI names the app and account", () => {
  const uri = otpauthUri("JBSWY3DPEHPK3PXP", "owner@example.com");
  assert.match(uri, /^otpauth:\/\/totp\/MaidCare%3Aowner%40example\.com\?secret=JBSWY3DPEHPK3PXP&issuer=MaidCare/);
});
