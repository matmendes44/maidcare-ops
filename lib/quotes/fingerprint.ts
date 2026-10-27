import { createHash } from "node:crypto";

// JSON with keys in a fixed order, so the same document always gives the
// same fingerprint.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

// SHA-256 of what the customer saw and accepted: stored with the acceptance,
// so it can be shown later that the record wasn't altered.
export const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
