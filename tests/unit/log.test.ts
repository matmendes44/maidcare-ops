// Failures are logged without the values that went into them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { logError } from "../../lib/log";

test("a failed query's parameters never reach the log", () => {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: "23505", constraint: "users_email_key" });
  const err = new Error('Failed query: update "users" set "password_hash" = $1 where "users"."id" = $2\nparams: scrypt$16384$secret-hash-value,42', { cause });
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    logError("password change failed", err);
  } finally {
    console.error = original;
  }
  const logged = lines.join("\n");
  assert.match(logged, /password change failed/);
  assert.match(logged, /update "users" set "password_hash"/);
  assert.match(logged, /23505/);
  assert.doesNotMatch(logged, /secret-hash-value/);
  assert.doesNotMatch(logged, /params:/);
});
