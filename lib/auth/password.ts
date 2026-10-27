// Password hashing with scrypt (built into Node, memory-hard). No "server-only"
// import here so the `npm run users` script can use it too.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP's recommended scrypt cost: N=2^17, r=8, p=1 (~128 MiB per hash).
const LOG_N = 17;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export { MIN_PASSWORD_LENGTH } from "./password-rules";

function derive(password: string, salt: Buffer, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    // scrypt needs 128 * N * r bytes; allow double that
    const maxmem = 256 * (opts.N ?? 0) * (opts.r ?? 0);
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { ...opts, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// Stored as scrypt$<logN>$<r>$<p>$<salt>$<hash> so the cost can be raised
// later without breaking existing hashes.
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N: 2 ** LOG_N, r: R, p: P });
  return ["scrypt", LOG_N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, logN, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  // refuse costs far above ours rather than allocating gigabytes
  if (!(Number(logN) <= 20 && Number(r) <= 16 && Number(p) <= 4)) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), {
    N: 2 ** Number(logN),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Checked against when the email doesn't exist, so a wrong email takes as
// long as a wrong password and can't be used to discover accounts.
let dummyHash: Promise<string> | undefined;
export function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
