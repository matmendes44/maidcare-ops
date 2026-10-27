// Where to send someone after signing in (?next=…): only a path on this site.
// Browsers silently drop tabs and newlines from addresses and treat "\" as
// "/", so "/<tab>/evil.com" or "/\evil.com" would become "//evil.com" (another
// site). Such characters are refused outright, and what's left is resolved
// like a browser would and must stay on this site.
const BASE = "http://this-site.invalid";

export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1000) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
