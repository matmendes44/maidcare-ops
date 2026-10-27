// Logs a failure without the values that went into it. Drizzle puts a failed
// query's parameters (password hashes, customer details) in the error
// message, so only the first line of each message (the SQL, not the
// values), plus database and Stripe error codes, is kept.
export function logError(label: string, err: unknown) {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error) {
      const x = e as Error & { code?: string; constraint?: string; type?: string; requestId?: string; statusCode?: number };
      const message = e.message.startsWith("Failed query:") ? e.message.split("\n")[0].slice(0, 200) : e.message.split("\n")[0];
      parts.push([e.name, x.type, x.code, x.constraint, x.statusCode, message, x.requestId].filter(Boolean).join(" "));
      e = e.cause;
    } else {
      parts.push(String(e).split("\n")[0]);
      break;
    }
  }
  console.error(label, parts.join(" <- "));
}
