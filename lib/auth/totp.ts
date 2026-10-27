import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238), the 6-digit codes authenticator apps
// (Google Authenticator, 1Password, Authy…) show: HMAC-SHA1 of the 30-second
// step number with a shared secret.

const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// A new random secret (160 bits, as the RFC recommends), base32 encoded.
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const n = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
}

// The step a code belongs to, if it's valid now: the current step or one
// either side (phone clocks drift). Steps at or before `lastUsedStep` are
// refused, so a code can't be used twice.
export function verifyCode(secret: string, code: string, lastUsedStep: number | null, now = Date.now()) {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastUsedStep != null && candidate <= lastUsedStep) continue;
    const expected = codeAt(secret, candidate);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return candidate;
  }
  return null;
}

// What the QR code holds; authenticator apps read the issuer and account name.
export function otpauthUri(secret: string, account: string, issuer = "MaidCare") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
