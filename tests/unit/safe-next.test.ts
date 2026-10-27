// After signing in, people may only be sent to a page on this site.
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "../../lib/auth/safe-next";

test("keeps paths on this site", () => {
  assert.equal(safeNext("/customers"), "/customers");
  assert.equal(safeNext("/finances?tab=paid#top"), "/finances?tab=paid#top");
  assert.equal(safeNext("/a/../customers"), "/customers");
});

test("refuses anything that a browser could send to another site", () => {
  const attacks = [
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http:evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000/evil.com",
    "\t//evil.com",
    " //evil.com",
    "evil.com",
    "",
    "/".padEnd(2000, "a"),
  ];
  for (const a of attacks) assert.equal(safeNext(a), "/", JSON.stringify(a));
});

test("refuses non-strings", () => {
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext(undefined), "/");
  assert.equal(safeNext(["/x"]), "/");
});
