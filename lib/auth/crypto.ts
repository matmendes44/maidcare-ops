import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encryption for secrets kept in the database (two-step login secrets), with
// a key derived from AUTH_SECRET, so a copy of the database alone doesn't
// reveal them. AES-256-GCM: tampered values fail to decrypt.
function key(purpose: string) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters).");
  return Buffer.from(hkdfSync("sha256", secret, "maidcare-auth", purpose, 32));
}

export function encrypt(plain: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

export function decrypt(sealed: string, purpose: string) {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
